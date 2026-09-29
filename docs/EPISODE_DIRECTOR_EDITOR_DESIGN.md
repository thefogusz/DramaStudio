# แบบระบบ: กรอบเวลา EP และ Codex Director / Editor

สถานะ: เพิ่มกรอบเวลา, Director ในผู้ช่วยแบ่งช็อตเดิม, Editor แบบ metadata และเรนเดอร์ตาม EDL แล้ว; การตรวจภาพ/เสียงเชิงความหมายยังเป็นงานต่อยอด
วันที่: 2026-09-29

## 1. เป้าหมายและขอบเขต

ผู้ใช้กำหนดเวลาต่อตอนและสไตล์การเล่าก่อนให้ AI คิดบท ข้อมูลชุดเดียวกันใช้ในการเขียนบท แบ่งช็อต สร้างคลิป และตัดต่อ โดย Director / Editor ใช้ Codex ในเครื่อง ส่วนวิดีโอใช้ผู้ให้บริการที่ผู้ใช้ตั้งค่าไว้

รอบแรกให้ผู้ใช้สร้างบท/ช็อต ตรวจแผน แล้วสั่งทำแต่ละขั้นอย่างชัดเจน ไม่สร้างวิดีโอที่มีค่าใช้จ่ายโดยอัตโนมัติ เมื่อมีคลิปแล้วจึงสร้างแผนตัดต่อจริงและเรนเดอร์ในเครื่อง

ขอบเขตไม่รวมการติดตั้งบริการตัดต่อบนคลาวด์หรือเพิ่ม LLM API ไม่ถือว่าการอ่านบทเท่ากับการตรวจวิดีโอจริง

## 2. สิ่งที่พบในระบบปัจจุบัน

- episodes.duration เก็บเวลารวมช็อต ไม่ใช่เวลาที่ผู้ใช้ตั้งเป้าหมาย
- script-tools.ts อ่าน/เขียนบท แต่ยังไม่ส่งกรอบเวลาของตอนเข้า Agent
- storyboard_breaker มีค่าเริ่มต้นประมาณเวลาจากจำนวนตัวอักษร พร้อมช่วงช็อต 8–15 วินาที ซึ่งไม่เหมาะจะบังคับกับทุกภาษาและทุกโมเดล
- ffmpeg-merge.ts รวมคลิปที่มีตามเลขช็อต ยังไม่มีช่วงตัดเข้า/ออกหรือแผนจาก Editor
- มี native Codex queue, Agent tools, การตรวจ revision และ export context ให้ต่อยอดได้
- preset ตัดต่อเป็นแนวทางจังหวะเรื่อง แยกจาก preset สไตล์ภาพและโมเดลวิดีโอ

## 3. เส้นทางใช้งานและหน้าจอภาษาไทย

### สร้างเรื่อง / สร้างตอน

แสดงการ์ด “กรอบเวลาและการเล่าเรื่อง” ก่อนปุ่มคิดบท:

- วิธีเริ่ม: “ให้ AI คิดเรื่อง” / “ใช้บทของฉัน”
- โจทย์เรื่อง และจำนวนตอน กรณีเริ่มทั้งซีรีส์
- “ความยาวต่อตอน”: 30 วินาที / 1 นาที / 3 นาที / 5 นาที / กำหนดเอง
- “รูปแบบเวลา”: “ใกล้เคียงเป้าหมาย” / “ไม่เกินเวลานี้”
- “สไตล์การเล่าและตัดต่อ”: ตัวเลือก preset พร้อมคำอธิบาย
- “จบตอนแบบ”: จบครบในตอน / ทิ้งปมตอนต่อไป
- สัดส่วนภาพใช้ค่าจากเรื่อง ไม่ซ้ำการตั้งค่าที่มีอยู่

ค่าแนะนำสำหรับตอนใหม่: 60 วินาที แบบไม่เกิน, ซีรีส์มาตรฐาน ผู้ใช้เปลี่ยนได้ก่อนเริ่มคิดบท ค่าของเรื่องเป็นค่าเริ่มต้นสำหรับตอนใหม่ ไม่เขียนทับตอนเก่า

