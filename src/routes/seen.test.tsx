// The spec's five tests, server side, plus the refusals. Both halves ship together: a client that
// never sends for a fetch is half of "only real views count"; a server that ignores a fetcher even
// if one ran the page is the other.
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { createRecipientsRoutes } from './recipients-routes.js'
import { memoryRecipientsStore } from '../artifacts/recipients-store.js'
import { ridSig, mintRenderToken } from '../artifacts/recipients.js'
import { memoryArtifactStore } from './test-config.js'

const S = 's'.repeat(40)
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
async function setup(o: { secret?: string } = {}) {
  const recipients = memoryRecipientsStore()
  const [ana, owner] = await recipients.add('abcd2345', [{ label: 'Ana' }, { label: 'Owner', owner: true }])
  const routes = createRecipientsRoutes({ store: memoryArtifactStore([{ id: 'abcd2345', links: 'per-reader' } as never]), recipients, recipientSecret: () => o.secret ?? S, publishKey: () => 'k', pageUrl: (id) => `https://artifacts.example.com/${id}`, authed: () => false })
  const seen = (body: Record<string, unknown>, ua = SAFARI) =>
    routes.SEEN(new NextRequest('https://artifacts.example.com/api/artifacts/abcd2345/seen', { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': ua, 'content-type': 'application/json' } }), { params: Promise.resolve({ id: 'abcd2345' }) })
  const view = (rid: string, x: Record<string, unknown> = {}) => ({ rid, sig: ridSig(S, 'abcd2345', rid), event: 'view', token: mintRenderToken(S, 'abcd2345', rid), session: 's1', device: 'd1', ...x })
  return { recipients, ana, owner, seen, view }
}

describe('only real views count', () => {
  it.each([
    'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'WhatsApp/2.23.20.0',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Twitterbot/1.0',
  ])('a signal from %s records zero views, even if a fetcher ever ran the page', async (ua) => {
    const { recipients, ana, seen, view } = await setup()
    expect((await seen(view(ana.rid), ua)).status).toBe(204)
    expect(await recipients.views('abcd2345')).toEqual([])
  })
  it('a page shown for two seconds records exactly one view; a second visit is its own view', async () => {
    const { recipients, ana, seen, view } = await setup()
    expect((await seen(view(ana.rid))).status).toBe(200)
    expect(await recipients.views('abcd2345')).toHaveLength(1)
    const again = view(ana.rid, { session: 's2' })
    expect((await seen(again)).status).toBe(200)
    expect((await seen(again)).status).toBe(409) // one render can never count twice
    expect(await recipients.views('abcd2345')).toHaveLength(2)
  })
  it('the owner\'s own preview opens record zero', async () => {
    const { recipients, owner, seen, view } = await setup()
    expect((await seen(view(owner.rid))).status).toBe(204)
    expect(await recipients.views('abcd2345')).toEqual([])
  })
  it('a signal without the token the page was rendered with is refused', async () => {
    const { recipients, ana, seen, view } = await setup()
    expect((await seen(view(ana.rid, { token: undefined }))).status).toBe(409)
    expect((await seen(view(ana.rid, { token: mintRenderToken('x'.repeat(40), 'abcd2345', ana.rid) }))).status).toBe(409)
    expect(await recipients.views('abcd2345')).toEqual([])
  })
  it('a forged signature is 403, a revoked reader is 410, and a beat needs the key its view earned', async () => {
    const { recipients, ana, seen, view } = await setup()
    expect((await seen(view(ana.rid, { sig: '0'.repeat(16) }))).status).toBe(403)
    const ok = await (await seen(view(ana.rid))).json()
    expect((await seen({ ...view(ana.rid), event: 'beat', beat: '1'.repeat(16), seconds: 15 })).status).toBe(403)
    expect((await seen({ ...view(ana.rid), event: 'play', beat: ok.beat, media: 'river.mp4' })).status).toBe(200)
    expect((await recipients.views('abcd2345'))[0].plays).toEqual({ 'river.mp4': 1 })
    await recipients.revoke('abcd2345', [ana.rid])
    expect((await seen(view(ana.rid, { session: 's9' }))).status).toBe(410)
  })
})

describe('the signal is refused before it is trusted', () => {
  it('an empty or unset secret answers 404 and records nothing', async () => {
    const { recipients, ana, seen, view } = await setup({ secret: '' })
    expect((await seen(view(ana.rid))).status).toBe(404)
    expect(await recipients.views('abcd2345')).toEqual([])
  })
  it('a malformed session or device is 400', async () => {
    const { recipients, ana, seen, view } = await setup()
    expect((await seen(view(ana.rid, { session: 'A/../x' }))).status).toBe(400)
    expect((await seen(view(ana.rid, { device: '' }))).status).toBe(400)
    expect((await seen(view(ana.rid, { session: 'a'.repeat(33) }))).status).toBe(400)
    expect(await recipients.views('abcd2345')).toEqual([])
  })
  it('a signed rid the page never sent to is 410', async () => {
    const { recipients, seen, view } = await setup()
    expect((await seen(view('zzzzzzzzzzzz'))).status).toBe(410)
    expect(await recipients.views('abcd2345')).toEqual([])
  })
  it('an expired page, or one whose expiry is malformed, is 410', async () => {
    const { recipients, ana, seen, view } = await setup()
    await recipients.setExpiry('abcd2345', new Date(Date.now() - 1000).toISOString())
    expect((await seen(view(ana.rid))).status).toBe(410)
    await recipients.setExpiry('abcd2345', 'not a date')
    expect((await seen(view(ana.rid))).status).toBe(410)
    expect(await recipients.views('abcd2345')).toEqual([])
  })
  it('an unknown event is 400', async () => {
    const { ana, seen, view } = await setup()
    expect((await seen(view(ana.rid, { event: 'click' }))).status).toBe(400)
  })
})
