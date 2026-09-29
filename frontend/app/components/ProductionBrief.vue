<template>
  <details class="production-brief" :open="expanded" @toggle="expanded = $event.target.open">
    <summary>
      <strong>{{ editing ? 'แผนตัดต่อและส่งออก' : 'กรอบเวลาและการกำกับตอน' }}</strong>
      <span>{{ saved ? `${saved.timing_mode === 'maximum' ? 'ไม่เกิน' : 'เป้าหมาย'} ${formatTime(saved.target_seconds)}` : 'ยังไม่ได้กำหนดเวลา' }}</span>
      <span v-if="data?.timing?.shots" :class="{ warning: !data.timing.ok }">ช็อตรวม {{ formatTime(data.timing.seconds) }} · {{ data.timing.message }}</span>
      <span class="expand-label">{{ expanded ? 'ย่อ' : 'ตั้งค่า / ดูแผน' }}</span>
    </summary>
    <div class="production-body">
      <div class="brief-fields">
        <label>ความยาวต่อตอน (วินาที)<input v-model.number="form.target_seconds" class="input" type="number" min="5" max="3600" step="1" :disabled="busy" /></label>
        <label>รูปแบบเวลา<select v-model="form.timing_mode" class="input" :disabled="busy"><option value="maximum">ไม่เกินเวลานี้</option><option value="target">ใกล้เคียงเป้าหมาย ±5%</option></select></label>
        <label>สไตล์การเล่าและตัดต่อ<select v-model="form.preset" class="input" :disabled="busy"><option v-for="p in data?.presets || []" :key="p.id" :value="p.id">{{ p.label }}</option></select></label>
        <label>บทต้นฉบับ<select v-model="form.source_policy" class="input" :disabled="busy"><option value="preserve">รักษาบทเดิม</option><option value="adapt">อนุญาตให้ย่อและปรับบท</option></select></label>
        <label>จบตอนแบบ<select v-model="form.ending_policy" class="input" :disabled="busy"><option value="cliffhanger">ทิ้งปมตอนต่อไป</option><option value="complete">จบครบในตอน</option></select></label>
      </div>
      <p class="brief-hint">{{ selectedPreset?.guidance }} <template v-if="form.timing_mode === 'target'">ช่วงเป้าหมาย {{ formatTime(form.target_seconds * .95) }}–{{ formatTime(form.target_seconds * 1.05) }}</template></p>
      <label class="creative-label">โจทย์ให้ AI คิดเรื่อง / แนวทางกำกับ<textarea v-model="form.creative_brief" class="input" rows="2" maxlength="10000" placeholder="เช่น ซีรีส์จีนย้อนยุค พระเอกช่วยนางเอกที่ถูกชิงบัลลังก์ จบตอนด้วยคำสัตย์" :disabled="busy" /></label>
      <p v-if="dirty" class="warning">มีค่าที่ยังไม่บันทึก บันทึกก่อนให้ Codex ทำงาน การเปลี่ยนค่าจะทำให้แผนเดิมต้องตรวจใหม่</p>
      <div class="brief-actions">
        <button class="btn btn-sm" :disabled="busy || !dirty" @click="save">บันทึกกรอบเวลา</button>
        <template v-if="!editing">
          <button class="btn btn-sm" :disabled="busy || dirty || !saved" @click="agent('storyboard_breaker', directorMessage)">ให้ผู้กำกับวางแผน</button>
          <button class="btn btn-sm" :disabled="busy || dirty || !saved || !form.creative_brief.trim()" @click="agent('script_rewriter', writerMessage)">คิด / ปรับบทตามกรอบเวลา</button>
        </template>
        <template v-else>
          <button class="btn btn-sm" :disabled="busy || dirty || !saved || !data?.timing?.ready_clips" @click="agent('editor', editorMessage)">ให้ Editor วางแผน · Codex</button>
          <button class="btn btn-sm" :disabled="busy || dirty || !editPlan || editPlan.stale" @click="render(true)">เรนเดอร์ฉบับร่าง</button>
          <button class="btn btn-sm" :disabled="busy || dirty || !editPlan || editPlan.stale" @click="render(false)">ส่งออกตามแผน</button>
        </template>
        <button class="btn btn-sm" :disabled="busy" @click="load()">ตรวจสถานะใหม่</button>
      </div>
      <p v-if="busy" role="status" aria-live="polite">{{ status }} · กรุณารอ</p>
      <p v-if="error" class="warning" role="alert">{{ error }}</p>
      <p v-else-if="status" role="status" aria-live="polite">{{ status }}</p>
      <template v-if="editing">
        <p class="brief-hint">คลิปพร้อม {{ data?.timing?.ready_clips || 0 }}/{{ data?.timing?.shots || 0 }} · รุ่นนี้ตรวจความยาวไฟล์และข้อมูลคลิป ยังไม่ได้ตรวจเสียงหรือภาพเคลื่อนไหว จึงรักษาคลิปที่มีบทพูดหรือเสียงทั้งช่วง</p>
        <div v-if="editPlan" class="plan-card">
          <strong>แผนตัดต่อ #{{ editPlan.id }} · {{ formatTime(editPlan.plan.duration_ms / 1000) }}</strong>
          <p v-if="editPlan.stale" class="warning">บท กรอบเวลา หรือคลิปเปลี่ยนแล้ว กรุณาวางแผนใหม่</p>
          <p>{{ editPlan.plan.summary }}</p>
          <div class="plan-table"><table><thead><tr><th>ช็อต</th><th>ช่วงที่ใช้</th><th>เหตุผล</th></tr></thead><tbody><tr v-for="e in editPlan.plan.entries" :key="e.storyboard_id"><td>#{{ e.storyboard_id }}</td><td>{{ (e.in_ms / 1000).toFixed(2) }}–{{ (e.out_ms / 1000).toFixed(2) }} วินาที</td><td>{{ e.reason }}</td></tr></tbody></table></div>
        </div>
      </template>
      <div v-else-if="directorPlan" class="plan-card">
        <strong>แผนผู้กำกับ #{{ directorPlan.id }}</strong><p v-if="directorPlan.stale" class="warning">ข้อมูลเปลี่ยนแล้ว กรุณาวางแผนใหม่</p><p>{{ directorPlan.plan.summary }}</p>
        <ol><li v-for="(b,i) in directorPlan.plan.beats" :key="i">{{ b.title }} · {{ b.seconds }} วินาที — {{ b.purpose }}{{ b.protected ? ' (เหตุการณ์สำคัญ)' : '' }}</li></ol>
      </div>
    </div>
  </details>
