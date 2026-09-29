/** Localize system errors only; never translate a user's script or prompt. */
export function thaiSystemMessage(message: string): string {
  if (!/[一-鿿]/.test(message)) return message
  const entity = /角色/.test(message) ? 'ตัวละคร' : /场景/.test(message) ? 'ฉาก' : /道具/.test(message) ? 'พร็อป' : /分镜/.test(message) ? 'ช็อต' : /剧集/.test(message) ? 'ตอน' : /项目|剧本/.test(message) ? 'เรื่องหรือบท' : 'ข้อมูล'
  if (/不存在|未找到|找不到/.test(message)) return `ไม่พบ${entity} กรุณารีเฟรชแล้วลองใหม่`
  if (/文本模型|文本.*配置/.test(message)) return 'งานข้อความใช้ Codex ในเครื่อง กรุณาตรวจสถานะ Codex ในการตั้งค่า'
  if (/提示词.*失败/.test(message)) return 'เขียนคำสั่งไม่สำเร็จ กรุณาตรวจสถานะ Codex แล้วลองใหม่'
  if (/未配置|配置.*缺|不支持/.test(message)) return 'การตั้งค่าบริการยังไม่พร้อมหรือไม่รองรับ กรุณาตรวจในการตั้งค่า'
  if (/必填|需要|无效|不能为空|参数/.test(message)) return 'ข้อมูลไม่ครบหรือไม่ถูกต้อง กรุณาตรวจแล้วลองใหม่'
  if (/超时/.test(message)) return 'งานใช้เวลานานเกินกำหนด กรุณาลองใหม่'
  if (/正在|运行中/.test(message)) return 'มีงานกำลังทำอยู่ กรุณารอให้เสร็จก่อน'
  return 'ทำรายการไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่ หากยังพบปัญหาให้ตรวจบันทึกของระบบ'
}
