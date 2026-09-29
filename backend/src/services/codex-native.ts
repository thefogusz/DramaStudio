/** Local-only bridge. No model calls, credentials, or HTTP endpoints. */
import type Database from 'better-sqlite3'
import { z } from 'zod'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const text = z.string().trim().min(1).max(200_000)
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)
const image = z.string().min(1).optional()
const asset = { key, image }
export const nativePackageSchema = z.object({
  version: z.literal(1), job_id: key,
  drama_id: z.number().int().positive().optional(),
  drama: z.object({ title: text, description: text.optional(), style: text.default('3d'), aspect_ratio: z.enum(['16:9', '9:16']).default('16:9') }).strict().optional(),
  episode: z.object({ title: text, script: text, source: text.optional() }).strict(),
  characters: z.array(z.object({ ...asset, name: text, description: text.optional(), appearance: text.optional(), personality: text.optional(), prompt: text.optional() }).strict()).max(100).default([]),
  scenes: z.array(z.object({ ...asset, location: text, time: text, prompt: text }).strict()).max(100).default([]),
  props: z.array(z.object({ ...asset, name: text, description: text.optional(), prompt: text.optional() }).strict()).max(100).default([]),
  shots: z.array(z.object({
    title: text, description: text.optional(), duration: z.number().int().min(1).max(60),
    scene: key.optional(), characters: z.array(key).max(100).default([]), props: z.array(key).max(100).default([]),
    image_prompt: text.optional(), video_prompt: text.optional(), shot_type: text.optional(), angle: text.optional(), movement: text.optional(), image,
  }).strict()).max(500).default([]),
}).strict().refine(p => Boolean(p.drama) !== Boolean(p.drama_id), 'Supply exactly one of drama or drama_id')

export function validateNativePackage(input: unknown) {
  const p = nativePackageSchema.parse(input)
  for (const items of [p.characters, p.scenes, p.props]) {
    if (new Set(items.map(a => a.key)).size !== items.length) throw new Error('Duplicate asset key')
  }
  const scenes = new Set(p.scenes.map(a => a.key))
  const characters = new Set(p.characters.map(a => a.key))
  const props = new Set(p.props.map(a => a.key))
  for (const shot of p.shots) {
    if (shot.scene && !scenes.has(shot.scene)) throw new Error(`Unknown scene: ${shot.scene}`)
    if (shot.characters.some(k => !characters.has(k))) throw new Error('Unknown character in shot')
    if (shot.props.some(k => !props.has(k))) throw new Error('Unknown prop in shot')
  }
  return p
}

// Resolve real paths too: a symlink inside a bundle must not escape its directory.
export function bundleImagePath(root: string, relative: string) {
  if (path.isAbsolute(relative)) throw new Error('Images must stay inside the package directory')
  const base = fs.realpathSync(root)
  const candidate = path.resolve(base, relative)
  const isInside = (p: string) => {
    const rel = path.relative(base, p)
    return rel !== '' && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)
  }
  if (!isInside(candidate)) throw new Error('Images must stay inside the package directory')
  const real = fs.realpathSync(candidate)
  if (!isInside(real)) throw new Error('Images must stay inside the package directory')
  return real
}

