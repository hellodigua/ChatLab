import type { ChatMessage } from '@/stores/aiChat'

export interface QAPair {
  user: ChatMessage | null
  assistant: ChatMessage | null
  /** 非 user/assistant 的独立消息（system 压缩摘要等） */
  standalone: ChatMessage | null
  id: string
}

/** 将消息列表分组为 QA 对（用户问题 + AI 回复），其他角色作为独立项 */
export function groupMessagesToQAPairs(messages: ChatMessage[]): QAPair[] {
  const pairs: QAPair[] = []
  let currentUser: ChatMessage | null = null

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (currentUser) {
        pairs.push({ user: currentUser, assistant: null, standalone: null, id: currentUser.id })
      }
      currentUser = msg
    } else if (msg.role === 'assistant') {
      pairs.push({ user: currentUser, assistant: msg, standalone: null, id: currentUser?.id || msg.id })
      currentUser = null
    } else {
      if (currentUser) {
        pairs.push({ user: currentUser, assistant: null, standalone: null, id: currentUser.id })
        currentUser = null
      }
      pairs.push({ user: null, assistant: null, standalone: msg, id: msg.id })
    }
  }

  if (currentUser) {
    pairs.push({ user: currentUser, assistant: null, standalone: null, id: currentUser.id })
  }

  return pairs
}
