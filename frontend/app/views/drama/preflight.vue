<template>
  <main class="review-page">
    <header class="review-head card">
      <NuxtLink :to="`/drama/${dramaId}`" class="btn">{{ t('common.back') }}</NuxtLink>
      <div><p class="eyebrow">{{ t('preflight.eyebrow') }}</p><h1>{{ drama?.title || t('preflight.title') }}</h1><p>{{ t('preflight.intro') }}</p></div>
      <button class="btn" :disabled="loading" @click="refresh">{{ t('common.refresh') }}</button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">{{ t('preflight.loading') }}</p>
    <template v-if="episode">
      <nav class="review-toolbar">
        <label>{{ t('preflight.episode') }} <select v-model="episodeId" class="input"><option v-for="ep in drama.episodes" :key="ep.id" :value="ep.id">EP{{ ep.episode_number }} · {{ ep.title }}</option></select></label>
        <label><input v-model="guides" type="checkbox" /> {{ t('preflight.guides') }}</label>
        <NuxtLink :to="`/drama/${dramaId}/episode/${episode.episode_number}`" class="btn btn-primary">{{ t('preflight.workbench') }}</NuxtLink>
        <NuxtLink to="/settings" class="btn">{{ t('preflight.setup') }}</NuxtLink>
      </nav>
      <section class="readiness card">
        <h2>{{ episode.title }} <span>{{ total }}s · {{ shots.length }} {{ t('preflight.shots') }} · {{ drama.aspect_ratio }}</span></h2>
        <ul><li v-for="check in checks" :key="check.label" :class="{ passed: check.ok }">{{ check.ok ? '✓' : '○' }} {{ check.label }}</li></ul>
        <p>{{ t('preflight.stop') }}</p><p class="muted">{{ t('preflight.audioNote') }}</p>
        <p v-if="!hasVideoConfig" class="muted">{{ t('preflight.noKey') }}</p>
      </section>
      <section><h2>{{ t('preflight.storyboard') }}</h2>
        <div class="shot-grid">
          <article v-for="(shot, index) in shots" :key="shot.id" class="shot-card card">
            <div class="frame">
              <a v-if="shotImage(shot)" :href="shotImage(shot)" target="_blank" rel="noopener" :aria-label="t('preflight.fullImage')">
                <img :src="shotImage(shot)" :alt="shot.title || `${index + 1}`" @load="recordImage(shot.id, $event)" @error="imageStates[shot.id] = 'error'" />
              </a>
              <span v-else class="missing">{{ t('preflight.noImage') }}</span>
              <div v-if="guides" class="frame-guide" aria-hidden="true"></div>
              <span class="time-badge">{{ timeBefore(index) }}–{{ timeBefore(index) + Number(shot.duration || 0) }}s</span>
            </div>
            <div class="shot-info"><h3>{{ shot.title || `${index + 1}` }}</h3><p class="action">{{ shot.description }}</p>
              <p v-if="imageStates[shot.id] === 'error'" class="error-text">{{ t('preflight.imageError') }}</p>
              <p v-else-if="imageStates[shot.id] === 'ratio'" class="error-text">{{ t('preflight.ratioError') }}</p>
              <details><summary>{{ t('preflight.videoPrompt') }}</summary><p class="prompt">{{ shot.video_prompt || t('preflight.missingPrompt') }}</p></details>
            </div>
          </article>
        </div>
      </section>
      <section><h2>{{ t('preflight.assets') }}</h2><div class="asset-grid">
        <article v-for="asset in assets" :key="`${asset.kind}-${asset.id}`" class="card asset-card">
          <a v-if="asset.image_url" :href="asset.image_url" target="_blank" rel="noopener"><img :src="asset.image_url" :alt="asset.name || asset.location" @load="imageStates[`${asset.kind}-${asset.id}`] = 'ok'" @error="imageStates[`${asset.kind}-${asset.id}`] = 'error'" /></a>
          <h3>{{ asset.name || asset.location }}</h3><p>{{ asset.description || asset.appearance || asset.prompt }}</p>
        </article>
      </div></section>
      <section class="card script-card"><h2>{{ t('preflight.script') }}</h2><pre>{{ episode.script_content }}</pre></section>
    </template>
    <p v-else-if="!loading">{{ t('preflight.noEpisode') }}</p>
  </main>
</template>