เมื่อใช้บทเดิมให้เลือก “รักษาบทเดิม” หรือ “อนุญาตให้ย่อและปรับบท” ถ้าบทไม่พอดีเวลาแสดงทางเลือกก่อนแก้ ไม่ลบบทส่วนเกินเงียบ ๆ

### หน้าทำตอน

การ์ดกรอบเวลาอยู่เหนือบท/ช็อต อ่านได้ทุกขั้น แสดงแยก:

- เป้าหมาย: ไม่เกิน 3:00
- เวลาบทโดยประมาณ: 2:48 — ยังไม่ใช่ความยาวคลิปจริง
- เวลาช็อตที่วางแผน: 2:55
- คลิปพร้อม: 12/18 ช็อต
- ความยาวหลังตัดต่อ: 2:51 — เมื่อมีแผนจากคลิปจริงแล้ว

ปุ่ม: “บันทึกกรอบเวลา”, “ให้ผู้กำกับวางแผน”, “ปรับบทให้พอดีเวลา”

แก้เวลา/preset ไม่สั่ง Agent เอง แสดง “แผนเดิมต้องตรวจใหม่” และรักษาบท ช็อต รูป คลิปเดิม การเปลี่ยนช็อตที่มีคลิปแล้วให้แสดงรายการที่ต้องสร้างใหม่ก่อนยืนยันงาน

### รวมคลิปและส่งออก

เรียงแนวตั้งให้มีพื้นที่สำหรับ:

1. เลือก “รวมคลิปตามลำดับ” หรือ “ตัดต่อด้วย Codex”
2. เลือก preset และเวลาฉบับส่งออก (ไม่เขียนทับกรอบเวลาหลักของ EP)
3. กด “ให้ Editor วิเคราะห์คลิป”
4. ดูแผน: คลิปต้นทาง, ช่วงเวลาเข้า/ออก, ระยะเวลาที่ใช้, เหตุผล, บทพูดที่รักษาไว้
5. ดูคำเตือน/ช็อตที่ยังขาด และดูตัวอย่างฉบับร่าง
6. กด “เรนเดอร์ตามแผน” แล้วดาวน์โหลดหรือกลับไปปรับแผน

อนุญาตเลือกส่งออกบางช็อต แต่ติดป้าย “ฉบับบางส่วน” ไม่แสดงว่าตอนสมบูรณ์ เก็บประวัติแต่ละเวอร์ชันและเก็บไฟล์ต้นฉบับ

## 4. ความหมายของเวลา

ใช้วินาทีในการจัดเก็บ และแสดงนาที:วินาทีใน UI

- target_seconds: เวลาเป้าหมาย
- timing_mode: target / maximum
- tolerance_seconds: target อนุญาตช่วง ±5% โดยแสดงช่วงก่อนบันทึก maximum ไม่อนุญาตเกินเพดาน
- planned_seconds: ผลรวมเวลาช็อต เป็นเวลาแผน
- measured_source_seconds: เวลาที่ probe ได้จากคลิปจริง
- edit_timeline_seconds: ระยะเวลาของแผน รวมชื่อเรื่อง/ปิดท้าย และหักช่วง transition ที่ซ้อนกัน
- rendered_seconds: ระยะเวลาที่ probe ได้จากไฟล์ส่งออก

ไม่ใช้จำนวนตัวอักษรหารอัตราภาษาจีนเป็นตัวตัดสินสำหรับบทไทย ให้ Director แจกเวลาเป็น beat: บทพูด การกระทำ และช่วงพัก ระบุช่วงที่เกิดพร้อมกันเพื่อไม่บวกเวลาซ้ำ ประมาณเสียงได้ก่อนผลิต แต่ใช้เสียงจริง/เวลา subtitle ที่ตรวจแล้วเป็นหลักหลังมีคลิป

