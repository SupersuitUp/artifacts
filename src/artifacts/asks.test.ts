import { describe, it, expect } from 'vitest'
import { parseAsks, askcardIds, mergeAsksState, checkAskAnswer, ASKS_SLOT, type AskData } from './asks.js'
import { parseArtifactSource } from './front-matter.js'

const ASK: AskData = { id: 'headline', type: 'pick-one', question: 'Which headline?', hash: '0123456789ab',
  options: [{ label: 'Your own AI', because: 'Says what is different.', recommended: true }, { label: 'Stop the toil', because: 'Names the pain.', recommended: false }] }

describe('parseAsks', () => {
  it('takes the data the Mac sends and refuses anything else', () => {
    expect(parseAsks([ASK])).toEqual({ ok: true, asks: [ASK] })
    expect(parseAsks([{ ...ASK, type: 'rank' }]).ok).toBe(false)
    expect(parseAsks([{ ...ASK, hash: 'nothex' }]).ok).toBe(false)
    expect(parseAsks([ASK, ASK]).ok).toBe(false)
    expect(parseAsks([{ ...ASK, extra: 1 }]).ok).toBe(false)
    expect(parseAsks('a string').ok).toBe(false)
  })
})

describe('askcardIds', () => {
  it('reads only the id line of each askcard slot', () => {
    expect(askcardIds('Text\n\n```askcard\nheadline\n```\n\n```ask\nid: other\n```\n')).toEqual(['headline'])
  })
})

describe('the asks slot', () => {
  it('is one many-shape slot, private to the owner, writable by any reader of the page', () => {
    const r = mergeAsksState(undefined, [ASK])
    expect(r.ok && r.state?.slots[ASKS_SLOT]).toEqual({ shape: 'many', visibility: 'private', writers: 'anyone' })
    expect(mergeAsksState(undefined, undefined)).toEqual({ ok: true, state: undefined })
  })
  it('checks an answer against the page\'s own asks', () => {
    expect(checkAskAnswer({ ask: 'headline', hash: ASK.hash, choice: 'Your own AI', words: null }, [ASK])).toBeNull()
    expect(checkAskAnswer({ ask: 'headline', hash: ASK.hash, choice: null, words: 'Neither.' }, [ASK])).toBeNull()
    expect(checkAskAnswer({ ask: 'nope', hash: ASK.hash, choice: 'Your own AI', words: null }, [ASK])).toMatch(/no ask/)
    expect(checkAskAnswer({ ask: 'headline', hash: 'aaaaaaaaaaaa', choice: 'Your own AI', words: null }, [ASK])).toMatch(/changed/)
    expect(checkAskAnswer({ ask: 'headline', hash: ASK.hash, choice: 'Made up', words: null }, [ASK])).toMatch(/not one of/)
    expect(checkAskAnswer({ ask: 'headline', hash: ASK.hash, choice: null, words: null }, [ASK])).toMatch(/an option or words/)
    expect(checkAskAnswer({ ask: 'headline', hash: ASK.hash, choice: null, words: 'x'.repeat(4001) }, [ASK])).toMatch(/4000/)
  })
})

describe('front matter asks:', () => {
  const src = (extra: string, body = '```askcard\nheadline\n```\n') => `---\ntitle: T\nsummary: S\nlinks: per-reader\ncomments: anyone\nasks: ${JSON.stringify([ASK])}\n${extra}---\n${body}`
  it('declares the asks and merges the slot', () => {
    const r = parseArtifactSource(src(''))
    if (!r.ok) throw new Error(r.error)
    expect(r.meta.asks).toEqual([ASK])
    expect(r.meta.state?.slots.asks).toBeTruthy()
  })
  it('needs per-reader links, and every askcard slot must name an ask', () => {
    expect(parseArtifactSource(`---\ntitle: T\nsummary: S\nasks: ${JSON.stringify([ASK])}\n---\n`).ok).toBe(false)
    const r = parseArtifactSource(src('', '```askcard\nmissing\n```\n'))
    expect(!r.ok && r.error).toBe('the askcard slot "missing" names no ask in asks:')
  })
})