</template>
<script setup lang="ts">
import { api } from '~/composables/useApi'
const props=defineProps<{episodeId:number;dramaId:number;editing?:boolean;externalBusy?:boolean}>()
const emit=defineEmits<{changed:[];working:[boolean]}>()
const expanded=ref(false), data=ref<any>(null), saved=ref<any>(null), working=ref(false), error=ref(''), status=ref('')
const form=reactive({target_seconds:60,timing_mode:'maximum',preset:'standard',creative_brief:'',source_policy:'preserve',ending_policy:'cliffhanger'})
const busy=computed(()=>working.value||props.externalBusy)
const dirty=computed(()=>!saved.value || Object.keys(form).some(k=>(form as any)[k]!==saved.value[k]))
const selectedPreset=computed(()=>data.value?.presets?.find((p:any)=>p.id===form.preset))
const directorPlan=computed(()=>data.value?.plans?.find((p:any)=>p.kind==='director'))
const editPlan=computed(()=>data.value?.plans?.find((p:any)=>p.kind==='edit'))
const directorMessage='Read production context and save a director plan using save_director_plan. Plan story beats and allocate time including dialogue, actions and pauses within the episode budget. Use creative brief if script is empty. Do not call save_script, save_storyboards or update_storyboard. Only save the director plan, then report briefly in Thai.'
const writerMessage='Read production context and director plan, then create or revise the full screenplay within the episode time budget. Use creative brief for new source. Preserve existing script/source unless source_policy is adapt. If the existing source cannot fit without forbidden changes, explain and do not overwrite it. Actually save_script when successful. Do not change shots or media.'
const editorMessage='Read actual edit context, and save a complete edit plan according to selected preset and time budget. Protected clips must remain whole. Preserve all shots and order except teaser. Do not claim audiovisual review: available evidence is metadata only. Explain if impossible without cutting protected content; do not save an invalid plan.'
function formatTime(seconds:number) { if(!Number.isFinite(seconds)) return '—'; const rounded=Math.round(seconds);return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')}` }
async function load(reset=false) {
 if(!props.episodeId) return
 try {const keepDraft=Boolean(saved.value)&&dirty.value&&!reset;data.value=await api.get(`/episodes/${props.episodeId}/production`);if(!keepDraft){saved.value=data.value.brief;if(saved.value) Object.keys(form).forEach(k=>(form as any)[k]=saved.value[k])}}
 catch(e:any){error.value=e.message}
}
async function save() {
 working.value=true;error.value=''
 try {await api.put(`/episodes/${props.episodeId}/production`,{brief:{...form},expected_revision:saved.value?.revision||0});await load(true);status.value='บันทึกกรอบเวลาแล้ว';emit('changed')}
 catch(e:any){error.value=e.message} finally{working.value=false}
}
async function agent(type:string,message:string) {
 working.value=true;emit('working',true);error.value='';status.value='Codex กำลังทำงานในเครื่อง'
 try {const result=await api.post<any>(`/agent/${type}/chat`,{message,episode_id:props.episodeId,drama_id:props.dramaId});status.value=result.text||'Codex ทำงานเสร็จแล้ว';await load();emit('changed')}
 catch(e:any){error.value=e.message;status.value=''}finally{working.value=false;emit('working',false)}
}
async function render(draft:boolean) {
 working.value=true;error.value=''
 try {await api.post(`/episodes/${props.episodeId}/production/render`,{plan_id:editPlan.value.id,draft});status.value='เข้าคิวเรนเดอร์แล้ว ดูผลในรายการฉบับส่งออก';emit('changed')}
 catch(e:any){error.value=e.message}finally{working.value=false}
}
watch(()=>props.episodeId,()=>{saved.value=null;data.value=null;error.value='';status.value='';load()},{immediate:true})
defineExpose({load})
</script>
<style scoped>
.production-brief{flex-shrink:0;border-bottom:1px solid var(--border);background:var(--bg-1);font-size:12px}
summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;cursor:pointer;list-style:none}
summary span{color:var(--text-2)}.expand-label{margin-left:auto;color:var(--accent)!important}
.production-body{padding:4px 16px 16px;max-height:48vh;overflow:auto;display:flex;flex-direction:column;gap:12px}
.brief-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
label{display:flex;flex-direction:column;gap:6px;color:var(--text-1)}.input{width:100%;min-width:0;font:inherit}
.brief-actions{display:flex;gap:8px;flex-wrap:wrap}.brief-hint{color:var(--text-2);margin:0;line-height:1.6}.warning{color:#ffb477!important;margin:0}.plan-card{padding:12px;border:1px solid var(--border);border-radius:12px;line-height:1.7}.plan-card p{margin:6px 0}.plan-table{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}td,th{padding:8px;border-bottom:1px solid var(--border)}
</style>