ไม่ยืดบทด้วยเหตุการณ์ซ้ำเพื่อให้เต็มเวลา และไม่เร่งเสียงทั้งตอนเพื่อแก้บทที่ล้นเวลา เวลาต่อช็อตต้องตรวจจาก shared/fal-video-models.json ตัวอย่างโมเดลที่รองรับ 5–15 วินาทีสามารถสร้างต้นฉบับ 5 วินาทีแล้วตัดใช้ 3 วินาทีได้ แต่ต้องเผื่อการแสดงและต้นทุนต้นฉบับแยกจากเวลาส่งออก

## 5. หน้าที่ Agent และสกิล

Director (ขยาย storyboard_breaker เดิม ไม่เพิ่ม agent_type ใหม่):
- อ่านโจทย์ กรอบเวลา บท ตัวละคร ความต่อเนื่อง และโมเดลที่เลือก
- สร้าง beat plan พร้อมเวลาบทพูด/การกระทำ จุดเปิด จุดพีค จุดจบ และเหตุการณ์ที่ห้ามตัด
- ตรวจความเป็นไปได้ของกรอบเวลา ส่งปัญหาที่ต้องแก้ให้ผู้ใช้หรือ script_rewriter
- ไม่เปลี่ยนบทหรือช็อตผ่าน tool ของ Editor

script_rewriter: ใช้ brief + director plan เขียน/ปรับบท แล้วส่ง timing estimate
storyboard_breaker: ใช้ brief + บท + beat plan + ข้อจำกัดโมเดล บันทึกช็อตให้ครบและตรวจผลรวมหลังบันทึกชุดสุดท้าย
prompt_generator: รักษาเวลา บทพูด และเหตุการณ์ของช็อต ไม่ขยายเรื่องเอง

Editor (เพิ่ม agent_type: editor):
- อ่านคลิปจริง metadata และหลักฐานภาพ/เสียงที่ตรวจได้
- สร้าง edit decision list ตาม preset พร้อมเหตุผลและข้อจำกัด
- เก็บ protected beats/dialogue และตรวจเรื่องต่อเนื่อง ห้ามสร้างเนื้อหาใหม่ที่ไม่มีคลิป
- บันทึกแผนเท่านั้น ไม่ส่งคำสั่ง shell/FFmpeg อิสระ

เพิ่มสกิลเฉพาะใน workspace ของแอป: series-director, episode-timing, vertical-series-editor, edit-continuity-review ให้เชื่อมผ่าน Agent settings ที่มีอยู่ ไม่ถือว่าติดตั้งสกิลใน Codex desktop แล้วแอปจะใช้โดยอัตโนมัติ

ใช้ cinematography ที่ติดตั้งอยู่เป็นฐานภาษาภาพ/การกำกับ สกิล video-editing ที่สำรวจเป็น workflow ของ Higgsedit จึงไม่ต้องใช้เป็น dependency ของระบบ FFmpeg นี้ และไม่ติดตั้งสกิลจำนวนมากโดยไม่ตรวจเครื่องมือและรูปแบบ output ที่ต้องใช้

## 6. Preset รุ่นแรก

| ID | ชื่อ | นโยบาย |
| --- | --- | --- |
| standard | ซีรีส์มาตรฐาน | ลำดับต่อเนื่อง รักษาบทสนทนาและเหตุการณ์หลัก ตัดช่วงนิ่งที่ไม่จำเป็น |
| cliffhanger | เน้นลุ้นตอนต่อไป | เปิดด้วย hook รักษาปมและการปูเรื่อง จบที่ cliffhanger จากบทที่มีอยู่ |
| emotional | ดราม่าเน้นอารมณ์ | ให้เวลากับปฏิกิริยาและช่วงเงียบ ใช้ transition เท่าที่รองรับอารมณ์ |
| reels_fast | กระชับสำหรับ Reels | ลดช่วงซ้ำและช่วงรอ รักษาความเข้าใจ ไม่ตัดกลางประโยค |
| teaser | ตัวอย่างตอน | เลือกฉากเด่น สร้างฉบับส่งออกแยก ลดการเปิดเผยบทสรุป |

