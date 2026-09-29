import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { db } from '../db/index.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { ffmpeg } from '../utils/ffmpeg.js'
import { briefSchema, directorSchema, editSchema, timingCheck, validateEdit, type ProductionBrief } from './production-contract.js'
import presets from '../../../shared/edit-presets.json'
const sql = db.$client
export const editPresets = presets
export function requireEpisode(id: number, dramaId?: number) {
 const ep = sql.prepare('SELECT * FROM episodes WHERE id=? AND deleted_at IS NULL').get(id) as any
 if (!ep || !sql.prepare('SELECT id FROM dramas WHERE id=? AND deleted_at IS NULL').get(ep.drama_id) || (dramaId != null && ep.drama_id !== dramaId)) throw new Error('ไม่พบตอนในเรื่องที่เลือก')
 return ep
}
export function readBrief(id: number) {
 requireEpisode(id)
 const row = sql.prepare('SELECT * FROM episode_production_briefs WHERE episode_id=?').get(id) as any
 return row ? { ...JSON.parse(row.brief_json), revision: row.revision } : null
}
export function saveBrief(id: number, raw: unknown, revision: number) {
 requireEpisode(id)
 const brief = briefSchema.parse(raw)
 sql.transaction(() => {
  const current = readBrief(id)
  if ((current?.revision || 0) !== revision) throw new Error('กรอบเวลาถูกแก้แล้ว กรุณาโหลดใหม่')
  sql.prepare(`INSERT INTO episode_production_briefs VALUES(?,?,?,?) ON CONFLICT(episode_id) DO UPDATE SET revision=excluded.revision, brief_json=excluded.brief_json, updated_at=excluded.updated_at`).run(id, revision+1, JSON.stringify(brief), new Date().toISOString())
 })()
 return readBrief(id)
}
export function productionSnapshot(id: number) {
 const ep = requireEpisode(id)
 const shots = sql.prepare('SELECT * FROM storyboards WHERE episode_id=? AND deleted_at IS NULL ORDER BY storyboard_number').all(id)
 const brief = readBrief(id)
 const drama=sql.prepare('SELECT aspect_ratio FROM dramas WHERE id=?').get(ep.drama_id)
 const fingerprint = createHash('sha256').update(JSON.stringify({ episode: { id: ep.id, content:ep.content, script:ep.script_content, resolution:ep.resolution }, drama, brief, shots })).digest('hex')
 return { episode: ep, brief, shots: shots as any[], fingerprint }
}
export function productionDirective(id: number) {
 const brief = readBrief(id)
 if (!brief) return ''
 const preset = presets.find(p=>p.id===brief.preset)
 return `Mandatory episode production constraints (override generic timing rules in saved prompts/skills): ${JSON.stringify(brief)}. Preset guidance: ${preset?.guidance}. Use this time budget from story creation through screenplay and storyboards. Estimate dialogue, acting and pauses; do not estimate Thai speech by Chinese character counts. Read production context and director plan. Preserve existing source unless source_policy=adapt. A request to create a new story may use creative_brief even without source content. Storyboard shot duration must match the selected video model. Save complete results, and report timing issues honestly. Do not rewrite script or replace storyboards when only asked to save a director plan.`
}
export function timingStatus(id: number) {
 const snapshot = productionSnapshot(id)
 const planned = snapshot.shots.reduce((sum,s)=>sum+Number(s.duration||0),0)
 return { ...timingCheck(snapshot.brief, planned), configured:!!snapshot.brief, shots:snapshot.shots.length, ready_clips:snapshot.shots.filter(s=>s.video_url||s.composed_video_url).length }
}
export function listPlans(id: number) {
 const snap=productionSnapshot(id)
 return (sql.prepare('SELECT * FROM episode_production_plans WHERE episode_id=? ORDER BY id DESC LIMIT 30').all(id) as any[]).map(row=>({ ...row, plan:JSON.parse(row.plan_json), stale:row.fingerprint!==snap.fingerprint }))
}
export function saveDirectorPlan(id: number, input: unknown, fingerprint: string) {
 const snap=productionSnapshot(id)
 if (snap.fingerprint!==fingerprint) throw new Error('ข้อมูลเปลี่ยนแล้ว กรุณาวางแผนใหม่')
 const plan=directorSchema.parse(input)
 const timing=timingCheck(snap.brief,plan.beats.reduce((n,b)=>n+b.seconds,0))
 if (!timing.ok) throw new Error(timing.message)
 return insertPlan(id,'director',fingerprint,{...plan,timing})
}
function insertPlan(id:number,kind:string,fingerprint:string,plan:unknown) {
 const result=sql.prepare('INSERT INTO episode_production_plans(episode_id,kind,fingerprint,plan_json,created_at) VALUES(?,?,?,?,?)').run(id,kind,fingerprint,JSON.stringify(plan),new Date().toISOString())
 return { id:Number(result.lastInsertRowid), kind, plan }
}
export async function ownedVideo(raw: string) {
 const root=await fs.realpath(STORAGE_ROOT)
 const relative=raw.replace(/^[/\\]?static[/\\]/,'')
 const candidate=path.isAbsolute(raw)?raw:path.resolve(root,relative)
 const file=await fs.realpath(candidate)
 const rel=path.relative(root,file)
 if (rel.startsWith('..')||path.isAbsolute(rel)) throw new Error('คลิปอยู่นอกที่เก็บของแอป')
 return file
}
export function probeVideo(file:string):Promise<any> {
 return new Promise((resolve,reject)=>{ ffmpeg.ffprobe(file,(error,data)=>error?reject(new Error('อ่านข้อมูลคลิปไม่ได้')):resolve(data)) })
}
export async function editContext(id:number) {
 const snap=productionSnapshot(id)
 const sources=[]
 for(const shot of snap.shots) {
  const url=shot.video_url||shot.composed_video_url
  if(!url) continue
  const file=await ownedVideo(url)
  const [metadata,buffer]=await Promise.all([probeVideo(file),fs.readFile(file)])
  const duration_ms=Math.floor(Number(metadata.format.duration)*1000)
  if(!Number.isFinite(duration_ms)||duration_ms<=0) throw new Error('ความยาวคลิปไม่ถูกต้อง')
  const hash=createHash('sha256').update(buffer).digest('hex')
  // No verified dialogue intervals yet: any uncertain audio/speech keeps the full source.
  const protectedClip=metadata.streams.some((s:any)=>s.codec_type==='audio') || Boolean(shot.dialogue || /[“”"「」]|พูด|กล่าว|บรรยาย|台词|旁白/.test(`${shot.description||''} ${shot.video_prompt||''}`))
  sources.push({storyboard_id:shot.id,shot_number:shot.storyboard_number,hash,duration_ms,protected:protectedClip,description:shot.description||'',atmosphere:shot.atmosphere||'',url,has_audio:metadata.streams.some((s:any)=>s.codec_type==='audio')})
 }
 if(productionSnapshot(id).fingerprint!==snap.fingerprint) throw new Error('ข้อมูลเปลี่ยนระหว่างตรวจคลิป กรุณาลองใหม่')
 return { fingerprint:snap.fingerprint, brief:snap.brief, preset:presets.find(p=>p.id===snap.brief?.preset), sources, missing:snap.shots.length-sources.length, evidence:'ตรวจ metadata และความยาวไฟล์จริง ยังไม่ได้ตรวจภาพเคลื่อนไหวหรือเวลาบทพูด จึงรักษาคลิปที่มีเสียงหรือบทพูดทั้งช่วง' }
}
export async function saveEditPlan(id:number,input:unknown,fingerprint:string) {
 const plan=editSchema.parse(input)
 const ctx=await editContext(id)
 if(ctx.fingerprint!==fingerprint) throw new Error('บทหรือคลิปเปลี่ยนแล้ว กรุณาวิเคราะห์ใหม่')
 if(ctx.missing && ctx.brief?.preset!=='teaser') throw new Error(`ยังขาดคลิป ${ctx.missing} ช็อต`)
 const validated=validateEdit(plan.entries,ctx.sources,ctx.brief)
 return insertPlan(id,'edit',fingerprint,{...plan,...validated,evidence:ctx.evidence,preset:ctx.brief?.preset||'standard',source_hashes:ctx.sources.map(s=>({id:s.storyboard_id,hash:s.hash}))})
}
export async function validatedPlan(id:number,planId:number) {
 const row=sql.prepare("SELECT * FROM episode_production_plans WHERE id=? AND episode_id=? AND kind='edit'").get(planId,id) as any
 if(!row) throw new Error('ไม่พบแผนตัดต่อของตอนนี้')
 const plan=JSON.parse(row.plan_json)
 const ctx=await editContext(id)
 if(row.fingerprint!==ctx.fingerprint) throw new Error('แผนเก่าแล้ว กรุณาวิเคราะห์ใหม่')
 if(ctx.missing && ctx.brief?.preset!=='teaser') throw new Error('คลิปยังไม่ครบ')
 validateEdit(plan.entries,ctx.sources,ctx.brief)
 return {plan,ctx}
}

export function checkShotDuration(episodeId:number,duration:number,shotId?:number) {
 if(!Number.isFinite(duration)||duration<=0) throw new Error('ความยาวช็อตต้องมากกว่า 0 วินาที')
 const snapshot=productionSnapshot(episodeId)
 const total=snapshot.shots.filter(s=>s.id!==shotId).reduce((n,s)=>n+Number(s.duration||0),duration)
 const timing=timingCheck(snapshot.brief,total)
 if(snapshot.brief&&timing.max!=null&&total>timing.max) throw new Error('เวลาช็อตรวมเกินกรอบเวลาตอน กรุณาปรับแผน')
}
