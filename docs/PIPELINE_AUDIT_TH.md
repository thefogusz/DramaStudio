# ผลตรวจ pipeline และ environment — 29 กันยายน 2026

ตรวจ checkout D:/huobao-drama (feature/codex-native) ไม่ใช่แอป Electron ที่ติดตั้งไว้แล้ว

| ส่วน | การเชื่อมต่อ | ผล |
|---|---|---|
| เว็บพัฒนา | http://localhost:3013 → /api และ /static proxy → http://localhost:5679 | health / dramas / storyboards / pipeline-status ตอบ 200 |
| Backend | http://localhost:5679/api/v1 | health, style-presets, storage/stats ผ่าน |
| เว็บ production | backend เสิร์ฟ frontend/.output/public | /settings ตอบ 200 หลังแก้ path |
| ข้อมูล | data/huobao.sqlite3 และ data/static | backend และ native importer ใช้ตำแหน่งเดียวกัน |
| Codex บท/ภาพ | แชต → native validate/import/attach → DB + สื่อ → refresh UI | การทดสอบนำเข้าบทไทยและภาพจริงผ่าน ไม่ใช้ AI config |
| วิดีโอ fal | config_id + model → /tasks → adapter → queue → result → download/writeback | integration mock และ adapter queue/result ผ่าน ยังไม่เรียก fal จริง |
| รวม/ส่งออก | FFmpeg + FFprobe | executable probe ผ่าน ยังไม่ได้รวมคลิปจริงเพราะโปรเจกต์ไม่มีวิดีโอ |
| Docker | ภายใน/ภายนอก 5679; watchtower 8080 ภายในเครือข่าย | แก้ COPY shared แล้ว ยัง build/run Docker ไม่ได้เพราะไม่มี Docker ในเครื่อง |
| Electron | เลือกพอร์ตว่างบน 127.0.0.1 และเสิร์ฟ UI/API แบบ origin เดียว | ตรวจ source; ไม่ได้เปิด/แพ็ก Electron เพราะยังไม่มี desktop/node_modules |

## จุดที่แก้

- Docker คัดลอก shared catalog ทั้ง frontend build, backend build และ runtime
- backend production ใช้โฟลเดอร์ที่ Nuxt generate สร้างจริง
- frontend proxy ตั้ง HUOBAO_BACKEND_URL ได้ หากเปลี่ยน backend PORT ต้องเปลี่ยนค่านี้และ restart frontend
- HUOBAO_DATA_DIR ใช้เป็นฐาน DB ทั้ง backend และ native CLI; SQLITE_PATH ยัง override ได้
- STORAGE_PATH ที่แยกโฟลเดอร์ยังอ่านไฟล์และเสิร์ฟ /static จากตำแหน่งเดียวกัน
- fal duration ใน inspector เป็นตัวเลือกตามโมเดล; backend คืน 400 ก่อนสร้าง task หากพารามิเตอร์ไม่รองรับ
- H3 แสดง 768P/1080P ตรงค่าที่ส่ง; Kling ซ่อนการเลือกความละเอียดที่ API ไม่รับ
- เปลี่ยนความละเอียดจากค่าเก่าที่โมเดลไม่รองรับได้จริง; สรุปเวลา batch ใช้ default 10 วินาทีตรงการส่งงาน
- ไม่พิมพ์ api_key ที่กรอกลง frontend console

## สิ่งที่ยังไม่พร้อมครบวงจร

ขณะตรวจไม่มี AI config ใน DB และโปรเจกต์ตัวอย่างมีบท/ช็อต แต่ไม่มีภาพช็อตหรือวิดีโอ ดังนั้นยังไม่ยืนยันสิทธิ์ fal key, เครดิต, การสร้างจริง หรือไฟล์วิดีโอสุดท้าย ภาพเริ่มต้นไม่จำเป็นสำหรับ text-to-video แต่ต้องมีสำหรับ image-to-video

ปุ่ม AI บท/ภาพในแอปเดิมยังเรียก API ไม่ได้ปลุก Codex native ให้ทำงานอัตโนมัติ ใช้แชตและ native CLI ตาม CODEX_NATIVE.md แล้ว refresh

ตรวจ browser DOM/คลิก/console จริงไม่ได้ เพราะเครื่องมือเบราว์เซอร์ถูก security policy บล็อก ไม่ใช้ช่องทางอื่นเลี่ยงข้อจำกัด การตอบ HTTP 200 และ build ผ่านไม่ได้ยืนยัน UX ทุกขั้นตอน

## ค่า environment

backend/.env โหลดเมื่อรันจาก backend/: PORT=5679, HUOBAO_DATA_DIR, SQLITE_PATH, STORAGE_PATH, FRONTEND_DIST (optional), FFMPEG_BIN/FFPROBE_BIN (optional)

frontend/.env: HUOBAO_BACKEND_URL=http://localhost:5679; dev port 3013 อยู่ใน package.json

fal Key เก็บผ่านหน้าตั้งค่าใน DB ไม่อ่านจาก FAL_KEY ของ shell ตัวเชื่อมต่อส่ง Authorization: Key จาก backend ผ่าน HTTPS 443 ไป queue.fal.run และดาวน์โหลดผลจาก URL ที่บริการส่งกลับ ภาพ local ถูกอ่านเป็น data URI จึงไม่ต้อง expose localhost ให้ fal; PUBLIC_BASE_URL สำหรับเส้นทางวิดีโอ/เสียงอ้างอิงของ provider อื่น ไม่จำเป็นกับ fal connector แบบภาพเดียวนี้

อย่าปรับ environment ให้ชี้ DB ของ desktop โดยเดา path: ใช้ DB/storage ของ instance ที่ต้องการจริงตาม CODEX_NATIVE.md

## ตรวจซ้ำ

จาก backend/: npm run typecheck และ node --import tsx --test tests/pipeline-integration.test.ts tests/storage-environment.test.ts tests/fal.test.ts tests/codex-native.test.ts

จาก frontend/: node --test tests/thai-locale.test.mjs และ npm run generate

ผล: backend 11 tests ผ่าน, locale 2 tests ผ่าน, typecheck และ frontend generate ผ่าน ใช้ mock และ DB แยกสำหรับทดสอบ ไม่ส่งงานที่มีค่าใช้จ่าย
