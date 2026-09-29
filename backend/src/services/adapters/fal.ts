import { protectVideoSpeech } from '../h3-video-prompt.js'
import type { AIConfig, ProviderRequest, VideoProviderAdapter, VideoGenerationRecord } from './types'
import models from '../../../../shared/fal-video-models.json'

export const FAL_VIDEO_MODELS = models
export function falModelInfo(model: string) {
  return models.find(item => item.textModel === model || item.imageModel === model)
}

export const FAL_VIDEO_MODEL = 'minimax/h3-max/reference-to-video'

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
    const model = record.model || config.model || FAL_VIDEO_MODEL
    const info = falModelInfo(model)
    if (!info) throw new Error('ระบบรองรับเฉพาะ MiniMax H3 Max Reference to Video ผ่าน fal')
    const images = refs(record.referenceImageUrls)
    if(record.imageUrl && !images.includes(record.imageUrl)) images.unshift(record.imageUrl)
    const videos = refs(record.referenceVideoUrls), audio = refs(record.referenceAudioUrls)
    if(record.firstFrameUrl || record.lastFrameUrl || record.referenceFileUrl || record.referenceLinkUrl) throw new Error('Reference to Video ใช้ภาพอ้างอิง ไม่ใช้ช่องภาพเริ่มต้น/ภาพท้ายหรือไฟล์/ลิงก์ทั่วไป')
    if(images.length>info.maxImages || videos.length>info.maxVideos || audio.length>info.maxAudio || images.length+videos.length+audio.length>info.maxReferences) throw new Error('อ้างอิงได้สูงสุด 9 ภาพ, 3 วิดีโอ, 3 เสียง และรวมไม่เกิน 12 ไฟล์')
    if(!images.length && !videos.length && !audio.length) throw new Error('กรุณาเลือกภาพ วิดีโอ หรือเสียงอ้างอิงอย่างน้อย 1 ไฟล์')
    const prompt = String(record.prompt || '').trim()
    if(!prompt || prompt.length>info.maxPromptLength) throw new Error('คำสั่งสร้างวิดีโอต้องมีข้อความและไม่เกิน 50,000 ตัวอักษร')
    const duration=record.duration ?? info.defaultDuration
    if(!info.durations.includes(duration)) throw new Error('H3 Max รองรับความยาว 5–15 วินาที เป็นจำนวนเต็ม')
    const ratio=record.aspectRatio || '9:16'
    if(!info.ratios.includes(ratio)) throw new Error('สัดส่วนภาพไม่รองรับใน H3 Max')
    const raw=record.resolution || '720p'
    const resolution=({'480p':'480P','720p':'768P','1080p':'1080P'} as Record<string,string>)[raw] || raw
    if(!info.resolutions.includes(resolution)) throw new Error('H3 Max รองรับความละเอียด 480P, 768P, 1080P')
    const body: Record<string,unknown>={prompt:protectVideoSpeech(prompt),duration,resolution,aspect_ratio:ratio,prompt_expansion_mode:'disabled'}
    if(images.length) body.reference_image_urls=images
    if(videos.length) body.reference_video_urls=videos
    if(audio.length) body.reference_audio_urls=audio
    if(record.seed!=null) body.seed=record.seed
    return submit(config,FAL_VIDEO_MODEL,body)
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
