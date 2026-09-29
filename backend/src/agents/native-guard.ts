import { createHash } from 'node:crypto'
import { createTool } from '@mastra/core/tools'
import { db } from '../db/index.js'
import { exportNativeContext } from '../services/codex-native.js'
import { getDramaId, getEpisodeId } from './context.js'

const versions = new WeakMap<object, string>()
export function resetNativeVersion(rc: any) { if (rc) versions.delete(rc) }
function snapshot(rc: any) {
  const dramaId = getDramaId(rc)
  if (!dramaId) throw new Error('ไม่พบเรื่องสำหรับงาน Codex')
  const data = exportNativeContext(db.$client, dramaId)
  if (!data.episodes.some((ep: any) => ep.id === getEpisodeId(rc))) throw new Error('ตอนนี้ไม่ได้อยู่ในเรื่องที่เลือก')
  return data
}
function digest(data: unknown) { return createHash('sha256').update(JSON.stringify(data)).digest('hex') }
export function checkNativeVersion(rc: any) {
  const data = snapshot(rc), hash = digest(data)
  const previous = versions.get(rc)
  if (previous && previous !== hash) throw new Error('ข้อมูลถูกแก้ระหว่าง Codex ทำงาน กรุณารีเฟรชแล้วลองใหม่ เพื่อไม่เขียนทับงานของคุณ')
  versions.set(rc, hash)
  return data
}
export function guardedNativeTools(tools: Record<string, any>) {
  return Object.fromEntries(Object.entries(tools).map(([key, tool]) => [key, createTool({
    id: tool.id, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema,
    execute: async (input: any, context: any) => {
      const rc = context?.requestContext
      const data = checkNativeVersion(rc)
      const ids: Record<string, Set<number>> = {
        character: new Set(data.characters.map((x: any) => x.id)), scene: new Set(data.scenes.map((x: any) => x.id)),
        prop: new Set(data.props.map((x: any) => x.id)), storyboard: new Set(data.episodes.filter((ep: any) => ep.id === getEpisodeId(rc)).flatMap((ep: any) => ep.shots.map((x: any) => x.id))),
      }
      const validate = (value: any) => {
        if (!value || typeof value !== 'object') return
        for (const [name, item] of Object.entries(value)) {
          const match = name.match(/^(character|scene|prop|storyboard)_ids?$/)
          if (match && item != null) for (const id of Array.isArray(item) ? item : [item]) {
            if (!ids[match[1]].has(Number(id))) throw new Error('Codex อ้างอิงข้อมูลที่ไม่ได้อยู่ในเรื่องนี้')
          }
          if (typeof item === 'object') validate(item)
        }
      }
      validate(input)
      const result = await tool.execute(input, context)
      versions.set(rc, digest(snapshot(rc)))
      return result
    },
  })]))
}
