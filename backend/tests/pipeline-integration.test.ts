import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.SQLITE_PATH = ':memory:'

test('settings save/key reuse → video API → fal request; invalid parameters create no task', async () => {
  const { default: configs } = await import('../src/routes/aiConfigs.js')
  const { default: tasks } = await import('../src/routes/tasks.js')
  const { db, schema } = await import('../src/db/index.js')
  const h = { 'Content-Type': 'application/json' }
  const save = await configs.request('/', { method: 'POST', headers: h, body: JSON.stringify({ service_type: 'video', provider: 'fal', name: 'audit', base_url: 'https://queue.fal.run', api_key: 'audit-fake-key', model: ['minimax/h3-max/text-to-video'], priority: 100 }) })
  assert.equal(save.status, 201)
  const id = (await save.json() as any).data.id
  const update = await configs.request(`/${id}`, { method: 'PUT', headers: h, body: JSON.stringify({ model: ['fal-ai/veo3.1', 'fal-ai/veo3.1/image-to-video'] }) })
  assert.equal(update.status, 200)
  const row = (await (await configs.request(`/${id}`)).json() as any).data
  assert.equal(row.api_key, 'audit-fake-key')
  assert.equal(row.model[0], 'fal-ai/veo3.1')
  const original = globalThis.fetch
  const requests: any[] = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    // Terminal mocked failure avoids polling, downloads and all external calls.
    return new Response('audit stop', { status: 422 })
  }
  try {
    const base = { type: 'video', config_id: id, model: row.model[0], prompt: 'camera pans', aspect_ratio: '9:16', resolution: '1080p', reference_image_urls: [] }
    const bad = await tasks.request('/', { method: 'POST', headers: h, body: JSON.stringify({ ...base, duration: 10 }) })
    assert.equal(bad.status, 400)
    assert.equal((await db.select().from(schema.sysTask)).length, 0)
    assert.equal(requests.length, 0)
    const good = await tasks.request('/', { method: 'POST', headers: h, body: JSON.stringify({ ...base, duration: 8 }) })
    assert.equal(good.status, 201)
    for (let i = 0; i < 50 && !requests.length; i++) await new Promise(r => setTimeout(r, 10))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://queue.fal.run/fal-ai/veo3.1')
    const body = JSON.parse(requests[0].options.body)
    assert.equal(body.duration, '8s')
    assert.equal(body.resolution, '1080p')
    assert.equal(body.aspect_ratio, '9:16')
    assert.equal(requests[0].options.headers.Authorization, 'Key audit-fake-key')
    for (let i = 0; i < 50; i++) {
      const rows = await db.select().from(schema.sysTask)
      if (rows[0]?.status === 'failed') break
      await new Promise(r => setTimeout(r, 10))
    }
    assert.equal((await db.select().from(schema.sysTask))[0].status, 'failed')
  } finally { globalThis.fetch = original }
})