Preset มี version, pacing guidance, transition allowlist, dialogue protection, ending policy และ duration policy ไม่กำหนดความยาวช็อตตายตัวให้ทุกฉาก Director ใช้ preset ตอนวางเรื่อง Editor ใช้ตอนตัดจริง การเปลี่ยนตอนท้ายไม่รับประกันว่าจะได้สไตล์ใหม่ครบถ้าวัตถุดิบไม่รองรับ

## 7. ข้อมูลและ API ที่เสนอ

เพิ่ม episode_production_briefs (หนึ่งค่าปัจจุบันต่อตอน + revision): episode_id, target_seconds, timing_mode, tolerance_seconds, edit_preset_id/version, ending_policy, source_policy, creative_brief, revision, updated_at
เพิ่ม drama_production_defaults สำหรับค่าเริ่มต้นตอนใหม่ โดยไม่เปลี่ยน semantics ของ episodes.duration
เพิ่ม production_plans: episode_id, kind(director/edit), version, input_fingerprint, brief_revision, preset_version, status, plan_json, evidence_json, created_at
เพิ่ม export_renders หรือขยาย video_merges โดย migration: plan_id, output_kind, measured_duration, validation_report, source snapshot

API ที่เสนอ (ทุก route ตรวจ drama/episode scope, soft deletion และ schema):
- GET/PUT /episodes/:id/production-brief — PUT ต้อง expected_revision
- POST /episodes/:id/director-plan — native queue, คืน job_id
- GET /episodes/:id/production-plans — แผน/หลักฐาน/สถานะ
- POST /episodes/:id/editor-plan — clip IDs, preset override, export timing และ expected fingerprint
- POST /episodes/:id/exports — plan_id, draft/final, expected fingerprint
- GET /episodes/:id/timing — เวลาแผน เวลาไฟล์จริง ช็อตขาด และ validation

เพิ่ม tools แบบเจาะจง: read_production_brief, read_director_context, save_director_plan, read_edit_context, save_edit_plan ทุก tool ใช้ native scope/revision guard เดิม exportNativeContext ต้องรวม brief/plan revision ด้วย

ตัวอย่าง edit entry: { storyboard_id: 10, source_task_id: 25, source_hash: "...", in_ms: 250, out_ms: 4750, transition_out: { type: "cut", duration_ms: 0 }, protected_dialogue_ids: ["line-1"], reason: "รักษาบทเปิดและลดช่วงก่อนเริ่มพูด" }

เวลาใน EDL ใช้ integer milliseconds/frame-aware quantization เพื่อลดความคลาดเคลื่อน รายการ source ต้องอ้าง ID ของแอป ไม่รับ arbitrary filesystem path จาก Agent

## 8. การตรวจคลิปจริงและการเรนเดอร์

ขั้นแรก probe ไฟล์ที่แอปเป็นเจ้าของด้วย ffprobe: duration, fps, dimensions, audio streams พร้อม hash ใช้ frame/contact sheet, waveform และ dialogue intervals เมื่อมีเครื่องมือที่ตรวจได้ บันทึกวิธีตรวจและความมั่นใจ

Codex text adapter ปัจจุบันเป็นงานข้อความ ไม่สมมติว่าอ่านวิดีโอ/ฟังเสียงได้ ต้องเพิ่ม evidence collector และ worker ที่รองรับภาพอย่างชัดเจน ถ้าไม่มีหลักฐานเสียงหรือ timing บทพูดที่เชื่อถือได้ ให้รักษาช่วงมีบทพูดทั้งคลิป และระบุว่า “ยังไม่ได้ตรวจจังหวะเสียง” แทนการอ้างว่าตัดตามเสียงแล้ว

ตัวตรวจ EDL ฝั่ง server ตรวจ: source อยู่ในตอนนี้/มีไฟล์, 0 <= in < out <= source duration, ลำดับ/protected beats, dialogue coverage, transition duration, total runtime, resolution/aspect/fps/audio normalization, preset/version/fingerprint