<script setup>
import { dramaAPI, episodeAPI, aiConfigAPI } from '~/composables/useApi'
const { t } = useI18n()
const route = useRoute()
const dramaId = Number(route.params.id)
const drama = ref(null)
const episodeId = ref(null)
const episode = computed(() => drama.value?.episodes?.find(ep => ep.id === Number(episodeId.value)))
const shots = ref([])
const configs = ref([])
const loading = ref(false)
const error = ref('')
const guides = ref(false)
const imageStates = reactive({})
let requestVersion = 0
const total = computed(() => shots.value.reduce((n, s) => n + Number(s.duration || 0), 0))
const hasVideoConfig = computed(() => configs.value.some(c => c.service_type === 'video' && c.is_active && c.api_key))
const assets = ref([])
const checks = computed(() => [
  { ok: drama.value?.aspect_ratio === '9:16', label: t('preflight.vertical') },
  { ok: total.value > 0 && total.value <= 60, label: t('preflight.timeCheck', { n: total.value }) },
  { ok: !!episode.value?.script_content?.trim(), label: t('preflight.scriptCheck') },
  { ok: shots.value.length > 0 && shots.value.every(s => imageStates[s.id] === 'ok'), label: t('preflight.imageCheck', { n: shots.value.filter(s => imageStates[s.id] === 'ok').length, total: shots.value.length }) },
  { ok: shots.value.length > 0 && shots.value.every(s => s.video_prompt?.trim()), label: t('preflight.promptCheck') },
  { ok: assets.value.length > 0 && assets.value.every(a => a.image_url && imageStates[`${a.kind}-${a.id}`] === 'ok'), label: t('preflight.assetCheck') },
])
function shotImage(s) { return s.first_frame_image || s.composed_image || '' }
function timeBefore(i) { return shots.value.slice(0, i).reduce((n, s) => n + Number(s.duration || 0), 0) }
function recordImage(id, event) { const im = event.target; imageStates[id] = Math.abs(im.naturalWidth / im.naturalHeight - 9 / 16) < .01 ? 'ok' : 'ratio' }
async function loadShots() {
  const version = ++requestVersion
  for (const key of Object.keys(imageStates)) delete imageStates[key]
  shots.value = []
  assets.value = []
  if (!episodeId.value) return
  try {
    const id = Number(episodeId.value)
    const [data, characters, scenes, props] = await Promise.all([episodeAPI.storyboards(id), episodeAPI.characters(id), episodeAPI.scenes(id), episodeAPI.props(id)])
    if (version !== requestVersion) return
    shots.value = [...data].sort((a,b) => a.storyboard_number - b.storyboard_number)
    assets.value = Object.entries({ characters, scenes, props }).flatMap(([kind, items]) => items.map(a => ({ ...a, kind })))
  }
  catch (e) { if (version === requestVersion) error.value = e.message }
}
async function refresh() {
  loading.value = true; error.value = ''
  try {
    const data = await dramaAPI.get(dramaId)
    drama.value = data
    try { configs.value = await aiConfigAPI.list() } catch { configs.value = [] }
    const selected = data.episodes.find(ep => ep.id === Number(episodeId.value))
    const next = selected?.id || [...data.episodes].sort((a,b) => a.episode_number - b.episode_number)[0]?.id || null
    if (episodeId.value === next) await loadShots(); else episodeId.value = next
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
watch(episodeId, loadShots)
onMounted(refresh)
</script>

<style scoped>
.review-page { max-width: 1480px; margin: 0 auto; padding: 28px; color: var(--text-primary); }
.review-head { padding: 24px; display: flex; gap: 24px; align-items: center; }
.review-head > div { flex: 1; }.eyebrow { font-size: 12px; letter-spacing: .08em; opacity: .65; margin: 0; }
h1 { font-size: clamp(24px, 3vw, 40px); margin: 6px 0; }h2 { margin: 28px 0 16px; font-size: 22px; }h3 { margin: 0 0 10px; font-size: 16px; }
.review-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin: 24px 0; }.review-toolbar label { display: flex; align-items: center; gap: 8px; }.readiness { padding: 24px; }.readiness h2 { margin: 0 0 16px; }.readiness h2 span { display: inline-block; margin-left: 12px; font-size: 14px; font-weight: 400; }.readiness ul { padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 12px 24px; }.readiness li { color: var(--text-secondary); }.readiness li.passed { color: #32b989; }.muted { opacity: .72; font-size: 13px; line-height: 1.6; }
.shot-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }.shot-card { overflow: hidden; }.frame { aspect-ratio: 9/16; position: relative; background: #080d13; }.frame a { display: block; width: 100%; height: 100%; }.frame img { width: 100%; height: 100%; object-fit: contain; display: block; }.frame-guide { position: absolute; inset: 8% 15% 24% 6%; border: 1px dashed #fbd59a; pointer-events: none; }.time-badge { position: absolute; top: 10px; left: 10px; color: white; background: #0c121bd9; padding: 4px 8px; border-radius: 5px; font-size: 12px; pointer-events: none; }.missing { position: absolute; inset: 0; display: grid; place-items: center; color: #aaa; }.shot-info { padding: 16px; }.action { white-space: pre-line; font-size: 13px; line-height: 1.7; }.prompt { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; }.error-text { color: #ef8d8d; }.shot-info summary { cursor: pointer; font-size: 13px; }
.asset-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }.asset-card { padding: 14px; }.asset-card img { width: 100%; height: 260px; object-fit: contain; background: #080d13; display: block; margin-bottom: 14px; }.asset-card p { font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }.script-card { margin-top: 28px; padding: 24px; }.script-card h2 { margin-top: 0; }.script-card pre { font: inherit; white-space: pre-wrap; line-height: 1.8; overflow-wrap: anywhere; }
@media (max-width: 1100px) { .shot-grid,.asset-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .review-page { padding: 14px; }.review-head { padding: 16px; gap: 12px; flex-wrap: wrap; }.shot-grid,.asset-grid { grid-template-columns: 1fr; }.asset-card img { height: 340px; } }
</style>
