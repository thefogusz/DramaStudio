import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import fs from 'node:fs'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'huobao-env-'))
process.env.HUOBAO_DATA_DIR = path.join(root, 'data')
process.env.STORAGE_PATH = path.join(root, 'separate-media')

test('custom media storage resolves and serves the same /static URL', async () => {
  const { STORAGE_ROOT } = await import('../src/utils/paths.js')
  const { getAbsolutePath } = await import('../src/utils/storage.js')
  fs.mkdirSync(STORAGE_ROOT, { recursive: true })
  const app = new Hono()
  app.use('/static/*', serveStatic({ root: STORAGE_ROOT, rewriteRequestPath: p => p.replace(/^\/static/, '') }))
  try {
    fs.mkdirSync(path.join(STORAGE_ROOT, 'images'), { recursive: true })
    fs.writeFileSync(path.join(STORAGE_ROOT, 'images', 'sample.txt'), 'audit-media')
    assert.equal(getAbsolutePath('static/images/sample.txt'), path.join(STORAGE_ROOT, 'images', 'sample.txt'))
    const r = await app.request('/static/images/sample.txt')
    assert.equal(r.status, 200)
    assert.equal(await r.text(), 'audit-media')
    const { dbPath } = await import('../src/db/index.js')
    assert.equal(dbPath, path.join(process.env.HUOBAO_DATA_DIR!, 'huobao.sqlite3'))
  } finally {
    // The DB connection stays open on Windows; remove only the test media file.
    fs.unlinkSync(path.join(STORAGE_ROOT, 'images', 'sample.txt'))
  }
})