FFmpeg compiler สร้าง arguments จากแผนที่ผ่าน schema ใช้ trim/atrim, setpts/asetpts, concat, xfade/acrossfade ตาม allowlist normalize ขนาด/fps/timebase และจัดการคลิปไม่มีเสียง ผู้ใช้ไม่ต้องเห็นคำสั่ง FFmpeg มี draft render ก่อน final

หลังเรนเดอร์ probe ไฟล์และตรวจกรอบเวลาจริง หากเกิน maximum ห้ามขึ้น completed ตรวจความคลาดเคลื่อนระดับ frame และปรับ trim/วางแผนใหม่อย่างมีเหตุผล ห้ามซ่อนการเกินด้วยเลขปัดเศษ

ไม่เพิ่มเพลง/เสียง/ซับที่ยังไม่มีไฟล์ แสดงสถานะส่วนนั้นตามจริง

## 9. สถานะ ความล้มเหลว และการเปลี่ยนข้อมูล

สถานะ: draft → planning → ready / needs_changes → rendering → completed / failed
แผนที่ input เปลี่ยนเป็น stale แสดง “บทหรือคลิปเปลี่ยนแล้ว กรุณาวิเคราะห์ใหม่”
Fingerprint รวม brief revision, script hash, storyboard fields, selected source IDs/hashes และ preset version ตรวจซ้ำก่อนเรนเดอร์ รวมข้อมูลที่อ่านได้ระหว่างงานเพื่อป้องกัน race

แยกคิวงาน Codex กับคิวเรนเดอร์ CPU จำกัด concurrency มี timeout/cancel และ cleanup ไฟล์ temp ของงานนั้นเท่านั้น retry ต้องไม่สร้างเวอร์ชันซ้ำโดยใช้ idempotency key เก็บ error ภาษาไทยและรายละเอียด log สำหรับตรวจระบบ

ข้อผิดพลาดที่แสดงได้: “บทพูดยาวเกินเวลาที่ตั้งไว้”, “ยังขาดคลิป 3 ช็อต”, “แผนนี้อ้างอิงคลิปเวอร์ชันเก่า”, “ตัดช่วงนี้แล้วบทพูดจะขาด”, “ความยาวไฟล์ส่งออกเกินกรอบเวลา”

## 10. แผนพัฒนาเป็นขั้น

1. Brief + UI เวลาต่อตอน + defaults + migration/API/context พร้อมตัวตรวจกรอบเวลา
2. ขยาย script_rewriter ให้คิดบทจากโจทย์ และ storyboard_breaker ให้ทำหน้าที่ Director + timing estimate เชื่อม tools เดิม ลดกฎจำนวนตัวอักษรเดิม
3. Preset UI + Edit plan schema + FFmpeg compiler เริ่ม standard แบบตัดตรงก่อน ให้การรวมเดิมยังทำงาน
4. Clip evidence + Editor native + draft preview + ป้องกันตัดบทพูด
5. preset อื่น/transition/audio/subtitles ที่มี asset พร้อมประวัติ exports

แต่ละขั้นต้องให้สถานะ UI ตรงกับความสามารถจริง ไม่แสดง Editor พร้อมใช้ก่อน worker/evidence/renderer เชื่อมครบ ตอนเดิมยังไม่ตั้งเวลาให้แสดง “ยังไม่ได้กำหนดกรอบเวลา” ไม่ยัด 60 วินาทีเข้าไปย้อนหลัง

## 11. การทดสอบและเกณฑ์รับงาน

