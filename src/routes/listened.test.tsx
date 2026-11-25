// A voice eCard's play that reaches the last word (0.74.0): the page posts `listened` to /seen
// under the same signature, render token and beat as a play, and the route keeps it on the session.
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { createRecipientsRoutes } from './recipients-routes.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig, mintRenderToken } from '../artifacts/recipients.js'
import { memoryArtifactStore } from './test-config.js'

const S = 's'.repeat(40)
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
async function setup() {
  const recipients = memoryRecipientsStore()
  const [ana, owner] = await recipients.add('card2345', [{ label: 'Ana' }, { label: 'Owner', owner: true }])
  const routes = createRecipientsRoutes({ store: memoryArtifactStore([{ id: 'card2345', template: 'voice-ecard', links: 'per-reader' } as never]), recipients, recipientSecret: () => S, publishKey: () => 'k', pageUrl: (id) => `https://artifacts.example.com/${id}`, authed: () => false })
  const seen = (body: Record<string, unknown>) =>
    routes.SEEN(new NextRequest('https://artifacts.example.com/api/artifacts/card2345/seen', { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': SAFARI, 'content-type': 'application/json' } }), { params: Promise.resolve({ id: 'card2345' }) })
  const view = (rid: string, x: Record<string, unknown> = {}) => ({ rid, sig: ridSig(S, 'card2345', rid), event: 'view', token: mintRenderToken(S, 'card2345', rid), session: 's1', device: 'd1', ...x })
  return { recipients, ana, owner, seen, view }
}

describe('POST /seen { event: "listened" }', () => {
  it('keeps a play to the last word on the session, once', async () => {
    const { recipients, ana, seen, view } = await setup()
    const { beat } = await (await seen(view(ana.rid))).json()
    expect((await seen({ ...view(ana.rid), event: 'play', beat, media: 'card.m4a' })).status).toBe(200)
    expect((await seen({ ...view(ana.rid), event: 'listened', beat, media: 'card.m4a' })).status).toBe(200)
    expect((await seen({ ...view(ana.rid), event: 'listened', beat, media: 'card.m4a' })).status).toBe(200)
    const [v] = await recipients.views('card2345')
    expect(v.listened).toEqual(['card.m4a'])
    expect(v.plays).toEqual({ 'card.m4a': 1 })
  })
  it('refuses one without the beat its view earned, or with no recording named', async () => {
    const { recipients, ana, seen, view } = await setup()
    const { beat } = await (await seen(view(ana.rid))).json()
    expect((await seen({ ...view(ana.rid), event: 'listened', beat: '1'.repeat(16), media: 'card.m4a' })).status).toBe(403)
    expect((await seen({ ...view(ana.rid), event: 'listened', beat })).status).toBe(400)
    expect((await seen({ ...view(ana.rid), event: 'listened', beat, media: '../x' })).status).toBe(400)
    expect((await recipients.views('card2345'))[0].listened).toBeUndefined()
  })
  it('the owner\'s own listen records nothing', async () => {
    const { recipients, owner, seen, view } = await setup()
    expect((await seen({ ...view(owner.rid), event: 'listened', beat: 'x', media: 'card.m4a' })).status).toBe(204)
    expect(await recipients.views('card2345')).toEqual([])
  })
})
