import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import { spawnSync } from 'node:child_process'
import { initSqliteSchema } from '../src/db/sqlite-schema.js'
import { importNativePackage, exportNativeContext, attachNativeImage } from '../src/services/codex-native.js'

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'huobao-native-'))
  const sqlite = new Database(':memory:')
  initSqliteSchema(sqlite)
  return { dir, sqlite, storage: path.join(dir, 'static') }
}
const bundle = () => ({
  version: 1, job_id: 'episode-one', drama: { title: 'คืนฝนตก', aspect_ratio: '9:16' },
  episode: { title: 'ตอนแรก', script: 'หญิงสาวพบจดหมายเก่า' },
  characters: [{ key: 'mai', name: 'ไหม', image: 'mai.png' }],
  scenes: [{ key: 'room', location: 'ห้องนอน', time: 'กลางคืน', prompt: 'A quiet room' }],
  props: [{ key: 'letter', name: 'จดหมาย' }],
  shots: [{ title: 'พบจดหมาย', duration: 5, scene: 'room', characters: ['mai'], props: ['letter'], image_prompt: 'Woman reading a letter', video_prompt: 'Slow push in' }],
})

test('imports Thai script, linked assets and real image without AI configs; retries do not duplicate', async () => {
  const { dir, sqlite, storage } = setup()
  try {
    await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).png().toFile(path.join(dir, 'mai.png'))
    const result = await importNativePackage(sqlite, bundle(), dir, storage)
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM ai_service_configs').get().n, 0)
    const context = exportNativeContext(sqlite, result.drama_id)
    assert.equal(context.episodes[0].script_content, 'หญิงสาวพบจดหมายเก่า')
    assert.equal(context.drama.total_duration, 5)
    assert.equal(context.drama.total_episodes, 1)
    assert.equal(context.characters[0].name, 'ไหม')
    assert.equal(context.episodes[0].shots[0].characters[0], context.characters[0].id)
    assert.equal(context.episodes[0].shots[0].props.length, 1)
    assert.equal(context.episodes[0].shots[0].video_prompt, 'Slow push in')
    assert.ok(readFileSync(path.join(storage, context.characters[0].image_url.replace('/static/', ''))).length)
    assert.deepEqual(await importNativePackage(sqlite, bundle(), dir, storage), result)
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM episodes').get().n, 1)
    assert.equal(readdirSync(path.join(storage, 'codex')).length, 1)
    await assert.rejects(importNativePackage(sqlite, { ...bundle(), episode: { title: 'changed', script: 'changed' } }, dir, storage), /job_id/)
  } finally { sqlite.close() }
})

test('bad references, paths and malformed images leave database untouched', async () => {
  const { dir, sqlite, storage } = setup()
  try {
    const bad = bundle()
    bad.shots[0].scene = 'missing'
    await assert.rejects(importNativePackage(sqlite, bad, dir, storage), /scene/)
    const escaped = bundle()
    escaped.characters[0].image = '../secret.png'
    await assert.rejects(importNativePackage(sqlite, escaped, dir, storage), /inside/)
    writeFileSync(path.join(dir, 'mai.png'), 'not an image')
    await assert.rejects(importNativePackage(sqlite, bundle(), dir, storage))
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM dramas').get().n, 0)
  } finally { sqlite.close() }
})

test('append preserves existing work; context excludes credentials; attach supports storyboard frames', async () => {
  const { dir, sqlite, storage } = setup()
  try {
    const first = bundle()
    delete first.characters[0].image
    const result = await importNativePackage(sqlite, first, dir, storage)
    const second = { ...first, job_id: 'episode-two', drama: undefined, drama_id: result.drama_id }
    const appended = await importNativePackage(sqlite, second, dir, storage)
    assert.notEqual(appended.episode_id, result.episode_id)
    assert.equal(exportNativeContext(sqlite, result.drama_id).episodes.length, 2)
    assert.equal(exportNativeContext(sqlite, result.drama_id).drama.total_episodes, 2)
    assert.equal(exportNativeContext(sqlite, result.drama_id).drama.total_duration, 10)
    sqlite.prepare('UPDATE dramas SET total_duration=0 WHERE id=?').run(result.drama_id)
    await importNativePackage(sqlite, second, dir, storage)
    assert.equal(exportNativeContext(sqlite, result.drama_id).drama.total_duration, 10)
    sqlite.prepare("INSERT INTO ai_service_configs(service_type,name,base_url,api_key,created_at,updated_at) VALUES('text','private','private','secret','now','now')").run()
    assert.ok(!JSON.stringify(exportNativeContext(sqlite, result.drama_id)).includes('secret'))
    await sharp({ create: { width: 32, height: 32, channels: 3, background: 'blue' } }).png().toFile(path.join(dir, 'shot.png'))
    const shot = exportNativeContext(sqlite, result.drama_id).episodes[0].shots[0]
    await attachNativeImage(sqlite, 'storyboard', shot.id, path.join(dir, 'shot.png'), storage)
    const row = sqlite.prepare('SELECT * FROM storyboards WHERE id=?').get(shot.id)
    assert.equal(row.composed_image, row.first_frame_image)
    assert.ok(row.composed_image.startsWith('/static/codex/'))
  } finally { sqlite.close() }
})

test('database failure rolls back all rows and copied media', async () => {
  const { dir, sqlite, storage } = setup()
  try {
    await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).png().toFile(path.join(dir, 'mai.png'))
    sqlite.exec("CREATE TRIGGER fail_shot BEFORE INSERT ON storyboards BEGIN SELECT RAISE(ABORT, 'test database failure'); END")
    await assert.rejects(importNativePackage(sqlite, bundle(), dir, storage), /test database failure/)
    for (const table of ['dramas', 'episodes', 'characters', 'episode_characters', 'scenes', 'props', 'codex_native_imports']) {
      assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
    }
    assert.deepEqual(readdirSync(path.join(storage, 'codex')), [])
  } finally { sqlite.close() }
})

test('CLI edits a script with revision protection, and schema/validate do not create a database', () => {
  const { dir, sqlite, storage } = setup()
  sqlite.close()
  const dbPath = path.join(dir, 'cli.sqlite3')
  const example = path.resolve('../docs/examples/codex-native/package.json')
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/codex-native.ts', ...args, '--db', dbPath, '--storage', storage], { encoding: 'utf8' })
  assert.equal(run('validate', '--file', example).status, 0)
  assert.ok(!readdirSync(dir).includes('cli.sqlite3'))
  const schema = run('schema')
  assert.equal(schema.status, 0)
  assert.equal(JSON.parse(schema.stdout).properties.version.const, 1)
  const imported = run('import', '--file', example)
  assert.equal(imported.status, 0, imported.stderr)
  const context = JSON.parse(run('export', '--drama', '1').stdout)
  writeFileSync(path.join(dir, 'script.txt'), 'บทฉบับแก้ไข')
  const edited = run('script', '--episode', '1', '--file', path.join(dir, 'script.txt'), '--expected', context.episodes[0].updated_at)
  assert.equal(edited.status, 0, edited.stderr)
  const conflict = run('script', '--episode', '1', '--file', path.join(dir, 'script.txt'), '--expected', context.episodes[0].updated_at)
  assert.equal(conflict.status, 1)
  assert.match(conflict.stderr, /changed/)
  assert.equal(JSON.parse(run('export', '--drama', '1').stdout).episodes[0].script_content, 'บทฉบับแก้ไข')
})