- 180 วินาที maximum: brief อ่านได้ใน Director/script/storyboard context และผลรวม/ส่งออกไม่เกิน 180
- target ±5%: แสดงช่วง 171–189 วินาที และแจ้งเมื่ออยู่นอกช่วง
- เปลี่ยนเวลา 180 → 60: แผน stale บท/รูป/คลิปเดิมไม่ถูกลบ
- บทที่ไม่พอดี: แจ้งเหตุผลและข้อเสนอ ไม่มีการตัดตอนสำคัญเงียบ ๆ
- EDL ช่วงติดลบ/เกินไฟล์/ข้ามตอน/ไฟล์เปลี่ยน/ตัด protected dialogue ถูกปฏิเสธ
- คลิป FPS/ขนาดต่างกัน คลิปไม่มีเสียง transition และเสียงต่อเนื่อง ตรวจจาก render fixtures จริง
- ภาพไทย/แจ้งเตือนไทย มือถือและ desktop รองรับ Noto Sans Thai เดิม
- Agent ใช้ saved skill/prompt จริงและ Codex native provider ไม่มี paid LLM fallback
- ทดสอบ EP1 ที่มีอยู่แบบไม่แก้ข้อมูล: อ่าน context + timing เท่านั้น ใช้ตอนชั่วคราวสำหรับ integration tests
- คำสั่งตรวจ: backend npm run typecheck; node --import tsx --test tests/<production-tests>.test.ts; frontend npm run build; npm run test:native เมื่อแก้ bridge

## 12. ตัวอย่าง 3 นาที: คำสัตย์คืนบัลลังก์

ตัวอย่างแจกเวลาเพื่อออกแบบ ไม่ใช่แก้ EP1 ปัจจุบัน:
- เปิดเหตุการณ์ชิงบัลลังก์ 15 วินาที
- นางเอกเผชิญคำกล่าวหาและเดิมพัน 40 วินาที
- พระเอกเข้ามาขัดขวาง 45 วินาที
- หนีออกจากตำหนักและเปิดความลับ 50 วินาที
- คำสัตย์และปมตอนต่อไป 25 วินาที
- ชื่อเรื่อง/ท้ายตอน 5 วินาที
รวม 180 วินาที Editor ตรวจว่าการเปลี่ยนภาพที่ซ้อนกันลด runtime เท่าไรและใช้เนื้อหาที่รองรับจริง

## แหล่งอ้างอิง

- โค้ดใน checkout: backend/src/agents/tools/script-tools.ts, backend/src/agents/index.ts, backend/src/agents/native-guard.ts, backend/src/services/ffmpeg-merge.ts, shared/fal-video-models.json
- FFmpeg filter documentation: https://ffmpeg.org/ffmpeg-filters.html
- Local skills: cinematography/SKILL.md และ video-editing/SKILL.md ที่อ่านเพื่อประเมินแนวทาง ไม่ได้ติดตั้ง dependency เพิ่ม

## 13. ผลตรวจความซ้ำกับระบบเดิมและข้อปรับแบบ

ตรวจ registry/tools และ endpoint debug ของ storyboard_breaker เมื่อ 2026-09-29: provider codex-cli, ภาษา th, โหลด skill storyboard-breaker จริง

| ส่วนที่เสนอ | สิ่งที่มีอยู่ | แนวทางปรับ |
| --- | --- | --- |
| คิด/เขียนบท | script_rewriter อ่านต้นฉบับและบันทึกบทได้ | ขยายให้รับโจทย์ใหม่ + brief/เวลา ไม่เพิ่ม Writer ซ้ำ |
| Director | storyboard_breaker จัด beat แบ่งช่วง ใส่เวลา บรรยายภาพ/อารมณ์ ผูกตัวละคร ฉาก และสร้าง video_prompt ได้ | ขยาย Agent เดิมเป็น “ผู้ช่วยกำกับและแบ่งช็อต” มีโหมดวางแผนก่อนบท และโหมดแบ่งช็อตหลังบท ใช้ ID เดิม |
| แยกตัวละคร/ฉาก/สิ่งของ | extractor มีอยู่แล้ว | ใช้เดิมและรักษาการ dedup/ความต่อเนื่อง |
| คำสั่งภาพ/วิดีโอ | prompt_generator มีอยู่แล้ว | ใช้เดิม อ่านเวลา/preset จาก brief ไม่แย่งหน้าที่กำกับ |
| Editor | ยังไม่มี Agent สำหรับ EDL/ตรวจคลิปจริง | เพิ่ม editor เฉพาะงานนี้ |
| เรนเดอร์ | ffmpeg-merge รวมคลิปและเก็บประวัติได้แล้ว | ขยาย service เดิมให้รับแผน และเก็บ output version |
| preset | มีสไตล์ภาพ/ค่า API/encoding preset แล้ว | เพิ่ม edit presets แยกชนิด ห้ามใช้ FFmpeg -preset medium เป็นชื่อสไตล์ตัดต่อ |
| กรอบเวลา EP | มีเวลาต่อช็อตและผลรวม ยังไม่มี production brief | เพิ่มข้อมูล/validation และส่ง context ไปยัง Agent เดิม |

