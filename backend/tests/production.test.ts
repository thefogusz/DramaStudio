import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timingCheck, briefSchema, validateEdit, directorSchema } from '../src/services/production-contract.js'
const brief = briefSchema.parse({ target_seconds: 180, timing_mode: 'maximum', preset: 'standard', creative_brief: 'โจทย์', source_policy: 'preserve' })
test('maximum has a hard cap and target has 5 percent tolerance', () => {
 assert.equal(timingCheck(brief, 180).ok, true)
 assert.equal(timingCheck(brief, 180.01).ok, false)
 assert.equal(timingCheck({ ...brief, timing_mode: 'target' }, 171).ok, true)
 assert.equal(timingCheck({ ...brief, timing_mode: 'target' }, 170).ok, false)
 assert.throws(() => briefSchema.parse({ ...brief, target_seconds: -1 }))
})
const source = { storyboard_id: 1, hash: 'a', duration_ms: 5000, protected: true }
const entry = { storyboard_id: 1, hash: 'a', in_ms: 0, out_ms: 5000, reason: 'รักษาบทพูด' }
test('edit rejects cross episode, changed source, ranges and dialogue trims', () => {
 assert.equal(validateEdit([entry], [source], { ...brief, target_seconds: 5 }).duration_ms, 5000)
 for (const bad of [{ ...entry, storyboard_id: 2 }, { ...entry, hash: 'b' }, { ...entry, in_ms: -1 }, { ...entry, out_ms: 5100 }, { ...entry, in_ms: 500 }, { ...entry, out_ms: 4500 }]) assert.throws(() => validateEdit([bad], [source], brief))
 assert.throws(() => validateEdit([entry, entry], [source], brief))
 assert.throws(() => validateEdit([entry], [source], { ...brief, target_seconds: 4 }))
})
test('director requires beats', () => {
 assert.throws(() => directorSchema.parse({ summary: 'test', beats: [] }))
 assert.equal(directorSchema.parse({ summary: 'test', beats: [{ title: 'เปิด', seconds: 5, purpose: 'hook', protected: true }] }).beats[0].seconds, 5)
})

test('full episode preserves shot order; teaser can select a subset',()=>{
 const second={...source,storyboard_id:2,hash:'b',protected:false}
 const entry2={...entry,storyboard_id:2,hash:'b'}
 assert.throws(()=>validateEdit([entry2,entry],[source,second],brief),/ลำดับ/)
 assert.throws(()=>validateEdit([entry],[source,second],brief))
 assert.equal(validateEdit([entry],[source,second],{...brief,preset:'teaser'}).duration_ms,5000)
})
