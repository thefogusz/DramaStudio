import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Hono } from 'hono'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-agent-settings-'))
process.env.SQLITE_PATH = path.join(root, 'db.sqlite3')
process.env.WORKSPACE_PATH = path.join(root, 'workspace')
const types = ['script_rewriter', 'extractor', 'storyboard_breaker', 'prompt_generator']
const skills = ['script-rewriter', 'extractor', 'storyboard-breaker', 'prompt-generator/character-prompt']
for (const skill of skills) {
  const dir = path.join(process.env.WORKSPACE_PATH, 'skills', skill)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${skill.split('/').at(-1)}\ndescription: test\n---\nBASE_SKILL_${skill}\n`)
}
const { db, schema } = await import('../src/db/index.js')
const { agentRegistry } = await import('../src/agents/index.js')
const { buildAgentRequestContext } = await import('../src/agents/context.js')
const { default: prompts } = await import('../src/routes/prompts.js')
const { default: skillRoutes } = await import('../src/routes/skills.js')
const { default: agents } = await import('../src/routes/agent.js')
const app = new Hono().route('/api/v1/prompts', prompts).route('/api/v1/skills', skillRoutes).route('/api/v1/agent', agents)
const ts = new Date().toISOString()
const dramaId = Number(db.insert(schema.dramas).values({ title: 'test', createdAt: ts, updatedAt: ts }).run().lastInsertRowid)
const episodeId = Number(db.insert(schema.episodes).values({ dramaId, episodeNumber: 1, title: 'test', createdAt: ts, updatedAt: ts }).run().lastInsertRowid)
const put = async (url: string, body: unknown) => { const r = await app.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(r.status, 200) }

for (const [i, type] of types.entries()) test(`${type}: saved Thai prompt and skill changes reach the actual Codex agent without restart`, async () => {
  const marker = `APP_PROMPT_${type}`
  await put(`/api/v1/prompts/${type}?lang=th`, { system_prompt: marker })
  await put(`/api/v1/skills/${skills[i]}?lang=th`, { content: `---\nname: test\ndescription: test\n---\nAPP_SKILL_${type}` })
  const requestContext = buildAgentRequestContext({ dramaId, episodeId, language: 'th', modelOverride: 'openai/legacy-paid-model', textConfigId: 999 })
  const instructions = String(await agentRegistry[type].getInstructions({ requestContext }))
  assert.ok(instructions.includes(marker)); assert.ok(instructions.includes(`APP_SKILL_${type}`)); assert.ok(instructions.includes('ภาษาไทย'))
  const model = await agentRegistry[type].getModel({ requestContext }) as any
  assert.equal(model.provider, 'codex-cli'); assert.equal(model.modelId, 'codex-native')
  await put(`/api/v1/prompts/${type}?lang=th`, { system_prompt: `${marker}_EDITED` })
  await put(`/api/v1/skills/${skills[i]}?lang=th`, { content: `---\nname: test\ndescription: test\n---\nUPDATED_SKILL_${type}` })
  const updated = String(await agentRegistry[type].getInstructions({ requestContext }))
  assert.ok(updated.includes(`${marker}_EDITED`)); assert.ok(updated.includes(`UPDATED_SKILL_${type}`)); assert.ok(!updated.includes(`APP_SKILL_${type}`))
  const response = await app.request(`/api/v1/agent/${type}/debug`)
  const body = await response.json() as any
  assert.equal(body.data.provider, 'codex-cli'); assert.equal(body.data.language, 'th'); assert.deepEqual(body.data.loaded_skills, [skills[i]])
  assert.equal(body.data.instructions_length, updated.length)
})
