import 'dotenv/config'
import { DATA_ROOT } from '../utils/paths.js'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'
import { initSqliteSchema } from './sqlite-schema.js'
import { maybeAutoImportMysql } from './mysql-import.js'

// 桌面版由 Electron 主进程注入 SQLITE_PATH（userData 下）；dev 默认仓库根 data/
// 注意：勿沿用旧文件名 huobao_drama.db —— 那是早期 SQLite 时代的遗留库，表名重叠但列不同
export const dbPath = process.env.SQLITE_PATH || path.join(DATA_ROOT, 'huobao.sqlite3')
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

const sqlite = new Database(dbPath)

// WAL：生成任务轮询与页面读并发时不互相阻塞；busy_timeout 兜底写锁竞争
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('busy_timeout = 5000')
sqlite.pragma('synchronous = NORMAL')

/** 启动建表（DDL 幂等重放 + 种子补缺）。SQLite 无连接就绪问题，无需重试 */
export function initDb() {
  initSqliteSchema(sqlite)
}

initDb()
// Native edit renders are local processes; they cannot survive a server restart.
sqlite.prepare("UPDATE video_merges SET status='failed', error_msg=? WHERE model LIKE 'codex-edit-%' AND status IN ('pending','processing')").run('บริการเริ่มใหม่ระหว่างเรนเดอร์ กรุณาสั่งเรนเดอร์ตามแผนอีกครั้ง')

// MySQL 老用户一次性自动迁移：仅在显式配置 MySQL + 空库 + 无标记时触发（详见 mysql-import.ts 头注释）
await maybeAutoImportMysql(sqlite, dbPath)
// Keep historic providers/keys for old results, but only H3 reference generation remains active.
sqlite.prepare("UPDATE ai_service_configs SET is_active=0 WHERE service_type='video' AND provider<>'fal'").run()
sqlite.prepare("UPDATE ai_service_configs SET model=?,base_url=? WHERE service_type='video' AND provider='fal'").run('["minimax/h3-max/reference-to-video"]','https://queue.fal.run')
sqlite.prepare("UPDATE episodes SET video_config_id=NULL WHERE video_config_id IN (SELECT id FROM ai_service_configs WHERE service_type='video' AND provider<>'fal')").run()


/** better-sqlite3 的 lastInsertRowid 可能是 bigint，统一转 number */
export function getInsertId(result: unknown) {
  const res = result as { lastInsertRowid?: number | bigint } | undefined
  if (res?.lastInsertRowid === undefined || res.lastInsertRowid === null) {
    throw new Error('SQLite insert did not return lastInsertRowid')
  }
  return Number(res.lastInsertRowid)
}

export const db = drizzle(sqlite, { schema })
export { schema }
export type DB = typeof db