โหมด Director ก่อนมีบทต้องอ่าน creative_brief ได้โดยไม่บังคับให้มี screenplay และบันทึกแผนอย่างเดียว ไม่มีสิทธิ์ replace_existing ช็อต ส่วนโหมดแบ่งช็อตทำงานหลังบทพร้อม โดยใช้ tools/การป้องกัน revision เดิม แผนไม่ได้บังคับให้ทำ Director → Writer → Director หลายรอบทุกครั้ง ผู้ใช้มีบทพร้อมแล้วข้ามการวางเรื่องล่วงหน้าได้

ชื่อ Director ในส่วนอื่นของเอกสารหมายถึงบทบาทที่เพิ่มให้ storyboard_breaker ไม่ใช่ Agent ใหม่ แผนพัฒนาจึงเพิ่ม Agent จริงเฉพาะ Editor นอกเหนือจาก 4 Agent เดิม

## 14. สิ่งที่เปิดใช้แล้วในรอบนี้

- การ์ดกรอบเวลาในหน้าตอนทุกขั้น ตั้งเวลา/preset/โจทย์/source policy ก่อนให้ Codex คิดบท
- ขยายผู้ช่วยแบ่งช็อตเดิมด้วย read_production_context/save_director_plan ไม่เพิ่ม Director registry ซ้ำ
- เพิ่ม editor พร้อมสกิลและการตั้งค่า ใช้ native Codex provider เดิม
- เครื่องมืออ่าน metadata คลิปจริง ตรวจ hash และรักษาคลิปที่มีเสียง/บทพูดทั้งช่วง
- EDL แบบ cut ตรงพร้อมช่วงเข้า/ออกและเหตุผล ตรวจลำดับตอนเต็ม/ตัวอย่างตอน ระยะเวลา scope และ revision
- เรนเดอร์ draft/final ด้วย FFmpeg normalize FPS/ภาพ/เสียง คลิปไม่มีเสียงมี silence stream; probe ผลลัพธ์และตรวจเวลา
- ประวัติใช้ video_merges เดิม draft/teaser ไม่แทน episode.video_url ส่วน final ตอนเต็มแทนเมื่อสำเร็จเท่านั้น
- ตอนเดิมไม่ถูกตั้งเวลาอัตโนมัติ การแก้ brief ทำให้แผน stale และรักษาสื่อเดิม
- ตรวจ constraints ด้วย unit/integration tests, คลิปสังเคราะห์ต่าง FPS/ขนาด/เสียง, การเรนเดอร์จริง และ opt-in ทดสอบ Codex เรียก tools จริง

ข้อจำกัดที่แสดงใน UI: Editor รุ่นนี้ใช้ metadata และคำบรรยาย ไม่ได้ตรวจภาพเคลื่อนไหว/ฟังเสียงจริง จึงยังไม่มี word-level dialogue cuts, transitions แบบซ้อน, เพลงหรือซับใหม่ และ export timing override แยกจาก brief; preset มีผลต่อการวางเรื่อง/เลือกช่วงที่ตัดได้ ไม่รับประกันความต่างเมื่อทุกคลิปต้องรักษาทั้งช่วง
