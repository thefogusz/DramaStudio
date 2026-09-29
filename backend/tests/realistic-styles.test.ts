import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { initSqliteSchema } from '../src/db/sqlite-schema.js'
import { exportNativeContext, importNativePackage } from '../src/services/codex-native.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test('realistic series presets appear first and restart preserves user edits', () => {
  const sqlite = new Database(':memory:')
  try {
    initSqliteSchema(sqlite)
    const styles = sqlite.prepare('SELECT * FROM style_presets ORDER BY sort_order, id').all() as any[]
    assert.equal(styles.length, 14)
    assert.deepEqual(styles.slice(0, 6).map(s => s.value), ['cinematic-realism', 'thai-series', 'korean-romance', 'crime-thriller', 'period-film', 'documentary-realism'])
    assert.ok(styles.slice(0, 6).every(s => s.is_active && /photographic/i.test(s.prompt) && /light/i.test(s.prompt)))
    sqlite.prepare('UPDATE style_presets SET name=?, prompt=?, is_active=0 WHERE value=?').run('ของฉัน', 'custom lighting', 'thai-series')
    initSqliteSchema(sqlite)
    assert.equal((sqlite.prepare('SELECT count(*) AS n FROM style_presets').get() as any).n, 14)
    assert.deepEqual(sqlite.prepare('SELECT name, prompt, is_active FROM style_presets WHERE value=?').get('thai-series'), { name: 'ของฉัน', prompt: 'custom lighting', is_active: 0 })
  } finally { sqlite.close() }
})

test('native context supplies the selected look to Codex, including custom edits', async () => {
  const sqlite = new Database(':memory:')
  const dir = mkdtempSync(path.join(tmpdir(), 'huobao-style-'))
  try {
    initSqliteSchema(sqlite)
    const result = await importNativePackage(sqlite, { version: 1, job_id: 'realistic', drama: { title: 'ละคร', style: 'thai-series' }, episode: { title: 'ตอนแรก', script: 'บทละคร' } }, dir, path.join(dir, 'static'))
    const context = exportNativeContext(sqlite, result.drama_id)
    assert.equal((context.style_preset as any).value, 'thai-series')
    assert.match((context.style_preset as any).prompt, /Thai contemporary drama/)
    sqlite.prepare('UPDATE style_presets SET prompt=? WHERE value=?').run('user-selected look', 'thai-series')
    assert.equal((exportNativeContext(sqlite, result.drama_id).style_preset as any).prompt, 'user-selected look')
  } finally { sqlite.close() }
})
