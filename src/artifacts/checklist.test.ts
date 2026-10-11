import { describe, it, expect } from 'vitest'
import { parseChecklistFence, assignChecklistIds, checkChecklistValue, checklistStorageKey, CHECKLIST_SLOT } from './checklist.js'
import { scanWidgets, checklistsOf, checklistSendIds, checklistAnswerIds } from './widgets.js'
import { parseArtifactSource } from './front-matter.js'

const page = (body: string, fm = '') => `---\ntitle: Prep\nsummary: S\n${fm}---\n${body}`

describe('the checklist fence', () => {
  it('reads items, explicit ids, slugged ids and indented descriptions', () => {
    const r = scanWidgets([
      '## The Mac', '',
      '```checklist',
      '- Update macOS {#update}',
      '  Apple menu > System Settings > General > Software Update.',
      '',
      '  Restart, then check again.',
      '- [ ] Sign in with your *personal* Apple Account',
      '- [x] Turn on FileVault',
      '```',
    ].join('\n'), 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.checklists).toHaveLength(1)
    const items = r.checklists[0].items
    expect(items.length).toBeGreaterThan(0)
    expect(items.map((i) => i.id)).toEqual(['update', 'sign-in-with-your-personal-apple-account', 'turn-on-filevault'])
    expect(items[0].text).toBe('Update macOS')
    expect(items[0].description).toBe('Apple menu > System Settings > General > Software Update.\n\nRestart, then check again.')
    expect(items[1].text).toBe('Sign in with your *personal* Apple Account')
    expect(items[1].description).toBe('')
    expect(r.checklists[0].line).toBe(3)
    expect(r.checklists[0].send).toBeUndefined()
  })

  it('numbers a repeated slug the way repeated headings are, page-wide, and keeps explicit ids', () => {
    const r = scanWidgets('```checklist\n- Restart\n- Restart\n```\n\n```checklist\n- Restart\n- Other {#restart-1}\n```', 0)
    expect(r.ok && r.checklists.flatMap((c) => c.items.map((i) => i.id))).toEqual(['restart', 'restart-2', 'restart-3', 'restart-1'])
  })

  it('refuses what would make ids unstable or the list ambiguous, naming the line', () => {
    expect(scanWidgets('x\n\n```checklist\n- A {#a}\n- B {#a}\n```', 0)).toEqual({ ok: false, error: 'line 5: the id {#a} is already used on line 4' })
    expect(scanWidgets('```checklist\n- A {#Bad}\n```', 0)).toMatchObject({ ok: false, error: expect.stringContaining('line 2: the id {#Bad} must be lowercase') })
    expect(scanWidgets('```checklist\n- A\nnot indented\n```', 0)).toEqual({ ok: false, error: 'line 3: a checklist item starts with "- ", and its description under it is indented' })
    expect(scanWidgets('```checklist\n```', 0)).toEqual({ ok: false, error: 'line 1: a checklist needs at least one item starting with "- "' })
    expect(scanWidgets('```checklist mine\n- A\n```', 0)).toMatchObject({ ok: false, error: expect.stringContaining('line 1: the checklist block takes no name') })
    expect(scanWidgets('```checklist\ncolor: red\n- A\n```', 0)).toEqual({ ok: false, error: 'line 2: the checklist block has an unknown setting: color' })
    expect(scanWidgets('```checklist\nsend: everyone\n- A\n```', 0)).toEqual({ ok: false, error: 'line 2: checklist send must be signed-in or anyone' })
    expect(scanWidgets('```checklist\n- {#a}\n```', 0)).toEqual({ ok: false, error: 'line 2: a checklist item needs some text' })
    expect(scanWidgets('```checklist\nsend: anyone\n- A\n```\n\n```checklist\nsend: anyone\n- B\n```', 0))
      .toEqual({ ok: false, error: 'line 6: a page takes at most one checklist with send' })
  })

  it('reads send, and counts lines from the top of the file', () => {
    const r = parseChecklistFence('send: anyone   # who may press Send\n- A', 7)
    expect(r.ok && r.block).toMatchObject({ line: 7, send: 'anyone' })
    const ids = assignChecklistIds([r.ok ? r.block : (null as never)])
    expect(ids.ok && ids.blocks[0].items[0]).toEqual({ id: 'a', text: 'A', description: '', line: 9 })
  })

  it('checklistsOf finds each checklist by the line it opens on; checklistSendIds only the sending one', () => {
    const md = '# t\n\n```checklist\n- A\n```\n\n```checklist\nsend: signed-in\n- B {#b}\n```'
    expect([...checklistsOf(md).keys()]).toEqual([3, 7])
    expect(checklistSendIds(md)).toEqual(['b'])
    expect(checklistSendIds('```checklist\n- A\n```')).toBeNull()
    expect(checklistsOf('# no lists').size).toBe(0)
  })

  it('stores ticks by page and item id', () => {
    expect(checklistStorageKey('abc23456', 'update')).toBe('artifact-checklist:abc23456:update')
  })
})

