import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Database from 'better-sqlite3'
import { initSqliteSchema } from '../src/db/sqlite-schema.js'
import { STORAGE_ROOT } from '../src/utils/paths.js'
import { nativePackageSchema, validateNativePackage, bundleImagePath, importNativePackage, exportNativeContext, attachNativeImage } from '../src/services/codex-native.js'
import sharp from 'sharp'

const help = `Codex native bridge (no AI API calls)
  npm run native -- schema --out <schema.json>
  npm run native -- validate --file <package.json>
  npm run native -- import --file <package.json>
  npm run native -- list
  npm run native -- export --drama <id> --out <context.json>
  npm run native -- attach --kind character|scene|prop|storyboard --id <id> --file <image>
  npm run native -- script --episode <id> --file <script.txt> --expected <updated_at>
Optional: --db <sqlite file> --storage <static directory> (must match the running app)
Environment: SQLITE_PATH, HUOBAO_DATA_DIR, STORAGE_PATH; run from backend/ to load backend/.env.
Import creates a new episode. Reusing an unchanged job_id is safe; changed content needs a new job_id.
`

async function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const workspacePath = (file: string) => path.resolve(repo, file)
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(
    ['file', 'out', 'drama', 'episode', 'kind', 'id', 'expected', 'db', 'storage'].map(k => [k, { type: 'string' as const }]),
  ) })
  const command = positionals[0]
  if (!command || command === 'help') { console.log(help); return }
  if (!['schema', 'validate', 'import', 'list', 'export', 'attach', 'script'].includes(command)) throw new Error(help)
  const required = (name: string) => {
    const value = values[name]
    if (!value) throw new Error(`Missing --${name}\n${help}`)
    return value as string
  }
  const id = (name: string) => {
    const n = Number(required(name))
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid --${name}`)
    return n
  }
  const output = (data: unknown) => {
    const json = JSON.stringify(data, null, 2)
    if (values.out) {
      // Avoid overwriting an agent's previous context or an unrelated file.
      fs.writeFileSync(workspacePath(values.out), `${json}\n`, { flag: 'wx' })
      console.log(`Saved ${workspacePath(values.out)}`)
    } else console.log(json)
  }
  if (command === 'schema') {
    const { z } = await import('zod')
    output(z.toJSONSchema(nativePackageSchema, { io: 'input' }))
    return
  }
  let input: unknown
  let root: string | undefined
  if (command === 'validate' || command === 'import') {
    const file = workspacePath(required('file'))
    if (fs.statSync(file).size > 10 * 1024 * 1024) throw new Error('Package exceeds 10 MB')
    input = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    root = path.dirname(file)
    if (command === 'validate') {
      const p = validateNativePackage(input)
      for (const a of [...p.characters, ...p.scenes, ...p.props, ...p.shots]) {
        if (!a.image) continue
        const source = bundleImagePath(root, a.image)
        if (fs.statSync(source).size > 25 * 1024 * 1024) throw new Error('Image exceeds 25 MB')
        const image = sharp(source, { limitInputPixels: 40_000_000 })
        const meta = await image.metadata()
        if (!['png', 'jpeg', 'webp'].includes(meta.format || '')) throw new Error('Only PNG, JPEG and WebP images are supported')
        await image.resize({ width: 1 }).png().toBuffer() // Decode too, not just the header.
      }
      output({ valid: true, job_id: p.job_id, shots: p.shots.length })
      return
    }
  }
  const dbPath = values.db ? workspacePath(values.db) : path.resolve(process.env.SQLITE_PATH || path.join(repo, 'data', 'huobao.sqlite3'))
  const storage = values.storage ? workspacePath(values.storage) : path.resolve(STORAGE_ROOT)
  // Read commands must not silently create a different empty database.
  const readonly = command === 'list' || command === 'export'
  if (!readonly) fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const sqlite = new Database(dbPath, { readonly, fileMustExist: readonly })
  try {
    sqlite.pragma('busy_timeout = 5000')
    if (!readonly) { sqlite.pragma('journal_mode = WAL'); initSqliteSchema(sqlite) }
    if (command === 'import') output(await importNativePackage(sqlite, input, root!, storage))
    if (command === 'list') output(sqlite.prepare('SELECT id,title,style,aspect_ratio,updated_at FROM dramas WHERE deleted_at IS NULL ORDER BY id').all())
    if (command === 'export') output(sqlite.transaction(() => exportNativeContext(sqlite, id('drama')))())
    if (command === 'attach') output(await attachNativeImage(sqlite, required('kind'), id('id'), workspacePath(required('file')), storage))
    if (command === 'script') {
      const scriptFile = workspacePath(required('file'))
      if (fs.statSync(scriptFile).size > 1024 * 1024) throw new Error('Script file exceeds 1 MB')
      const script = fs.readFileSync(scriptFile, 'utf8').replace(/^\uFEFF/, '')
      if (!script.trim() || script.length > 200_000) throw new Error('Script must contain 1–200000 characters')
      const episodeId = id('episode')
      const result = sqlite.prepare('UPDATE episodes SET script_content=?,updated_at=? WHERE id=? AND updated_at=? AND deleted_at IS NULL').run(script, new Date().toISOString(), episodeId, required('expected'))
      if (!result.changes) throw new Error('Episode missing or changed; export fresh context and review before retrying')
      output({ episode_id: episodeId, updated: true })
    }
  } finally { sqlite.close() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
