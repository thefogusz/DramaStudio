import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FalVideoAdapter, FAL_VIDEO_MODEL, FAL_VIDEO_MODELS } from '../src/services/adapters/fal.js'

const adapter = new FalVideoAdapter()
const config = { provider: 'fal', baseUrl: 'https://queue.fal.run', apiKey: 'fake-test-key', model: FAL_VIDEO_MODEL }
const queue = {
  request_id: 'test-job',
  status_url: 'https://queue.fal.run/fal-ai/kling-video/requests/test-job/status',
  response_url: 'https://queue.fal.run/fal-ai/kling-video/requests/test-job',
}

test('H3 reference inputs preserve order and enforce endpoint limits', () => {
  const base = { id: 1, prompt: 'Image 1 speaks Thai', duration: 8, aspectRatio: '9:16', referenceImageUrls: JSON.stringify(['one','two','three']) }
  const req = adapter.buildGenerateRequest(config, base)
  assert.equal(req.url, `https://queue.fal.run/${FAL_VIDEO_MODEL}`)
  assert.deepEqual(req.body.reference_image_urls, ['one','two','three'])
  assert.equal(req.body.duration, 8)
  assert.equal(req.body.prompt_expansion_mode, 'disabled')
  assert.equal(req.body.image_url, undefined)
  assert.equal(req.body.generate_audio, undefined)
  assert.equal(FAL_VIDEO_MODELS.length, 1)
  assert.throws(() => adapter.buildGenerateRequest(config, {...base, duration:16}), /5–15/)
  assert.throws(() => adapter.buildGenerateRequest(config, {...base, referenceImageUrls: JSON.stringify(Array(10).fill('one'))}), /9 ภาพ/)
  assert.throws(() => adapter.buildGenerateRequest(config, {...base, referenceImageUrls: JSON.stringify(Array(9).fill('one')), referenceVideoUrls:'["v1","v2","v3"]', referenceAudioUrls:'["a1"]'}), /12 ไฟล์/)
  assert.throws(() => adapter.buildGenerateRequest(config, {...base, firstFrameUrl:'first'}), /ภาพเริ่มต้น/)
  assert.throws(() => adapter.buildGenerateRequest({...config, model:'minimax/h3-max/image-to-video'}, base), /รองรับเฉพาะ/)
  const mixed = adapter.buildGenerateRequest(config, {...base, referenceImageUrls:JSON.stringify(Array(9).fill('image')), referenceVideoUrls:'["v1","v2"]', referenceAudioUrls:'["a1"]'})
  assert.deepEqual(mixed.body.reference_video_urls, ['v1','v2'])
  assert.deepEqual(mixed.body.reference_audio_urls, ['a1'])
  const audio = adapter.buildGenerateRequest(config, {id:1, prompt:'Audio 1', referenceAudioUrls:'["audio"]'})
  assert.deepEqual(audio.body.reference_audio_urls, ['audio'])
})

test('fal persists authoritative queue URLs and rejects credential redirects', async () => {
  const taskId = adapter.parseGenerateResponse(queue).taskId!
  assert.equal(adapter.buildPollRequest(config, taskId).url, queue.status_url)
  assert.throws(() => adapter.parseGenerateResponse({ ...queue, response_url: 'https://evil.example/result' }), /queue.fal.run/)
  assert.throws(() => adapter.buildGenerateRequest({ ...config, baseUrl: 'https://evil.example' }, { id: 1, prompt:'shot', referenceImageUrls:'["one"]' }), /queue.fal.run/)
  assert.throws(() => adapter.parseGenerateResponse({ request_id: 'missing-urls' }), /URL/)
  assert.equal(adapter.parsePollResponse({ status: 'IN_QUEUE' }).status, 'pending')
  assert.equal(adapter.parsePollResponse({ status: 'IN_PROGRESS' }).status, 'processing')
  assert.equal(adapter.parsePollResponse({ status: 'COMPLETED', error: 'failed' }).status, 'failed')
  assert.equal(adapter.parsePollResponse({ video: {} }).status, 'failed')
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++
    assert.equal(url, queue.response_url)
    assert.equal(options?.redirect, 'error')
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Key fake-test-key')
    return Response.json({ video: { url: 'https://fal.media/movie.mp4' } })
  }
  try {
    await adapter.resolvePollResult(config, taskId, { status: 'IN_PROGRESS' })
    assert.equal(calls, 0)
    const output = await adapter.resolvePollResult(config, taskId, { status: 'COMPLETED' })
    assert.deepEqual(adapter.parsePollResponse(output), { status: 'completed', videoUrl: 'https://fal.media/movie.mp4', error: undefined })
    globalThis.fetch = async () => new Response('', { status: 422 })
    assert.equal(adapter.parsePollResponse(await adapter.resolvePollResult(config, taskId, { status: 'COMPLETED' })).status, 'failed')
  } finally { globalThis.fetch = originalFetch }
})

test('fal config supports videos only and connection test submits no generation', async () => {
  process.env.SQLITE_PATH = ':memory:'
  const { isOfficialProvider } = await import('../src/services/ai.js')
  assert.equal(isOfficialProvider('video', 'fal'), true)
  assert.equal(isOfficialProvider('text', 'fal'), false)
  assert.equal(isOfficialProvider('image', 'fal'), false)
  const { default: routes } = await import('../src/routes/aiConfigs.js')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method, 'GET')
    assert.match(String(url), /\/status$/)
    return new Response('{}', { status: 404 })
  }
  try {
    const response = await routes.request('/test', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_type: 'video', provider: 'fal', base_url: config.baseUrl, api_key: config.apiKey, model: [config.model] }) })
    assert.equal(response.status, 200)
    const data = (await response.json() as any).data
    assert.equal(data.ok, false)
    assert.equal(data.reachable, true)
  } finally { globalThis.fetch = originalFetch }
})
