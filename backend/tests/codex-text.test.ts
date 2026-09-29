import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codexTextModel, codexQueueStatus, cli, withNativeAgentJob } from '../src/services/codex-text.js'
import { thaiSystemMessage } from '../src/utils/system-message.js'
import { Hono } from 'hono'
import { success, badRequest } from '../src/utils/response.js'

test('Codex adapter preserves application tool calls and streams results for Mastra', async () => {
  const model = codexTextModel(async () => ({ text: '', calls: [{ name: 'save_script', arguments: '{"content":"บทไทย"}' }] }))
  const result = await model.doGenerate({ prompt: [] })
  assert.equal(result.finishReason.unified, 'tool-calls')
  assert.equal(result.content[0].type, 'tool-call')
  const streamed = await model.doStream({ prompt: [] })
  const chunks = []
  for await (const item of streamed.stream) chunks.push(item)
  assert.equal(chunks[0].type, 'stream-start')
  assert.equal(chunks[1].type, 'tool-call')
  assert.equal(chunks.at(-1)?.type, 'finish')
})

test('Codex jobs run serially and a failed or cancelled job does not poison the queue', async () => {
  let active = 0, peak = 0
  const model = codexTextModel(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 10)); active--; return { text: 'เสร็จ', calls: [] } })
  await Promise.all([model.doGenerate({ prompt: [] }), model.doGenerate({ prompt: [] })])
  assert.equal(peak, 1)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(model.doGenerate({ prompt: [], abortSignal: cancelled.signal }), /ยกเลิก/)
  assert.equal((await model.doGenerate({ prompt: [] })).finishReason.unified, 'stop')
  assert.equal(codexQueueStatus().waiting, 0)
  assert.equal(codexQueueStatus().running, false)
})

test('missing executable produces a Thai actionable error and never invokes a shell', async () => {
  const old = process.env.HUOBAO_CODEX_BIN
  process.env.HUOBAO_CODEX_BIN = 'does-not-exist-huobao-codex-test'
  try { await assert.rejects(cli(['login', 'status']), /เปิด Codex CLI ไม่ได้/) }
  finally { if (old === undefined) delete process.env.HUOBAO_CODEX_BIN; else process.env.HUOBAO_CODEX_BIN = old }
})

test('complete agent workflows are serialized, including multiple model steps', async () => {
  const order: string[] = []
  const work = (name: string) => withNativeAgentJob(async () => {
    order.push(name + ':read')
    await new Promise(r => setTimeout(r, 5))
    order.push(name + ':save')
  })
  await Promise.all([work('characters'), work('scenes')])
  assert.deepEqual(order, ['characters:read', 'characters:save', 'scenes:read', 'scenes:save'])
  assert.equal(codexQueueStatus().waiting, 0)
})

test('Chinese system errors are localized while Thai errors and user content remain intact', () => {
  assert.match(thaiSystemMessage('角色不存在'), /ไม่พบตัวละคร/)
  assert.match(thaiSystemMessage('未配置文本模型'), /Codex/)
  assert.match(thaiSystemMessage('名称必填'), /ข้อมูลไม่ครบ/)
  assert.ok(!/[一-鿿]/.test(thaiSystemMessage('新错误')))
  assert.equal(thaiSystemMessage('ข้อมูลถูกแก้ระหว่าง Codex ทำงาน'), 'ข้อมูลถูกแก้ระหว่าง Codex ทำงาน')
})

test('API notices localize nested task failures without changing creative text', async () => {
  const app = new Hono()
  app.get('/status', c => success(c, { task: { error: '角色不存在' }, script_content: '角色不存在' }))
  app.get('/invalid', c => badRequest(c, '名称必填'))
  const data = await (await app.request('/status')).json() as any
  assert.match(data.data.task.error, /ไม่พบตัวละคร/)
  assert.equal(data.data.script_content, '角色不存在')
  const invalid = await (await app.request('/invalid')).json() as any
  assert.match(invalid.message, /ข้อมูลไม่ครบ/)
})
