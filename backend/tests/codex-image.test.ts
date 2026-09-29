import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huobao-native-image-'))
process.env.SQLITE_PATH = path.join(root, 'db.sqlite3')
process.env.HUOBAO_DATA_DIR = root
const { db, schema } = await import('../src/db/index.js')
const { generateNativeImage, validateNativeOutput } = await import('../src/services/codex-image.js')
const ts = new Date().toISOString()
const id = (r: any) => Number(r.lastInsertRowid)
const dramaId = id(db.insert(schema.dramas).values({ title: 'native test', createdAt: ts, updatedAt: ts }).run())
const character = () => id(db.insert(schema.characters).values({ dramaId, name: 'ทดสอบ', imageUrl: '/static/old.png', createdAt: ts, updatedAt: ts }).run())
const status = async () => ({ authenticated: true, message: 'ready' })
const png = async (folder: string) => { const file = path.join(folder, 'real.png'); await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toFile(file); return file }
async function finished(taskId: number) {
  for (let i = 0; i < 100; i++) { const row = db.$client.prepare('SELECT * FROM sys_task WHERE id=?').get(taskId) as any; if (row.status !== 'processing') return row; await new Promise(r => setTimeout(r, 10)) }
  throw Error('worker did not finish')
}

test('native image jobs deduplicate, save a decoded PNG to the asset, and need no provider key', async () => {
  const characterId = character(); let calls = 0
  const deps = { status, run: async (folder: string) => { calls++; await new Promise(r => setTimeout(r, 30)); return png(folder) } }
  const [a, b] = await Promise.all([generateNativeImage({ characterId, dramaId, prompt: 'portrait' }, deps), generateNativeImage({ characterId, dramaId, prompt: 'portrait' }, deps)])
  assert.equal(a, b)
  const result = await finished(a); assert.equal(result.status, 'completed'); assert.equal(result.provider, 'codex'); assert.equal(calls, 1)
  const asset = db.$client.prepare('SELECT * FROM characters WHERE id=?').get(characterId) as any
  assert.equal(asset.image_url, result.result_url); assert.notEqual(asset.image_url, '/static/old.png')
  await sharp(path.join(root, asset.local_path)).resize({ width: 1 }).png().toBuffer()
})

test('edits during generation and invalid output preserve the existing image and report failure', async () => {
  const characterId = character()
  const taskId = await generateNativeImage({ characterId, prompt: 'portrait' }, { status, run: async folder => {
    db.$client.prepare('UPDATE characters SET name=?, updated_at=? WHERE id=?').run('ผู้ใช้แก้', new Date().toISOString(), characterId)
    return png(folder)
  } })
  const result = await finished(taskId); assert.equal(result.status, 'failed'); assert.match(result.error_msg, /ข้อมูลถูกแก้/)
  assert.equal((db.$client.prepare('SELECT image_url FROM characters WHERE id=?').get(characterId) as any).image_url, '/static/old.png')
  const bad = await generateNativeImage({ characterId, prompt: 'portrait' }, { status, run: async folder => { const file = path.join(folder, 'bad.png'); await fs.writeFile(file, 'not an image'); return file } })
  assert.equal((await finished(bad)).status, 'failed')
  assert.equal((db.$client.prepare('SELECT image_url FROM characters WHERE id=?').get(characterId) as any).image_url, '/static/old.png')
})

test('missing login, multiple targets, and cross-drama targets enqueue no image job', async () => {
  const characterId = character(); const before = (db.$client.prepare('SELECT count(*) AS n FROM sys_task').get() as any).n
  await assert.rejects(generateNativeImage({ characterId, prompt: 'x' }, { status: async () => ({ authenticated: false, message: 'กรุณาเข้าสู่ระบบ' }), run: png }), /เข้าสู่ระบบ/)
  await assert.rejects(generateNativeImage({ characterId, propId: 1, prompt: 'x' }), /หนึ่งรายการ/)
  await assert.rejects(generateNativeImage({ characterId, dramaId: dramaId + 1, prompt: 'x' }, { status, run: png }), /ไม่ได้อยู่/)
  assert.equal((db.$client.prepare('SELECT count(*) AS n FROM sys_task').get() as any).n, before)
})

test('native output cannot reference an unrelated local file', async () => {
  const folder = path.join(root, 'job'); await fs.mkdir(folder)
  const outside = await png(root)
  await assert.rejects(validateNativeOutput(outside, folder, Date.now()), /นอกพื้นที่|ENOENT/)
})

test('a last-frame job changes only the last frame and preserves the starting image', async () => {
  const episodeId = id(db.insert(schema.episodes).values({ dramaId, episodeNumber: 1, title: 'test', createdAt: ts, updatedAt: ts }).run())
  const storyboardId = id(db.insert(schema.storyboards).values({ episodeId, storyboardNumber: 1, firstFrameImage: '/static/first.png', composedImage: '/static/composed.png', createdAt: ts, updatedAt: ts }).run())
  const taskId = await generateNativeImage({ storyboardId, dramaId, prompt: 'last frame', frameType: 'last_frame' }, { status, run: png })
  assert.equal((await finished(taskId)).status, 'completed')
  const shot = db.$client.prepare('SELECT * FROM storyboards WHERE id=?').get(storyboardId) as any
  assert.equal(shot.first_frame_image, '/static/first.png'); assert.equal(shot.composed_image, '/static/composed.png'); assert.match(shot.last_frame_image, /^\/static\/codex\//)
})
