import { z } from 'zod'
export const briefSchema = z.object({
 target_seconds: z.number().int().min(5).max(3600),
 timing_mode: z.enum(['maximum', 'target']).default('maximum'),
 preset: z.enum(['standard','cliffhanger','emotional','reels_fast','teaser']).default('standard'),
 creative_brief: z.string().max(10000).default(''),
 source_policy: z.enum(['preserve','adapt']).default('preserve'),
 ending_policy: z.enum(['complete','cliffhanger']).default('cliffhanger'),
}).strict()
export type ProductionBrief = z.infer<typeof briefSchema>
export function timingCheck(brief: ProductionBrief | null, seconds: number) {
 if (!Number.isFinite(seconds) || seconds < 0) throw new Error('เวลาไม่ถูกต้อง')
 if (!brief) return { ok: true, min: 0, max: null, seconds, message: 'ยังไม่ได้กำหนดกรอบเวลา' }
 const min = brief.timing_mode === 'target' ? brief.target_seconds * .95 : 0
 const max = brief.timing_mode === 'target' ? brief.target_seconds * 1.05 : brief.target_seconds
 const ok = seconds >= min - 1e-8 && seconds <= max + 1e-8
 return { ok, min, max, seconds, message: ok ? 'อยู่ในกรอบเวลา' : seconds > max ? 'ความยาวเกินกรอบเวลา' : 'ความยาวสั้นกว่าเป้าหมาย' }
}
export const directorSchema = z.object({ summary: z.string().min(1).max(6000), beats: z.array(z.object({ title: z.string().min(1), seconds: z.number().int().positive(), purpose: z.string().min(1), protected: z.boolean() })).min(1).max(120) }).strict()
export const editEntrySchema = z.object({ storyboard_id: z.number().int().positive(), hash: z.string().min(1), in_ms: z.number().int().nonnegative(), out_ms: z.number().int().positive(), reason: z.string().min(1).max(2000) }).strict()
export const editSchema = z.object({ summary: z.string().min(1).max(6000), entries: z.array(editEntrySchema).min(1).max(300) }).strict()
export type EditSource = { storyboard_id: number; hash: string; duration_ms: number; protected: boolean }
export function validateEdit(raw: unknown[], sources: EditSource[], brief: ProductionBrief | null) {
 const entries = z.array(editEntrySchema).min(1).max(300).parse(raw)
 const seen = new Set<number>()
 for (const entry of entries) {
  const source = sources.find(s => s.storyboard_id === entry.storyboard_id)
  if (!source || source.hash !== entry.hash) throw new Error('คลิปอยู่นอกตอนหรือถูกเปลี่ยนแล้ว กรุณาวิเคราะห์ใหม่')
  if (seen.has(entry.storyboard_id)) throw new Error('แผนใช้คลิปซ้ำ')
  seen.add(entry.storyboard_id)
  if (entry.in_ms >= entry.out_ms || entry.out_ms > source.duration_ms) throw new Error('ช่วงตัดอยู่นอกความยาวคลิป')
  if (source.protected && (entry.in_ms !== 0 || entry.out_ms !== source.duration_ms)) throw new Error('ยังไม่มีเวลาบทพูดที่ตรวจแล้ว ต้องรักษาคลิปนี้ทั้งช่วง')
 }
 if (brief?.preset !== 'teaser' && entries.some((e,i)=>e.storyboard_id!==sources[i]?.storyboard_id)) throw new Error('แผนตอนเต็มต้องรักษาลำดับช็อต')
 if (brief?.preset !== 'teaser' && sources.some(s => !seen.has(s.storyboard_id))) throw new Error('แผนต้องรักษาช็อตครบ เลือกตัวอย่างตอนเพื่อส่งออกบางส่วน')
 const duration_ms = entries.reduce((n,e) => n + e.out_ms-e.in_ms, 0)
 const timing = timingCheck(brief, duration_ms/1000)
 if (!timing.ok) throw new Error(timing.message)
 return { entries, duration_ms, timing }
}
