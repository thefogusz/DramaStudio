import type { AIConfig, ProviderRequest, VideoProviderAdapter, VideoGenerationRecord } from './types'

export const FAL_VIDEO_MODEL = 'fal-ai/kling-video/v2.6/pro/text-to-video'

function queueUrl(raw: string): string {
  const url = new URL(raw)
  if (url.origin !== 'https://queue.fal.run' || url.username || url.password || url.search || url.hash) {
    throw new Error('fal ต้องใช้ https://queue.fal.run เท่านั้น')
  }
  return url.toString().replace(/\/$/, '')
}

function request(config: AIConfig, url: string, body?: unknown): ProviderRequest {
  return { url: queueUrl(url), method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Key ${config.apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body }
}

function submit(config: AIConfig, model: string, body: unknown): ProviderRequest {
  const base = queueUrl(config.baseUrl || 'https://queue.fal.run')
  if (base !== 'https://queue.fal.run') throw new Error('fal Base URL ต้องเป็น https://queue.fal.run')
  return request(config, `${base}/${model}`, body)
}

function queued(result: any) {
  if (typeof result?.request_id !== 'string' || !result.request_id
    || typeof result.status_url !== 'string' || typeof result.response_url !== 'string') {
    throw new Error('fal ไม่ได้ส่งรหัสงานและ URL สำหรับติดตามผล')
  }
  // Store the returned URLs: sub-endpoints may use a different queue app path.
  const status = queueUrl(result.status_url)
  const response = queueUrl(result.response_url)
  if (!status.includes('/requests/') || !response.includes('/requests/')) throw new Error('Invalid fal queue URLs')
  return { isAsync: true, taskId: JSON.stringify({ status, response }) }
}

function tracking(config: AIConfig, taskId: string, field: 'status' | 'response') {
  const urls = JSON.parse(taskId)
  return request(config, urls[field])
}

export async function fetchFalResult(config: AIConfig, taskId: string, status: any): Promise<any> {
  if (status?.status !== 'COMPLETED' || status.error) return status
  const req = tracking(config, taskId, 'response')
  const response = await fetch(req.url, { method: req.method, headers: req.headers,
    redirect: 'error', signal: AbortSignal.timeout(60_000) })
  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) throw new Error(`fal result HTTP ${response.status}`)
    return { error: `fal ไม่สามารถสร้างงานได้ (HTTP ${response.status})` }
  }
  return response.json()
}

function state(result: any): 'pending' | 'processing' | 'failed' | 'completed' {
  if (result?.error || result?.detail) return 'failed'
  if (result?.status === 'IN_QUEUE') return 'pending'
  if (result?.status === 'IN_PROGRESS') return 'processing'
  if (result?.status === 'COMPLETED' || result?.images || result?.video) return 'completed'
  throw new Error('สถานะงานจาก fal ไม่ถูกต้อง')
}

function mediaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try { return new URL(value).protocol === 'https:' ? value : null } catch { return null }
}

function refs(raw?: string | null): string[] {
  if (!raw) return []
  const values = JSON.parse(raw)
  if (!Array.isArray(values) || values.some(v => typeof v !== 'string' || !v)) throw new Error('ภาพอ้างอิงไม่ถูกต้อง')
  return values
}

function error(result: any): string | undefined {
  return result?.error || result?.detail ? 'fal สร้างงานไม่สำเร็จ กรุณาตรวจโมเดลและข้อมูลที่ส่ง' : undefined
}

export class FalVideoAdapter implements VideoProviderAdapter {
  provider = 'fal'
  resolvePollResult = fetchFalResult
  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord) {
    let model = record.model || config.model || FAL_VIDEO_MODEL
    const imageModel = FAL_VIDEO_MODEL.replace('text-to-video', 'image-to-video')
    if (![FAL_VIDEO_MODEL, imageModel].includes(model)) throw new Error('fal วิดีโอรองรับ Kling 2.6 Pro')
    const images = refs(record.referenceImageUrls)
    const image = record.imageUrl || record.firstFrameUrl || images[0]
    if (images.length > 1 || record.lastFrameUrl || refs(record.referenceVideoUrls).length || refs(record.referenceAudioUrls).length || record.referenceFileUrl || record.referenceLinkUrl) {
      throw new Error('Kling 2.6 รองรับภาพเริ่มต้น 1 ภาพ ไม่มีภาพท้าย วิดีโอ หรือเสียงอ้างอิง')
    }
    if (image) model = imageModel
    if (model === imageModel && !image) throw new Error('Kling Image to Video ต้องมีภาพเริ่มต้น')
    const duration = record.duration ?? 5
    if (![5, 10].includes(duration)) throw new Error('Kling 2.6 รองรับความยาว 5 หรือ 10 วินาที')
    const ratio = record.aspectRatio || '16:9'
    if (!['16:9', '9:16', '1:1'].includes(ratio)) throw new Error('Kling รองรับสัดส่วน 16:9, 9:16 หรือ 1:1')
    return submit(config, model, { prompt: record.prompt, duration: String(duration),
      generate_audio: record.generateAudio !== false && record.generateAudio !== 0,
      ...(image ? { image_url: image } : { aspect_ratio: ratio }) })
  }
  parseGenerateResponse = queued
  buildPollRequest(config: AIConfig, taskId: string) { return tracking(config, taskId, 'status') }
  parsePollResponse(result: any) {
    const status = state(result)
    const videoUrl = this.extractVideoUrl(result) || undefined
    if (status === 'completed' && !videoUrl) return { status: 'failed' as const, error: 'fal ไม่ได้ส่งวิดีโอที่สร้างเสร็จ' }
    return { status, videoUrl, error: error(result) }
  }
  extractVideoUrl(result: any) { return mediaUrl(result?.video?.url) }
}
