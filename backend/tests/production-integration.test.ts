import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'huobao-production-'))
process.env.SQLITE_PATH=path.join(root,'db.sqlite3');process.env.STORAGE_PATH=path.join(root,'static');process.env.WORKSPACE_PATH=path.join(root,'workspace')
const {db,schema}=await import('../src/db/index.js')
const production=await import('../src/services/production.js')
const {renderProduction}=await import('../src/services/production-render.js')
const {ffmpeg}=await import('../src/utils/ffmpeg.js')
const {default:routes}=await import('../src/routes/episodes.js')
const {agentRegistry}=await import('../src/agents/index.js')
const {buildAgentRequestContext}=await import('../src/agents/context.js')
const app=new Hono().route('/episodes',routes)
const ts=new Date().toISOString()
const dramaId=Number(db.insert(schema.dramas).values({title:'fixture',aspectRatio:'9:16',createdAt:ts,updatedAt:ts}).run().lastInsertRowid)
const episodeId=Number(db.insert(schema.episodes).values({dramaId,episodeNumber:1,title:'fixture',createdAt:ts,updatedAt:ts}).run().lastInsertRowid)
const brief={target_seconds:5,timing_mode:'maximum',preset:'standard',creative_brief:'native timing test',source_policy:'adapt',ending_policy:'complete'}
test('brief API validates fields and revision; saved constraints reach real agent instructions',async()=>{
 assert.equal(production.readBrief(episodeId),null)
 const result=await app.request(`/episodes/${episodeId}/production`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({brief,expected_revision:0})})
 assert.equal(result.status,200)
 assert.throws(()=>production.saveBrief(episodeId,brief,0),/โหลดใหม่/)
 assert.throws(()=>production.saveBrief(episodeId,{...brief,target_seconds:0},1))
 assert.throws(()=>production.requireEpisode(episodeId,dramaId+1))
 const rc=buildAgentRequestContext({dramaId,episodeId,language:'th'})
 assert.match(String(await agentRegistry.script_rewriter.getInstructions({requestContext:rc})),/target_seconds/)
 assert.ok(agentRegistry.editor)
 const fp=production.productionSnapshot(episodeId).fingerprint
 const director=production.saveDirectorPlan(episodeId,{summary:'test',beats:[{title:'open',purpose:'hook',seconds:5,protected:true}]},fp)
 assert.ok(director.id)
 production.saveBrief(episodeId,brief,1)
 assert.equal(production.listPlans(episodeId)[0].stale,true)
})
test('real FFmpeg fixture validates source hashes, renders draft and protects final episode',async()=>{
 try {
 await fs.mkdir(process.env.STORAGE_PATH!,{recursive:true})
 const file=path.join(process.env.STORAGE_PATH!,'fixture.mp4')
 await new Promise<void>((resolve,reject)=>ffmpeg().input('testsrc2=size=180x320:rate=30:duration=5').inputFormat('lavfi').outputOptions(['-t','5','-c:v','libx264','-pix_fmt','yuv420p','-threads','2']).output(file).on('end',()=>resolve()).on('error',reject).run())
 const shotId=Number(db.insert(schema.storyboards).values({episodeId,storyboardNumber:1,title:'fixture',duration:5,videoUrl:'static/fixture.mp4',description:'silent corridor',createdAt:ts,updatedAt:ts}).run().lastInsertRowid)
 const ctx=await production.editContext(episodeId)
 assert.equal(ctx.sources[0].protected,false)
 assert.equal(ctx.sources[0].duration_ms,5000)
 const entry={storyboard_id:shotId,hash:ctx.sources[0].hash,in_ms:0,out_ms:5000,reason:'keep opening'}
 const plan=await production.saveEditPlan(episodeId,{summary:'standard',entries:[entry]},ctx.fingerprint)
 const mergeId=Number(db.insert(schema.videoMerges).values({episodeId,dramaId,provider:'ffmpeg',model:'test',status:'processing',createdAt:ts}).run().lastInsertRowid)
 await renderProduction(episodeId,plan.id,true,mergeId)
 const merge=db.$client.prepare('SELECT * FROM video_merges WHERE id=?').get(mergeId) as any
 assert.equal(merge.status,'completed');assert.ok(merge.duration<=5)
 assert.equal(production.requireEpisode(episodeId).video_url,null)
 const output=await production.ownedVideo(merge.merged_url)
 const metadata=await production.probeVideo(output)
 assert.equal(metadata.streams.find((s:any)=>s.codec_type==='video').width,360)
 assert.ok(metadata.streams.some((s:any)=>s.codec_type==='audio'))
 await fs.appendFile(file,Buffer.from('changed'))
 await assert.rejects(production.validatedPlan(episodeId,plan.id),/เปลี่ยน/)
 } catch(e:any) { console.error(e.message,e.stack);throw e }
})