async function saveImage(source: string, folder: string) {
  if (fs.statSync(source).size > 25 * 1024 * 1024) throw new Error('Image exceeds 25 MB')
  const name = randomUUID()
  const pipeline = sharp(source, { limitInputPixels: 40_000_000 }).rotate()
  const meta = await pipeline.metadata()
  if (!['png', 'jpeg', 'webp'].includes(meta.format || '')) throw new Error('Only PNG, JPEG and WebP images are supported')
  fs.mkdirSync(folder, { recursive: true })
  await pipeline.png().toFile(path.join(folder, `${name}.png`))
  await sharp(path.join(folder, `${name}.png`)).resize({ width: 400, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(folder, `${name}_thumb.webp`))
  return `/static/codex/${path.basename(folder)}/${name}.png`
}

function receipts(sqlite: Database.Database) {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS codex_native_imports (
    job_id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL
  )`)
}
type ImportResult = { drama_id: number; episode_id: number }

function refreshDramaTotals(sqlite: Database.Database, dramaId: number) {
  sqlite.prepare(`UPDATE dramas SET
    total_episodes=(SELECT COUNT(*) FROM episodes WHERE drama_id=? AND deleted_at IS NULL),
    total_duration=(SELECT COALESCE(SUM(duration),0) FROM episodes WHERE drama_id=? AND deleted_at IS NULL)
    WHERE id=? AND deleted_at IS NULL`).run(dramaId, dramaId, dramaId)
}

export async function importNativePackage(sqlite: Database.Database, input: unknown, root: string, storageRoot: string): Promise<ImportResult> {
  const p = validateNativePackage(input)
  // Image bytes are part of the receipt so changed images cannot silently reuse a job.
  const images = [...p.characters, ...p.scenes, ...p.props, ...p.shots].filter(a => a.image)
  const hash = createHash('sha256').update(JSON.stringify(p))
  const sources = new Map<string, string>()
  for (const a of images) {
    const source = bundleImagePath(root, a.image!)
    if (fs.statSync(source).size > 25 * 1024 * 1024) throw new Error('Image exceeds 25 MB')
    hash.update(fs.readFileSync(source))
    sources.set(a.image!, source)
  }
  const digest = hash.digest('hex')
  receipts(sqlite)
  const previous = () => {
    const row = sqlite.prepare('SELECT digest,result FROM codex_native_imports WHERE job_id=?').get(p.job_id) as { digest: string; result: string } | undefined
    if (!row) return undefined
    if (row.digest !== digest) throw new Error('job_id already used for different content; choose a new job_id')
    return JSON.parse(row.result) as ImportResult
  }
  const existing = previous()
  if (existing) {
    // Repair summaries from older bridge imports without creating another episode.
    refreshDramaTotals(sqlite, existing.drama_id)
    return existing
  }
  const folder = path.join(storageRoot, 'codex', randomUUID())
  const urls = new Map<string, string>()
  try {
    for (const [relative, source] of sources) urls.set(relative, await saveImage(source, folder))
    const result = sqlite.transaction(() => {
      const duplicate = previous() // Recheck under the write lock, after asynchronous image processing.
      if (duplicate) return { duplicate: true, result: duplicate }
      const ts = new Date().toISOString()
      const insert = (table: string, values: Record<string, unknown>) => {
        const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined))
        const columns = Object.keys(clean)
        // Table/column names come only from constants in this module.
        return Number(sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(clean)).lastInsertRowid)
      }
      let dramaId = p.drama_id
      if (dramaId) {
        if (!sqlite.prepare('SELECT id FROM dramas WHERE id=? AND deleted_at IS NULL').get(dramaId)) throw new Error('Drama not found or deleted')
      } else {
        dramaId = insert('dramas', { ...p.drama!, created_at: ts, updated_at: ts })
      }
      const next = sqlite.prepare('SELECT COALESCE(MAX(episode_number),0)+1 AS n FROM episodes WHERE drama_id=? AND deleted_at IS NULL').get(dramaId) as { n: number }
      const episodeId = insert('episodes', { drama_id: dramaId, episode_number: next.n, title: p.episode.title, content: p.episode.source, script_content: p.episode.script, duration: p.shots.reduce((n, s) => n + s.duration, 0), created_at: ts, updated_at: ts })
      const assetIds = { characters: new Map<string, number>(), scenes: new Map<string, number>(), props: new Map<string, number>() }
      for (const group of ['characters', 'scenes', 'props'] as const) {
        for (const a of p[group]) {
          const { key: assetKey, image: file, prompt, ...fields } = a
          const url = file ? urls.get(file) : undefined
          const id = insert(group, { ...fields, ...(group === 'scenes' ? { prompt, episode_id: episodeId, status: url ? 'completed' : 'pending' } : group === 'characters' ? { final_prompt: prompt } : { prompt }), drama_id: dramaId, image_url: url, local_path: url?.slice(1), created_at: ts, updated_at: ts })
          assetIds[group].set(assetKey, id)
          const singular = group === 'characters' ? 'character' : group === 'scenes' ? 'scene' : 'prop'
          insert(`episode_${group}`, { episode_id: episodeId, [`${singular}_id`]: id, created_at: ts })
        }
      }
      for (const [i, shot] of p.shots.entries()) {
        const { scene, characters, props, image: file, ...fields } = shot
        const url = file ? urls.get(file) : undefined
        const id = insert('storyboards', { ...fields, episode_id: episodeId, storyboard_number: i + 1, scene_id: scene ? assetIds.scenes.get(scene) : undefined, composed_image: url, first_frame_image: url, created_at: ts, updated_at: ts })
        for (const k of new Set(characters)) insert('storyboard_characters', { storyboard_id: id, character_id: assetIds.characters.get(k) })
        for (const k of new Set(props)) insert('storyboard_props', { storyboard_id: id, prop_id: assetIds.props.get(k) })
      }
      sqlite.prepare('UPDATE dramas SET updated_at=? WHERE id=?').run(ts, dramaId)
      refreshDramaTotals(sqlite, dramaId!)
      const result = { drama_id: dramaId!, episode_id: episodeId }
      sqlite.prepare('INSERT INTO codex_native_imports VALUES(?,?,?,?)').run(p.job_id, digest, JSON.stringify(result), ts)
      return { duplicate: false, result }
    }).immediate()
    if (result.duplicate) fs.rmSync(folder, { recursive: true, force: true })
    return result.result
  } catch (err) {
    fs.rmSync(folder, { recursive: true, force: true })
    throw err
  }
}

export function exportNativeContext(sqlite: Database.Database, dramaId: number) {
  const drama = sqlite.prepare('SELECT * FROM dramas WHERE id=? AND deleted_at IS NULL').get(dramaId) as Record<string, any> | undefined
  if (!drama) throw new Error('Drama not found or deleted')
  const stylePreset = sqlite.prepare('SELECT name, value, prompt, description FROM style_presets WHERE value=?').get(drama.style) || null
  const rows = (table: string) => sqlite.prepare(`SELECT * FROM ${table} WHERE drama_id=? AND deleted_at IS NULL`).all(dramaId) as Record<string, any>[]
  return {
    production_briefs: sqlite.prepare('SELECT b.* FROM episode_production_briefs b JOIN episodes e ON e.id=b.episode_id WHERE e.drama_id=? AND e.deleted_at IS NULL').all(dramaId),
    production_plans: sqlite.prepare('SELECT p.* FROM episode_production_plans p JOIN episodes e ON e.id=p.episode_id WHERE e.drama_id=? AND e.deleted_at IS NULL').all(dramaId),
    version: 1, drama, style_preset: stylePreset, characters: rows('characters'), scenes: rows('scenes'), props: rows('props'),
    episodes: rows('episodes').map(ep => ({ ...ep,
      characters: sqlite.prepare('SELECT character_id FROM episode_characters WHERE episode_id=?').all(ep.id).map((r: any) => r.character_id),
      scenes: sqlite.prepare('SELECT scene_id FROM episode_scenes WHERE episode_id=?').all(ep.id).map((r: any) => r.scene_id),
      props: sqlite.prepare('SELECT prop_id FROM episode_props WHERE episode_id=?').all(ep.id).map((r: any) => r.prop_id),
      shots: (sqlite.prepare('SELECT * FROM storyboards WHERE episode_id=? AND deleted_at IS NULL ORDER BY storyboard_number').all(ep.id) as Record<string, any>[]).map(s => ({ ...s,
        characters: sqlite.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id=?').all(s.id).map((r: any) => r.character_id),
        props: sqlite.prepare('SELECT prop_id FROM storyboard_props WHERE storyboard_id=?').all(s.id).map((r: any) => r.prop_id),
      })),
    })),
  }
}

export async function attachNativeImage(sqlite: Database.Database, kind: string, id: number, source: string, storageRoot: string, options: { expectedUpdatedAt?: string; frameType?: string } = {}) {
  const table = ({ character: 'characters', scene: 'scenes', prop: 'props', storyboard: 'storyboards' } as Record<string, string>)[kind]
  if (!table || !Number.isSafeInteger(id) || id < 1) throw new Error('Invalid target type or id')
  const target = sqlite.prepare(`SELECT updated_at FROM ${table} WHERE id=? AND deleted_at IS NULL`).get(id) as { updated_at: string } | undefined
  if (!target) throw new Error('Target not found or deleted')
  if (options.expectedUpdatedAt && target.updated_at !== options.expectedUpdatedAt) throw new Error('ข้อมูลถูกแก้ระหว่างสร้างภาพ กรุณาตรวจงานและลองใหม่')
  const folder = path.join(storageRoot, 'codex', randomUUID())
  try {
    const url = await saveImage(source, folder)
    const ts = new Date().toISOString()
    const frame = options.frameType === 'last_frame' ? 'last_frame_image' : 'first_frame_image'
    const fields = kind === 'storyboard' ? (options.frameType ? `${frame}=?` : 'composed_image=?, first_frame_image=?') : 'image_url=?, local_path=?'
    const values = kind === 'storyboard' ? (options.frameType ? [url] : [url, url]) : [url, url.slice(1)]
    const update = sqlite.prepare(`UPDATE ${table} SET ${fields}, updated_at=? ${kind === 'scene' ? ", status='completed'" : ''} WHERE id=? AND updated_at=? AND deleted_at IS NULL`).run(...values, ts, id, target.updated_at)
    if (!update.changes) throw new Error('Target changed during image processing; export context and retry')
    return { id, url }
  } catch (err) {
    fs.rmSync(folder, { recursive: true, force: true })
    throw err
  }
}