describe('publishing a checklist', () => {
  it('a checklist with no send declares no state, so the page is as quiet as before', () => {
    const r = parseArtifactSource(page('```checklist\n- A\n```\n'))
    expect(r.ok && r.meta.state).toBeUndefined()
  })
  it('send declares the checklist slot: one, private, written by whoever send names', () => {
    const r = parseArtifactSource(page('```checklist\nsend: anyone\n- A\n```\n'))
    expect(r.ok && r.meta.state).toEqual({ writers: 'signed-in', visibility: 'private', slots: { [CHECKLIST_SLOT]: { shape: 'one', visibility: 'private', writers: 'anyone' } } })
  })
  it('refuses state: declaring the slot itself, and names a fence error by its line in the FILE', () => {
    const own = parseArtifactSource(page('```checklist\nsend: anyone\n- A\n```\n', 'state:\n  slots:\n    checklist: { shape: one }\n'))
    expect(own.ok).toBe(false)
    expect(!own.ok && own.error).toContain('declares a slot by that name')
    const bad = parseArtifactSource(page('intro\n\n```checklist\n- A\nloose\n```\n'))
    // Four lines of front matter sit above the body.
    expect(bad).toEqual({ ok: false, error: 'line 9: a checklist item starts with "- ", and its description under it is indented' })
  })
})

describe('checkChecklistValue', () => {
  const ids = ['a', 'b']
  it('takes { done: [ids of this checklist] }, each once', () => {
    expect(checkChecklistValue({ done: [] }, ids)).toBeNull()
    expect(checkChecklistValue({ done: ['b', 'a'] }, ids)).toBeNull()
    expect(checkChecklistValue({ done: ['c'] }, ids)).toBe('a checklist answer names only items on this page')
    expect(checkChecklistValue({ done: ['a', 'a'] }, ids)).toBe('a checklist answer names each item once')
    expect(checkChecklistValue({ done: ['a'], note: 'x' }, ids)).toBe('a checklist answer is { done: [item ids] }')
    expect(checkChecklistValue(['a'], ids)).toBe('a checklist answer is { done: [item ids] }')
    expect(checkChecklistValue({ done: 'a' }, ids)).toBe('a checklist answer is { done: [item ids] }')
  })
})

describe('a checklist that syncs', () => {
  const two = (a = 'sync: anyone', b = '') => [
    '```checklist', ...(a ? [a] : []), '- One {#q-a-1}', '- Two {#q-a-2}', '```', '',
    '```checklist', ...(b ? [b] : []), '- Three {#q-b-1}', '```',
  ].join('\n')

  it('reads sync: anyone and sync: signed-in, and refuses any other value or send beside it', () => {
    for (const v of ['anyone', 'signed-in'] as const) {
      const r = parseChecklistFence(`sync: ${v}\n- A`, 1)
      expect(r.ok && r.block.sync).toBe(v)
    }
    const bad = parseChecklistFence('sync: everyone\n- A', 1)
    expect(!bad.ok && bad.error).toBe('line 2: checklist sync must be signed-in or anyone')
    const both = parseChecklistFence('send: anyone\nsync: anyone\n- A', 1)
    expect(!both.ok && both.error).toMatch(/send or sync, not both/)
  })

  it('one block saying sync makes every checklist on the page answer as one shared set', () => {
    const md = two()
    expect(checklistAnswerIds(md)).toEqual(['q-a-1', 'q-a-2', 'q-b-1'])
    const p = parseArtifactSource(page(md))
    expect(p.ok && p.meta.state?.slots[CHECKLIST_SLOT]).toEqual({ shape: 'one', visibility: 'shared', writers: 'anyone' })
    // The server's check takes ids from every block, and still refuses an id no block draws.
    const ids = checklistAnswerIds(md)!
    expect(checkChecklistValue({ done: ['q-a-2', 'q-b-1'] }, ids)).toBeNull()
    expect(checkChecklistValue({ done: ['q-b-1', 'q-c-9'] }, ids)).toBe('a checklist answer names only items on this page')
  })

  it('refuses blocks that disagree on who may tick, and send on a page that syncs', () => {
    const p = parseArtifactSource(page(two('sync: anyone', 'sync: signed-in')))
    expect(!p.ok && p.error).toMatch(/a page's ticks are one set/)
    const s = parseArtifactSource(page(two('sync: anyone', 'send: anyone')))
    expect(!s.ok && s.error).toMatch(/syncs? takes no send/)
    const s2 = parseArtifactSource(page(two('send: anyone', 'sync: anyone')))
    expect(!s2.ok && s2.error).toMatch(/takes no send/)
    // Both saying the same thing is fine.
    expect(parseArtifactSource(page(two('sync: anyone', 'sync: anyone'))).ok).toBe(true)
  })

  it('a page with send and no sync still answers with that one block\'s ids', () => {
    expect(checklistAnswerIds(two('send: anyone'))).toEqual(['q-a-1', 'q-a-2'])
    expect(checklistAnswerIds(two(''))).toBeNull()
  })
})
