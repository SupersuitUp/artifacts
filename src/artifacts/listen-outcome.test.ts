// `goal: listen` and the `listened` rung (0.74.0): a play of a card's recording that reaches its
// last word is recorded on the reader's session, and lands the send on `listened`, under the same
// before-send rule as every other rung.
import { describe, it, expect } from 'vitest'
import { memoryRecipientsStore, summarizeViews } from './recipients-store.js'
import { OUTCOMES, parseGoal, goalCta } from './goal.js'

const ID = 'card2345'
async function setup() {
  const store = memoryRecipientsStore()
  const [robin] = await store.add(ID, [{ label: 'Robin' }])
  return { store, rid: robin.rid }
}

describe('goal: listen', () => {
  it('is a goal of its own, with no CTA', () => {
    expect(parseGoal('listen')).toEqual({ ok: true, goal: 'listen' })
    expect(goalCta('listen')).toBeNull()
  })
  it('listened sits above returned and below acted', () => {
    expect(OUTCOMES).toEqual(['not-opened', 'opened', 'read', 'returned', 'listened', 'acted'])
  })
})

describe('the listened rung', () => {
  it('a play to the last word is kept on the session, once per recording', async () => {
    const { store, rid } = await setup()
    const at = '2026-11-24T10:00:00.000Z'
    await store.recordView({ artifactId: ID, rid, session: 's1', device: 'd1', at, addSeconds: 2 })
    await store.recordView({ artifactId: ID, rid, session: 's1', device: 'd1', at, addSeconds: 0, play: 'card.m4a' })
    await store.recordView({ artifactId: ID, rid, session: 's1', device: 'd1', at, addSeconds: 0, listened: 'card.m4a' })
    await store.recordView({ artifactId: ID, rid, session: 's1', device: 'd1', at, addSeconds: 0, listened: 'card.m4a' })
    const [v] = await store.views(ID)
    expect(v.listened).toEqual(['card.m4a'])
    expect(v.plays).toEqual({ 'card.m4a': 1 })
  })
  it('a send whose play reached the last word is listened, and succeeds on goal: listen', async () => {
    const { store, rid } = await setup()
    await store.setSent!(ID, [rid], '2026-11-24T09:00:00.000Z')
    await store.recordView({ artifactId: ID, rid, session: 's1', device: 'd1', at: '2026-11-24T10:00:00.000Z', addSeconds: 12 })
    await store.recordView({ artifactId: ID, rid, session: 's1', device: 'd1', at: '2026-11-24T10:00:30.000Z', addSeconds: 0, listened: 'card.m4a' })
    const [line] = summarizeViews((await store.get(ID))!, await store.views(ID), [], { goal: 'listen' })
    expect(line.outcome).toBe('listened')
    expect(line.listened).toBe(true)
    expect(line.succeeded).toBe(true)
    // Under goal read the same send is listened too, and succeeded only by reading.
    const [asRead] = summarizeViews((await store.get(ID))!, await store.views(ID), [], { goal: 'read' })
    expect(asRead.outcome).toBe('listened')
    expect(asRead.succeeded).toBe(false)
  })
  it('a play that stopped short is not listened, and goal: listen has not succeeded', async () => {
    const { store, rid } = await setup()
    await store.recordView({ artifactId: ID, rid, session: 's1', device: 'd1', at: '2026-11-24T10:00:00.000Z', addSeconds: 40, play: 'card.m4a' })
    const [line] = summarizeViews((await store.get(ID))!, await store.views(ID), [], { goal: 'listen' })
    expect(line.outcome).toBe('read')
    expect(line.listened).toBe(false)
    expect(line.succeeded).toBe(false)
  })
  it('a comment is still acted, above listened', async () => {
    const { store, rid } = await setup()
    await store.recordView({ artifactId: ID, rid, session: 's1', device: 'd1', at: '2026-11-24T10:00:00.000Z', addSeconds: 2, listened: 'card.m4a' })
    const comments = [{ readerKey: `r:${rid}`, at: '2026-11-24T10:05:00.000Z', text: 'Thank you' }]
    const [line] = summarizeViews((await store.get(ID))!, await store.views(ID), comments, { goal: 'respond' })
    expect(line.outcome).toBe('acted')
    expect(line.listened).toBe(true)
  })
  it('before the send: a listen on the device that opened the link before it was sent is never the reader\'s', async () => {
    const { store, rid } = await setup()
    // The sender checks the card on their own phone, plays it through, then sends the link.
    await store.recordView({ artifactId: ID, rid, session: 's0', device: 'sender', at: '2026-11-24T08:00:00.000Z', addSeconds: 60, listened: 'card.m4a' })
    await store.setSent!(ID, [rid], '2026-11-24T09:00:00.000Z')
    const [before] = summarizeViews((await store.get(ID))!, await store.views(ID), [], { goal: 'listen' })
    expect(before.outcome).toBe('not-opened')
    expect(before.listened).toBe(false)
    expect(before.succeeded).toBe(false)
    // The reader opens it after the send and only skims: still not listened.
    await store.recordView({ artifactId: ID, rid, session: 's1', device: 'reader', at: '2026-11-24T10:00:00.000Z', addSeconds: 5 })
    const [after] = summarizeViews((await store.get(ID))!, await store.views(ID), [], { goal: 'listen' })
    expect(after.outcome).toBe('opened')
    expect(after.listened).toBe(false)
  })
})
