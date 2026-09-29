import { i18n } from './i18n'

// Translate factory labels only; names entered by the user remain intact.
const thaiStyles: Record<string, [string, string, string]> = {
  '3d': ['3D 漫剧', 'การ์ตูน 3 มิติ', 'ภาพสามมิติ แสงแบบภาพยนตร์'],
  anime: ['日漫赛璐璐', 'อนิเมะญี่ปุ่น', 'เส้นคมชัด สีสด และเงาแบบอนิเมะ'],
  ghibli: ['吉卜力手绘', 'ภาพวาดแนวจิบลิ', 'ภาพวาดมือ บรรยากาศอบอุ่น'],
  watercolor: ['水彩绘本', 'ภาพสีน้ำ', 'สีอ่อนละมุนแบบหนังสือนิทาน'],
  comic: ['美式漫画', 'การ์ตูนอเมริกัน', 'เส้นหนา สีจัด และแสงตัดกัน'],
  guofeng: ['国风 2.5D', 'ภาพจีน 2.5 มิติ', 'ภาพวาดจีนผสมมิติและแสง'],
  webtoon: ['韩系网漫', 'เว็บตูนเกาหลี', 'ภาพการ์ตูนสำหรับอ่านแนวตั้ง'],
  noir: ['黑白漫画', 'การ์ตูนขาวดำ', 'ลายเส้นหมึก แสงเงาตัดกัน'],
}

export function styleLabel(preset: { value: string; name: string }): string {
  const label = thaiStyles[preset.value]
  return i18n.global.locale.value === 'th' && label && preset.name === label[0] ? label[1] : preset.name
}

export function styleDescription(preset?: { value: string; name: string; description?: string }): string {
  if (!preset) return ''
  const label = thaiStyles[preset.value]
  return i18n.global.locale.value === 'th' && label && preset.name === label[0] && /[\u4e00-\u9fff]/.test(preset.description || '')
    ? label[2] : preset.description || ''
}
