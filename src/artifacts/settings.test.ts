// Settings changed on the page win; a publish changes one only when the file's line changed since
// the file's last publish (0.31.0, settings.ts).
import { describe, it, expect } from 'vitest'
import { applySettingsPatch, declaredOf, newPageKey, passwordDigest, settleOnPublish, withComments } from './settings.js'
import { mergeCommentsState } from './comments.js'
import type { StateConfig } from './state.js'

const commentSlot = (writers: 'anyone' | 'signed-in', visibility: 'private' | 'shared' = 'private') => ({ shape: 'many' as const, visibility, writers })
const stateWith = (c?: 'anyone' | 'signed-in', v?: 'owner' | 'readers', base?: StateConfig) => {
  const r = mergeCommentsState(base, c, v)
  if (!r.ok) throw new Error(r.error)
  return r.state
}

describe('settleOnPublish', () => {
  it('the first publish takes the file as it is and records what it declared', () => {
    const r = settleOnPublish(null, { access: 'invite', password: 'k1', comments: 'anyone', commentsVisible: 'readers', state: stateWith('anyone', 'readers') })
    expect(r).toMatchObject({ access: 'invite', password: 'k1', comments: 'anyone', commentsVisible: 'readers' })
    expect(r.declared).toEqual({ access: 'invite', password: passwordDigest('k1'), comments: 'anyone', commentsVisible: 'readers' })
    expect(r.declared.password).not.toContain('k1')
    expect(settleOnPublish(null, { access: 'public' }).access).toBeUndefined()
  })

  it('a setting changed on the page survives a republish of the same file', () => {
    const declared = declaredOf({ access: 'invite', password: 'k1', comments: 'anyone' })
    // The admin opened the page, took the password off and turned comments off from the menu.
    const live = { declared, access: undefined, password: undefined, comments: undefined, commentsVisible: undefined, state: undefined }
    const r = settleOnPublish(live, { access: 'invite', password: 'k1', comments: 'anyone', state: stateWith('anyone') })
    expect(r.access).toBeUndefined()
    expect(r.password).toBeUndefined()
    expect(r.comments).toBeUndefined()
    expect(r.state).toBeUndefined()
  })

  it('a file whose line CHANGED since its last publish wins over the page', () => {
    const declared = declaredOf({ access: 'invite', password: 'k1', comments: 'anyone' })
    const live = { declared, access: undefined, password: undefined, comments: undefined, state: undefined }
    const r = settleOnPublish(live, { access: 'freedom', password: 'k2', comments: 'signed-in', commentsVisible: 'readers', state: stateWith('signed-in', 'readers') })
    expect(r).toMatchObject({ access: 'freedom', password: 'k2', comments: 'signed-in', commentsVisible: 'readers' })
    expect(r.state?.slots.comments).toEqual(commentSlot('signed-in', 'shared'))
  })

  it('dropping a line is a change too, except for access, which a file that names none never touches', () => {
    const declared = declaredOf({ access: 'invite', password: 'k1', comments: 'anyone' })
    const live = { declared, access: 'invite' as const, password: 'k1', comments: 'anyone' as const, state: stateWith('anyone') }
    const r = settleOnPublish(live, {})
    expect(r.access).toBe('invite')
    expect(r.password).toBeUndefined()
    expect(r.comments).toBeUndefined()
    expect(r.declared).toEqual({ access: null, password: null, comments: null, commentsVisible: null })
    // And then naming it again is a change against the null it last declared.
    expect(settleOnPublish({ ...live, access: undefined, declared: r.declared }, { access: 'invite' }).access).toBe('invite')
  })

  it('a password turned ON from the page stays on while the file still names none', () => {
    const live = { declared: declaredOf({}), password: 'fromthepage' }
    expect(settleOnPublish(live, {}).password).toBe('fromthepage')
  })

  it('comments turned on from the page are put back into the state the file declares', () => {
    const fileState: StateConfig = { writers: 'anyone', visibility: 'tally', slots: { vote: { shape: 'one' } } }
    const live = { declared: declaredOf({}), comments: 'signed-in' as const, commentsVisible: 'readers' as const, state: stateWith('signed-in', 'readers', fileState) }
    const r = settleOnPublish(live, { state: fileState })
    expect(r.comments).toBe('signed-in')
    expect(Object.keys(r.state!.slots).sort()).toEqual(['comments', 'vote'])
    expect(r.state!.slots.comments).toEqual(commentSlot('signed-in', 'shared'))
  })

  it('a page that declares its own slot named comments keeps it, and comments stay as the file says', () => {
    const own: StateConfig = { writers: 'anyone', visibility: 'private', slots: { comments: { shape: 'one' } } }
    const live = { declared: declaredOf({}), comments: 'anyone' as const, state: own }
    const r = settleOnPublish(live, { state: own })
    expect(r.comments).toBeUndefined()
    expect(r.state).toBe(own)
  })

  it('a record from before 0.31.0 (no declared) takes the file, as every publish did', () => {
    const live = { access: 'invite' as const, password: 'old', comments: 'anyone' as const }
    const r = settleOnPublish(live, { access: 'freedom', password: 'new' })
    expect(r).toMatchObject({ access: 'freedom', password: 'new', comments: undefined })
    expect(settleOnPublish(live, {}).access).toBe('invite')
  })
})

describe('applySettingsPatch', () => {
  it('changes only what the patch names', () => {
    const r = applySettingsPatch({ access: 'invite', password: 'k' }, { access: 'public' })
    expect(r).toEqual({ ok: true, live: { access: undefined, password: 'k' } })
    const p = applySettingsPatch({}, { password: 'k2' })
    expect(p.ok && p.live.password).toBe('k2')
    const off = applySettingsPatch({ password: 'k2' }, { password: null })
    expect(off.ok && off.live.password).toBeUndefined()
  })
  it('turning comments on adds the slot; nobody removes it; visibility follows', () => {
    const on = applySettingsPatch({}, { comments: 'anyone' })
    if (!on.ok) throw new Error(on.error)
    expect(on.live.comments).toBe('anyone')
    expect(on.live.state?.slots.comments).toEqual(commentSlot('anyone'))
    const shared = applySettingsPatch(on.live, { commentsVisible: 'readers' })
    if (!shared.ok) throw new Error(shared.error)
    expect(shared.live.state?.slots.comments).toEqual(commentSlot('anyone', 'shared'))
    const off = applySettingsPatch(shared.live, { comments: 'off' })
    if (!off.ok) throw new Error(off.error)
    expect(off.live.comments).toBeUndefined()
    expect(off.live.state).toBeUndefined()
  })
  it('refuses comments on a page with its own slot named comments', () => {
    const r = applySettingsPatch({ state: { writers: 'anyone', visibility: 'private', slots: { comments: { shape: 'one' } } } }, { comments: 'anyone' })
    expect(r.ok).toBe(false)
  })
  it('withComments keeps other slots when it removes comments', () => {
    const s = stateWith('anyone', undefined, { writers: 'anyone', visibility: 'tally', slots: { vote: { shape: 'one' } } })
    expect(Object.keys(withComments(s, 'off', undefined)!.slots)).toEqual(['vote'])
  })
})

describe('newPageKey', () => {
  it('is 12 characters from the readable alphabet, and not the same twice', () => {
    const a = newPageKey()
    expect(a).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{12}$/)
    expect(newPageKey()).not.toBe(a)
  })
})
