import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const root=await fs.mkdtemp(path.join(os.tmpdir(),'huobao-duration-'))
process.env.SQLITE_PATH=path.join(root,'test.sqlite3')
process.env.STORAGE_PATH=path.join(root,'static')
const {db,schema}=await import('../src/db/index.js')
const {saveBrief,checkVideoProductionTiming}=await import('../src/services/production.js')
const {generateVideo}=await import('../src/services/generation.js')
const {resolveAgentInstructions}=await import('../src/agents/index.js')
const ts=new Date().toISOString()
const dramaId=Number(db.insert(schema.dramas).values({title:'duration fixture',createdAt:ts,updatedAt:ts}).run().lastInsertRowid)
function episode(durations:number[]) {
 const episodeId=Number(db.insert(schema.episodes).values({dramaId,episodeNumber:durations.length,title:'test',createdAt:ts,updatedAt:ts}).run().lastInsertRowid)
 let shotId=0
 durations.forEach((duration,i)=>{shotId=Number(db.insert(schema.storyboards).values({episodeId,storyboardNumber:i+1,duration,createdAt:ts,updatedAt:ts}).run().lastInsertRowid)})
 saveBrief(episodeId,{target_seconds:30,timing_mode:'maximum',preset:'standard',creative_brief:'',source_policy:'adapt',ending_policy:'complete'},0)
 return shotId
}
test('30-second budget rejects the reported 87-second plan before configuration or paid task creation',async()=>{
 const shotId=episode([12,12,15,12,12,12,12])
 assert.throws(()=>checkVideoProductionTiming(shotId),/87.*เกิน/)
 const before=db.$client.prepare('SELECT COUNT(*) AS n FROM sys_task').get() as any
 await assert.rejects(generateVideo({storyboardId:shotId,prompt:'test'}),/87.*เกิน/)
 assert.deepEqual(db.$client.prepare('SELECT COUNT(*) AS n FROM sys_task').get(),before)
})
test('six 5-second tasks fit 30 seconds; seven do not',()=>{
 const valid=episode([5,5,5,5,5,5])
 assert.doesNotThrow(()=>checkVideoProductionTiming(valid,5))
 assert.throws(()=>checkVideoProductionTiming(valid,12),/ไม่ตรงกับแผน/)
 assert.throws(()=>checkVideoProductionTiming(episode([5,5,5,5,5,5,5])),/35.*เกิน/)
})
test('effective director instructions override legacy 12-second guidance in every locale',async()=>{
 for(const language of ['th','en','zh','ja','ko']) {
 const instructions=await resolveAgentInstructions('storyboard_breaker',language)
 assert.match(instructions,/12 seconds is NOT a minimum/)
 assert.match(instructions,/sum of ALL shot durations/)
 }
})

