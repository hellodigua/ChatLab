/**
 * Session list queries (server-side)
 * Ported from electron/main/worker/query/sessions.ts — no worker_threads.
 */

import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { openDatabase, getDbPath, getDbDirectory } from '../db-pool'

interface DbMeta {
  name: string
  platform: string
  type: string
  imported_at: number
  group_id: string | null
  group_avatar: string | null
  owner_id: string | null
}

function isChatSessionDb(db: Database.Database): boolean {
  const count = db
    .prepare(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('meta', 'member', 'message')",
    )
    .get() as { cnt: number }
  return count.cnt === 3
}

function getPrivateChatMemberAvatar(
  db: Database.Database,
  sessionName: string,
  ownerId: string | null,
): string | null {
  const members = db
    .prepare(
      `SELECT m.platform_id as platformId,
              COALESCE(m.group_nickname, m.account_name, m.platform_id) as name,
              m.avatar
       FROM member m WHERE COALESCE(m.account_name, '') != '系统消息'
       ORDER BY (SELECT COUNT(*) FROM message WHERE sender_id = m.id) DESC`,
    )
    .all() as Array<{ platformId: string; name: string; avatar: string | null }>
  if (members.length === 0) return null
  if (ownerId) {
    const other = members.find((m) => m.platformId !== ownerId)
    if (other?.avatar) return other.avatar
  }
  const sameName = members.find((m) => m.name === sessionName)
  if (sameName?.avatar) return sameName.avatar
  return members.find((m) => m.avatar)?.avatar || null
}

export function getAllSessions(): any[] {
  const dbDir = getDbDirectory()
  if (!fs.existsSync(dbDir)) return []

  const sessions: any[] = []
  const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.db'))

  for (const file of files) {
    const sessionId = file.replace('.db', '')
    const filePath = path.join(dbDir, file)
    try {
      const db = new Database(filePath)
      db.pragma('journal_mode = WAL')
      if (!isChatSessionDb(db)) {
        db.close()
        continue
      }
      const meta = db.prepare('SELECT * FROM meta LIMIT 1').get() as DbMeta | undefined
      if (meta) {
        const messageCount = (
          db
            .prepare(
              `SELECT COUNT(*) as count FROM message msg
               JOIN member m ON msg.sender_id = m.id
               WHERE COALESCE(m.account_name, '') != '系统消息'`,
            )
            .get() as { count: number }
        ).count
        const memberCount = (
          db
            .prepare(
              "SELECT COUNT(*) as count FROM member WHERE COALESCE(account_name, '') != '系统消息'",
            )
            .get() as { count: number }
        ).count

        let memberAvatar: string | null = null
        if (meta.type === 'private') {
          memberAvatar = getPrivateChatMemberAvatar(db, meta.name, meta.owner_id)
        }

        let summaryCount = 0
        try {
          const has = db
            .prepare(
              "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='chat_session'",
            )
            .get() as { cnt: number }
          if (has.cnt > 0) {
            summaryCount = (
              db
                .prepare(
                  "SELECT COUNT(*) as count FROM chat_session WHERE summary IS NOT NULL AND summary != ''",
                )
                .get() as { count: number }
            ).count
          }
        } catch {
          /* ignore */
        }

        sessions.push({
          id: sessionId,
          name: meta.name,
          platform: meta.platform,
          type: meta.type,
          importedAt: meta.imported_at,
          messageCount,
          memberCount,
          dbPath: filePath,
          groupId: meta.group_id || null,
          groupAvatar: meta.group_avatar || null,
          ownerId: meta.owner_id || null,
          memberAvatar,
          summaryCount,
          aiConversationCount: 0,
        })
      }
      db.close()
    } catch (error) {
      console.error(`[Services] Failed to read database ${file}:`, error)
    }
  }
  return sessions.sort((a, b) => b.importedAt - a.importedAt)
}

export function getSession(sessionId: string): any | null {
  const db = openDatabase(sessionId)
  if (!db) return null
  const meta = db.prepare('SELECT * FROM meta LIMIT 1').get() as DbMeta | undefined
  if (!meta) return null
  const messageCount = (
    db
      .prepare(
        `SELECT COUNT(*) as count FROM message msg
         JOIN member m ON msg.sender_id = m.id
         WHERE COALESCE(m.account_name, '') != '系统消息'`,
      )
      .get() as { count: number }
  ).count
  const memberCount = (
    db
      .prepare(
        "SELECT COUNT(*) as count FROM member WHERE COALESCE(account_name, '') != '系统消息'",
      )
      .get() as { count: number }
  ).count
  return {
    id: sessionId,
    name: meta.name,
    platform: meta.platform,
    type: meta.type,
    importedAt: meta.imported_at,
    messageCount,
    memberCount,
    dbPath: getDbPath(sessionId),
    groupId: meta.group_id || null,
    groupAvatar: meta.group_avatar || null,
    ownerId: meta.owner_id || null,
  }
}
