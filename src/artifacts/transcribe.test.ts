import { deepgramTranscriber, openaiTranscriber } from './transcribe.js'
import { AUDIO_TYPES, audioExtFor, audioTypeFor, baseMime } from './audio.js'

const KEY = 'test-key-9d8c7b6a5f4e'
const memo = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })
let calls: { url: string; init: RequestInit }[]
function stubFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return respond(url, init) }))
}
afterEach(() => vi.unstubAllGlobals())

describe('audio types', () => {
  it('maps both browsers\' recordings to an extension and back', () => {
    // Chrome records webm with a codec suffix; iPhone Safari records mp4 audio.
    expect(baseMime('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(audioExtFor('audio/webm;codecs=opus')).toBe('webm')
    expect(audioExtFor('audio/mp4')).toBe('m4a')
    expect(audioExtFor('audio/mp4; codecs="mp4a.40.2"')).toBe('m4a')
    expect(audioExtFor('audio/mpeg')).toBe('mp3')
    expect(audioExtFor('audio/ogg;codecs=opus')).toBe('ogg')
    expect(audioExtFor('video/mp4')).toBeNull()
    expect(audioExtFor('audio/wav')).toBeNull()
    expect(audioTypeFor('comments/abc.m4a')).toBe('audio/mp4')
    expect(audioTypeFor('comments/abc.webm')).toBe('audio/webm')
    expect(audioTypeFor('comments/abc.png')).toBeNull()
    expect(Object.values(AUDIO_TYPES).sort()).toEqual(['audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/webm'])
  })
})

describe('deepgramTranscriber', () => {
  it('posts the raw recording to Nova-3 with its type, and reads the transcript', async () => {
    stubFetch(() => new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: ' the river runs north ' }] }] } }), { status: 200 }))
    const audio = memo()
    expect(await deepgramTranscriber(KEY)(audio, 'audio/mp4')).toEqual({ text: 'the river runs north' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true')
    expect(calls[0].init.method).toBe('POST')
    const h = calls[0].init.headers as Record<string, string>
    expect(h.Authorization).toBe(`Token ${KEY}`)
    expect(h['Content-Type']).toBe('audio/mp4')
    expect(calls[0].init.body).toBe(audio)
  })

  it('strips a codec suffix from the type it sends', async () => {
    stubFetch(() => new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: 'x' }] }] } }), { status: 200 }))
    await deepgramTranscriber(KEY)(memo(), 'audio/webm;codecs=opus')
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('audio/webm')
  })

  it('answers null on a refusal, a malformed body, or a network error, and never throws the key', async () => {
    // A service that echoes the credential back in its error body.
    stubFetch(() => new Response(`invalid credentials ${KEY}`, { status: 401 }))
    expect(await deepgramTranscriber(KEY)(memo(), 'audio/webm')).toBeNull()
    stubFetch(() => new Response('{"results":{}}', { status: 200 }))
    expect(await deepgramTranscriber(KEY)(memo(), 'audio/webm')).toBeNull()
    stubFetch(() => { throw new Error(`connect failed with Token ${KEY}`) })
    await expect(deepgramTranscriber(KEY)(memo(), 'audio/webm')).resolves.toBeNull()
  })

  it('makes no call at all without a key', async () => {
    stubFetch(() => new Response('{}'))
    expect(await deepgramTranscriber('')(memo(), 'audio/webm')).toBeNull()
    expect(calls).toHaveLength(0)
  })
})

describe('openaiTranscriber', () => {
  it('posts a multipart form with the file named by its type, and reads the text', async () => {
    stubFetch(() => new Response(JSON.stringify({ text: 'hello there' }), { status: 200 }))
    expect(await openaiTranscriber(KEY)(memo(), 'audio/mp4')).toEqual({ text: 'hello there' })
    expect(calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    const form = calls[0].init.body as FormData
    expect(form.get('model')).toBe('gpt-4o-mini-transcribe')
    const file = form.get('file') as File
    // The service detects the format by the file name, so iPhone audio goes up as .m4a.
    expect(file.name).toBe('memo.m4a')
    expect(file.type).toBe('audio/mp4')
  })

  it('takes another model', async () => {
    stubFetch(() => new Response(JSON.stringify({ text: 'x' }), { status: 200 }))
    await openaiTranscriber(KEY, 'whisper-1')(memo(), 'audio/webm')
    expect((calls[0].init.body as FormData).get('model')).toBe('whisper-1')
    expect(((calls[0].init.body as FormData).get('file') as File).name).toBe('memo.webm')
  })

  it('answers null on a refusal or a network error, and never throws the key', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } }), { status: 401 }))
    expect(await openaiTranscriber(KEY)(memo(), 'audio/webm')).toBeNull()
    stubFetch(() => { throw new Error(`Bearer ${KEY} rejected`) })
    await expect(openaiTranscriber(KEY)(memo(), 'audio/webm')).resolves.toBeNull()
    stubFetch(() => new Response(JSON.stringify({ text: 'x' }), { status: 200 }))
    expect(await openaiTranscriber(KEY)(memo(), 'audio/wav')).toBeNull()
  })
})
