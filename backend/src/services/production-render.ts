import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'
import { ffmpeg, checkFfmpegSuite } from '../utils/ffmpeg.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { STORAGE_ROOT } from '../utils/paths.js'
import { validatedPlan, ownedVideo, probeVideo, requireEpisode } from './production.js'
import { timingCheck } from './production-contract.js'
let queue:Promise<unknown>=Promise.resolve()
const active=new Map<string,number>()
export async function startProductionRender(episodeId:number,planId:number,draft:boolean) {
 const key=`${episodeId}:${planId}:${draft}`
 if(active.has(key)) return active.get(key)!
 const ep=requireEpisode(episodeId)
 const validated=await validatedPlan(episodeId,planId)
 const suite=await checkFfmpegSuite()
 if(!suite.ffmpeg||!suite.ffprobe) throw new Error('ไม่พบ FFmpeg และ FFprobe ที่ใช้งานได้')
 if(active.has(key)) return active.get(key)!
 const row=db.$client.prepare(`INSERT INTO video_merges(episode_id,drama_id,title,provider,model,status,scenes,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(episodeId,ep.drama_id,`${draft?'ฉบับร่าง':'ฉบับส่งออก'} · แผน ${planId}`,'ffmpeg',`codex-edit-${draft?'draft':'final'}${validated.ctx.brief?.preset==='teaser'?'-teaser':''}`,'pending',JSON.stringify({plan_id:planId}),new Date().toISOString())
 const mergeId=Number(row.lastInsertRowid)
 active.set(key,mergeId)
 queue=queue.catch(()=>{}).then(async()=>{
  try {
   db.$client.prepare("UPDATE video_merges SET status='processing' WHERE id=?").run(mergeId)
   await renderProduction(episodeId,planId,draft,mergeId)
  } catch(e:any) {
   db.$client.prepare("UPDATE video_merges SET status='failed',error_msg=? WHERE id=?").run(e.message,mergeId)
  } finally {active.delete(key)}
 })
 return mergeId
}
function run(command:any) {
 return new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{command.kill('SIGKILL');reject(new Error('เรนเดอร์นานเกินกำหนด กรุณาลดจำนวนคลิปแล้วลองใหม่'))},15*60*1000)
  command.on('end',()=>{clearTimeout(timer);resolve()}).on('error',(e:Error)=>{clearTimeout(timer);reject(e)}).run()
 })
}
export async function renderProduction(episodeId:number,planId:number,draft:boolean,mergeId:number) {
 const {plan,ctx}=await validatedPlan(episodeId,planId)
 const ep=requireEpisode(episodeId)
 const drama=db.$client.prepare('SELECT aspect_ratio FROM dramas WHERE id=? AND deleted_at IS NULL').get(ep.drama_id) as any
 const ratio=drama?.aspect_ratio||'9:16'
 const [width,height]=ratio==='16:9'?(draft?[640,360]:[1920,1080]):ratio==='1:1'?(draft?[480,480]:[1080,1080]):(draft?[360,640]:[1080,1920])
 const temp=path.join(STORAGE_ROOT,'temp',`edit-${randomUUID()}`)
 const output=path.join(STORAGE_ROOT,'merged',`${randomUUID()}.mp4`)
 await fs.mkdir(temp,{recursive:true});await fs.mkdir(path.dirname(output),{recursive:true})
 try {
  const normalized=[]
  for(const [index,entry] of plan.entries.entries()) {
   const source=ctx.sources.find(s=>s.storyboard_id===entry.storyboard_id)!
   const file=await ownedVideo(source.url)
   const dest=path.join(temp,`${index}.mp4`)
   const duration=(entry.out_ms-entry.in_ms)/1000
   const command=ffmpeg().input(file).inputOptions(['-ss',String(entry.in_ms/1000)])
   if(!source.has_audio) command.input('anullsrc=channel_layout=stereo:sample_rate=48000').inputFormat('lavfi')
   command.outputOptions(['-t',String(duration),'-map','0:v:0','-map',source.has_audio?'0:a:0':'1:a:0','-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,'-c:v','libx264','-preset',draft?'ultrafast':'medium','-crf',draft?'28':'20','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-af','aresample=async=1:first_pts=0','-threads','2']).output(dest)
   await run(command);normalized.push(dest)
  }
  const list=path.join(temp,'clips.txt')
  // Entries are generated safe UUID/index paths; Windows slash normalization is for FFmpeg concat.
  await fs.writeFile(list,normalized.map(file=>`file '${file.replace(/\\/g,'/')}'`).join('\n'))
  await run(ffmpeg().input(list).inputOptions(['-f','concat','-safe','0']).outputOptions(['-t',String(plan.duration_ms/1000),'-c:v','libx264','-preset',draft?'ultrafast':'medium','-crf',draft?'28':'20','-vf','setpts=PTS-STARTPTS','-af',`asetpts=PTS-STARTPTS,atrim=duration=${plan.duration_ms/1000}`,'-c:a','aac','-ar','48000','-movflags','+faststart','-threads','2']).output(output))
  const metadata=await probeVideo(output)
  const duration=Number(metadata.format.duration)
  const result=timingCheck(ctx.brief,duration)
  if(!result.ok) throw new Error(`${result.message} (${duration.toFixed(2)} วินาที) กรุณาปรับแผนแล้วเรนเดอร์ใหม่`)
  // Recheck source snapshot and hashes after rendering; stale exports never replace current film.
  await validatedPlan(episodeId,planId)
  const relative=`static/merged/${path.basename(output)}`
  await extractVideoPoster(relative)
  db.$client.prepare("UPDATE video_merges SET status='completed',merged_url=?,duration=?,completed_at=?,scenes=? WHERE id=?").run(relative,duration,new Date().toISOString(),JSON.stringify({plan_id:planId,preset:plan.preset,evidence:plan.evidence,timing:result}),mergeId)
  if(!draft&&plan.preset!=='teaser') db.$client.prepare('UPDATE episodes SET video_url=?,updated_at=? WHERE id=?').run(relative,new Date().toISOString(),episodeId)
 } catch(e) {await fs.rm(output,{force:true});throw e}
 finally {await fs.rm(temp,{recursive:true,force:true})}
}
