import type { Context } from 'hono'
import { thaiSystemMessage } from './system-message.js'

export function success(c: Context, data: any = null) {
  return c.json({ code: 200, data: localizeNotices(data), message: 'success' })
}

function localizeNotices(value: any): any {
  if (Array.isArray(value)) return value.map(localizeNotices)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    ['error', 'error_msg', 'errorMsg', 'message', 'warning'].includes(key) && typeof item === 'string' && /[一-鿿]/.test(item)
      ? /成功|已保存|已完成/.test(item) ? 'ทำรายการเรียบร้อยแล้ว' : thaiSystemMessage(item)
      : localizeNotices(item),
  ]))
}

export function created(c: Context, data: any = null) {
  return c.json({ code: 201, data, message: 'created' }, 201)
}

export function badRequest(c: Context, message = 'ข้อมูลคำขอไม่ถูกต้อง') {
  return c.json({ code: 400, message: thaiSystemMessage(message) }, 400)
}

export function notFound(c: Context, message = 'ไม่พบข้อมูลที่ต้องการ') {
  return c.json({ code: 404, message: thaiSystemMessage(message) }, 404)
}

export function serverError(c: Context, message = 'ระบบขัดข้อง กรุณาลองใหม่') {
  return c.json({ code: 500, message: thaiSystemMessage(message) }, 500)
}

export function now() {
  return new Date().toISOString()
}
