/**
 * 纯工具函数（无外部依赖，可直接测试）
 * 负责群消息发言人解析、名字映射、消息富化等逻辑
 */

// ============================
// 消息类型
// ============================

export const MESSAGE_TYPE_MAP: Record<number, string> = {
  1: '文本',
  3: '图片',
  34: '语音',
  43: '视频',
  47: '表情',
  49: '链接/文件/引用',
  10000: '系统消息',
  10002: '撤回消息',
}

// ============================
// 群消息发言人解析
// ============================

/**
 * 从群消息中解析发言人 wxid 和实际内容。
 *
 * 微信群消息 content 格式（旧版/部分 4.x）：
 *   "wxid_xxx:\n<实际内容>"
 *
 * 微信 4.x WCDB 也可能有独立的 senderUserName 列，优先使用。
 */
export function parseGroupSender(
  row: Record<string, unknown>,
  isSender: number,
  talker: string
): { senderWxid: string; actualContent: string | null } {
  // 自己发送的消息：senderWxid 为账户本身（用特殊标记）
  if (isSender === 1) {
    return {
      senderWxid: '__self__',
      actualContent: row.content != null ? String(row.content) : null,
    }
  }

  // 优先读取独立的发言人字段（WCDB 4.x 部分版本）
  const senderField =
    row.senderUserName ?? row.fromUser ?? row.FromUser ?? row.sender ?? null
  if (senderField != null && String(senderField).trim() !== '') {
    return {
      senderWxid: String(senderField).trim(),
      actualContent: row.content != null ? String(row.content) : null,
    }
  }

  // 非群消息（私聊）：发言人就是 talker
  if (!talker.endsWith('@chatroom')) {
    return {
      senderWxid: talker,
      actualContent: row.content != null ? String(row.content) : null,
    }
  }

  // 群消息：从 content 前缀解析 "wxid_xxx:\n实际内容"
  const content = row.content != null ? String(row.content) : null
  if (content) {
    const newlineIdx = content.indexOf('\n')
    if (newlineIdx > 0) {
      const prefix = content.slice(0, newlineIdx)
      // wxid 前缀：不含空格、不含 XML 标签特征、长度合理（3~64）
      if (
        prefix.length >= 3 &&
        prefix.length <= 64 &&
        !prefix.includes(' ') &&
        !prefix.includes('<')
      ) {
        const senderWxid = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix
        return { senderWxid, actualContent: content.slice(newlineIdx + 1) }
      }
    }
  }

  return { senderWxid: '', actualContent: content }
}

// ============================
// 成员名字映射
// ============================

export interface GroupMemberResolved {
  memberWxid: string
  displayName: string | null
  nickName: string | null
  remarkName: string | null
  resolvedName: string
}

/**
 * 将群成员列表转换为 wxid → resolvedName 的快查 Map
 */
export function buildMemberNameMap(
  members: GroupMemberResolved[]
): Map<string, string> {
  return new Map(members.map((m) => [m.memberWxid, m.resolvedName]))
}

export interface MessageForEnrich {
  senderWxid?: string
  isSender: number
  senderDisplayName?: string | null
  [key: string]: unknown
}

/**
 * 给消息列表批量填充发言人显示名
 */
export function enrichMessagesWithNames<T extends MessageForEnrich>(
  messages: T[],
  nameMap: Map<string, string>,
  selfName: string = '我'
): T[] {
  return messages.map((msg) => {
    if (msg.senderWxid === '__self__') {
      return { ...msg, senderDisplayName: selfName }
    }
    if (msg.senderWxid) {
      return {
        ...msg,
        senderDisplayName: nameMap.get(msg.senderWxid) ?? msg.senderWxid,
      }
    }
    return msg
  })
}

/**
 * 计算成员的最终显示名（优先级：备注 > 群昵称 > 微信昵称 > wxid）
 */
export function resolveDisplayName(
  remarkName: string | null,
  displayName: string | null,
  nickName: string | null,
  fallback: string
): string {
  return remarkName || displayName || nickName || fallback
}
