import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'

process.env.SQLITE_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'huobao-guard-')), 'test.sqlite3')
const { db, schema } = await import('../src/db/index.js')
const { buildAgentRequestContext } = await import('../src/agents/context.js')
const { checkNativeVersion, guardedNativeTools } = await import('../src/agents/native-guard.js')
const ts = new Date().toISOString()
const id = (r: any) => Number(r.lastInsertRowid)
const dramaId = id(db.insert(schema.dramas).values({ title: 'ทดสอบ', createdAt: ts, updatedAt: ts }).run())
const episodeId = id(db.insert(schema.episodes).values({ dramaId, episodeNumber: 1, title: 'หนึ่ง', createdAt: ts, updatedAt: ts }).run())
const otherEpisodeId = id(db.insert(schema.episodes).values({ dramaId, episodeNumber: 2, title: 'สอง', createdAt: ts, updatedAt: ts }).run())
const shotId = id(db.insert(schema.storyboards).values({ episodeId, storyboardNumber: 1, title: 'ช็อต', createdAt: ts, updatedAt: ts }).run())
const otherShotId = id(db.insert(schema.storyboards).values({ episodeId: otherEpisodeId, storyboardNumber: 1, title: 'อื่น', createdAt: ts, updatedAt: ts }).run())

test('native tools reject a shot from another episode before executing it', async () => {
  let executed = false
  const tools = guardedNativeTools({ update: { id: 'update', description: 'test', inputSchema: z.object({ storyboard_id: z.number() }), execute: async () => { executed = true; return {} } } })
  const requestContext = buildAgentRequestContext({ dramaId, episodeId })
  await assert.rejects(tools.update.execute({ storyboard_id: otherShotId }, { requestContext }), /ไม่ได้อยู่ในเรื่องนี้/)
  assert.equal(executed, false)
  await tools.update.execute({ storyboard_id: shotId }, { requestContext })
  assert.equal(executed, true)
})

test('native tools detect edits made while Codex is thinking and do not overwrite them', async () => {
  const requestContext = buildAgentRequestContext({ dramaId, episodeId })
  checkNativeVersion(requestContext)
  db.$client.prepare('UPDATE episodes SET script_content=? WHERE id=?').run('ผู้ใช้แก้เอง', episodeId)
  let executed = false
  const tools = guardedNativeTools({ save: { id: 'save', description: 'test', inputSchema: z.object({}), execute: async () => { executed = true; return {} } } })
  await assert.rejects(tools.save.execute({}, { requestContext }), /ข้อมูลถูกแก้/)
  assert.equal(executed, false)
  assert.equal((db.$client.prepare('SELECT script_content FROM episodes WHERE id=?').get(episodeId) as any).script_content, 'ผู้ใช้แก้เอง')
})

test('native context rejects mismatched episode and drama', () => {
  assert.throws(() => checkNativeVersion(buildAgentRequestContext({ dramaId, episodeId: 999 })), /ไม่ได้อยู่ในเรื่อง/)
})

test('legacy text config probes cannot call a paid LLM endpoint', async () => {
  const { default: configs } = await import('../src/routes/aiConfigs.js')
  const original = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('LLM endpoint must not be contacted') }
  try {
    for (const url of ['/', '/test']) {
      const response = await configs.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_type: 'text', provider: 'openai', base_url: 'https://api.openai.com', api_key: 'test' }) })
      assert.equal(response.status, 400)
      const body = await response.json() as any
      assert.match(body.message, /Codex/)
      assert.ok(!/[一-鿿]/.test(body.message))
    }
    assert.equal(called, false)
  } finally { globalThis.fetch = original }
})
