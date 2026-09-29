# fal video setup

ระบบนี้ใช้ Codex ผ่านแชตสำหรับบทละครและภาพ ใช้ fal API Key เฉพาะสร้างวิดีโอ

1. เปิด **ตั้งค่า → บริการ AI ผ่าน API**
2. สร้าง key ที่ https://fal.ai/dashboard/keys แล้วกรอกในช่อง **fal API Key**
3. กด **บันทึก fal Key** ระบบจะสร้างหรืออัปเดตบริการวิดีโอ fal โดยไม่สร้างงานที่ใช้เครดิต
4. ใช้ Kling 2.6 Pro แบบข้อความ หรือภาพเริ่มต้นของช็อตที่ Codex นำเข้า

รองรับ `fal-ai/kling-video/v2.6/pro/text-to-video` และ `fal-ai/kling-video/v2.6/pro/image-to-video` ความยาว 5 หรือ 10 วินาที เมื่อมีภาพเริ่มต้นของช็อต ระบบเลือก image-to-video ให้โดยอัตโนมัติ ภาพอ้างอิงเป็นภาพช็อต ไม่ใช่ภาพตัวละครหรือฉากแยกหลายภาพ

ปุ่มทดสอบการเชื่อมต่อใช้ GET ดูสถานะรหัสงานทดสอบที่ไม่มีอยู่ ไม่ส่งงานสร้างวิดีโอ สถานะ 404 หมายถึงเข้าถึงระบบได้ แต่ยังไม่ยืนยันสิทธิ์ key หรือเครดิต; 401/403 หมายถึงไม่ได้รับอนุญาต

ตัวเชื่อมต่อใช้ `Authorization: Key ...` และ queue URL ที่ fal ส่งกลับ ติดตามสถานะแล้วดึงผลจาก response URL อีกครั้งเมื่อเสร็จ เก็บคีย์ไว้ในบริการฝั่งเซิร์ฟเวอร์ ไม่ใส่ใน URL หรือส่งตรงจากเบราว์เซอร์ไป fal

การตั้งค่า API แบบเดิมยังเก็บไว้เพื่อความเข้ากันได้ แต่หน้าตั้งค่าแสดงเฉพาะบริการวิดีโอ ปุ่ม AI เขียนบทและภาพเดิมยังเป็นเส้นทาง API จึงให้ทำสองงานนี้ผ่านแชต Codex ตาม `CODEX_NATIVE.md`

อ้างอิง: https://fal.ai/docs/documentation/model-apis/inference/queue และ https://fal.ai/models/fal-ai/kling-video/v2.6/pro/image-to-video/api

ตรวจด้วย `npm run typecheck` ใน backend, `node --import tsx --test tests/fal.test.ts`, และ `npm run generate` ใน frontend การทดสอบใช้ mock ไม่ใช้คีย์หรือเครดิตจริง