test('native Director and Editor actually save plans through application tools', { skip: process.env.TEST_NATIVE_PRODUCTION !== '1', timeout: 180000 }, async()=>{
 const {mastra}=await import('../src/mastra/index.js')
 const context=buildAgentRequestContext({dramaId,episodeId,language:'th'})
 const director=await mastra.getAgent('storyboard_breaker').generate([{role:'user',content:'Only create a 5 second director plan. Call readProductionContext then saveDirector. Allocate one beat, 5 seconds, protected true, summary in Thai. Do not touch script/storyboards. Use the actual fingerprint returned by readProductionContext.'}],{maxSteps:6,requestContext:context})
 assert.ok(production.listPlans(episodeId).some(p=>p.kind==='director'&&!p.stale))
 const editor=await mastra.getAgent('editor').generate([{role:'user',content:'Read actual edit context then save a standard edit plan using the whole single 5 second clip. Do not trim. Use actual hash and fingerprint. Call tools and save, not just explain.'}],{maxSteps:6,requestContext:buildAgentRequestContext({dramaId,episodeId,language:'th'})})
 const plan=production.listPlans(episodeId).find(p=>p.kind==='edit'&&!p.stale)
 assert.ok(plan)
 await production.validatedPlan(episodeId,plan.id)
})

test('mixed FPS, audio and frame sizes normalize; protected speech cannot be trimmed',async()=>{
 const second=path.join(process.env.STORAGE_PATH!,'audio.mp4')
 await new Promise<void>((resolve,reject)=>ffmpeg().input('testsrc2=size=320x180:rate=25:duration=5').inputFormat('lavfi').input('sine=frequency=440:sample_rate=48000:duration=5').inputFormat('lavfi').outputOptions(['-t','5','-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p','-threads','2']).output(second).on('end',()=>resolve()).on('error',reject).run())
 db.insert(schema.storyboards).values({episodeId,storyboardNumber:2,title:'audio',duration:5,videoUrl:'static/audio.mp4',description:'บทพูด',createdAt:ts,updatedAt:ts}).run()
 const current=production.readBrief(episodeId)
 production.saveBrief(episodeId,{...brief,target_seconds:10},current.revision)
 const ctx=await production.editContext(episodeId)
 assert.equal(ctx.sources[1].protected,true)
 const entries=ctx.sources.map(s=>({storyboard_id:s.storyboard_id,hash:s.hash,in_ms:0,out_ms:s.duration_ms,reason:'รักษาช็อตทั้งหมด'}))
 const bad=entries.map(e=>({...e}));bad[1].in_ms=200
 await assert.rejects(production.saveEditPlan(episodeId,{summary:'bad',entries:bad},ctx.fingerprint),/รักษาคลิป/)
 const plan=await production.saveEditPlan(episodeId,{summary:'mixed sources',entries},ctx.fingerprint)
 const mergeId=Number(db.insert(schema.videoMerges).values({episodeId,dramaId,provider:'ffmpeg',model:'test',status:'processing',createdAt:ts}).run().lastInsertRowid)
 await renderProduction(episodeId,plan.id,true,mergeId)
 const merge=db.$client.prepare('SELECT * FROM video_merges WHERE id=?').get(mergeId) as any
 assert.equal(merge.status,'completed');assert.ok(merge.duration<=10)
 const metadata=await production.probeVideo(await production.ownedVideo(merge.merged_url))
 assert.equal(metadata.streams.find((s:any)=>s.codec_type==='video').r_frame_rate,'30/1')
 const finalId=Number(db.insert(schema.videoMerges).values({episodeId,dramaId,provider:'ffmpeg',model:'test',status:'processing',createdAt:ts}).run().lastInsertRowid)
 await renderProduction(episodeId,plan.id,false,finalId)
 const final=db.$client.prepare('SELECT * FROM video_merges WHERE id=?').get(finalId) as any
 assert.equal(final.status,'completed');assert.equal(production.requireEpisode(episodeId).video_url,final.merged_url)
 const finalMetadata=await production.probeVideo(await production.ownedVideo(final.merged_url))
 assert.equal(finalMetadata.streams.find((s:any)=>s.codec_type==='video').width,1080)
 const outside=path.join(root,'outside.mp4');await fs.copyFile(second,outside)
 await assert.rejects(production.ownedVideo(outside),/นอกที่เก็บ/)
})

test('legacy merge requires complete selected clips and partial output preserves final film',async()=>{
 const {mergeEpisodeVideos}=await import('../src/services/ffmpeg-merge.js')
 db.insert(schema.storyboards).values({episodeId,storyboardNumber:3,title:'missing',duration:5,createdAt:ts,updatedAt:ts}).run()
 await assert.rejects(mergeEpisodeVideos(episodeId,dramaId),/คลิปยังไม่ครบ/)
 const before=production.requireEpisode(episodeId).video_url
 const first=production.productionSnapshot(episodeId).shots[0].id
 const mergeId=await mergeEpisodeVideos(episodeId,dramaId,[first])
 let row:any
 for(let i=0;i<80;i++) {
  row=db.$client.prepare('SELECT * FROM video_merges WHERE id=?').get(mergeId)
  if(row.status==='completed'||row.status==='failed') break
  await new Promise(r=>setTimeout(r,100))
 }
 assert.equal(row.status,'completed',row.error_msg)
 assert.match(row.model,/-partial$/)
 assert.equal(production.requireEpisode(episodeId).video_url,before)
})
