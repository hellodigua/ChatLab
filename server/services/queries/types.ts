/**
 * Shared types for the query service layer.
 * Ported from electron/main/worker/query/session/types.ts
 */

/** Default session gap threshold: 30 minutes (seconds) */
export const DEFAULT_SESSION_GAP_THRESHOLD = 1800

export interface ChatSessionItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  firstMessageId: number
  summary?: string | null
}

export interface SessionSearchResultItem {
  id: number
  startTs: number
  endTs: number
  messageCount: number
  isComplete: boolean
  previewMessages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

export interface SessionMessagesResult {
  sessionId: number
  startTs: number
  endTs: number
  messageCount: number
  returnedCount: number
  participants: string[]
  messages: Array<{
    id: number
    senderName: string
    content: string | null
    timestamp: number
  }>
}

export interface FilterMessage {
  id: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
  replyToMessageId: string | null
  replyToContent: string | null
  replyToSenderName: string | null
  isHit: boolean
}

export interface ContextBlock {
  startTs: number
  endTs: number
  messages: FilterMessage[]
  hitCount: number
}

export interface FilterResult {
  blocks: ContextBlock[]
  stats: {
    totalMessages: number
    hitMessages: number
    totalChars: number
  }
}

export interface PaginationInfo {
  page: number
  pageSize: number
  totalBlocks: number
  totalHits: number
  hasMore: boolean
}

export interface FilterResultWithPagination extends FilterResult {
  pagination: PaginationInfo
}

export interface ExportFilterParams {
  sessionId: string
  sessionName: string
  outputDir: string
  filterMode: 'condition' | 'session'
  keywords?: string[]
  timeFilter?: { startTs: number; endTs: number }
  senderIds?: number[]
  contextSize?: number
  chatSessionIds?: number[]
}

export interface ExportProgress {
  stage: 'preparing' | 'exporting' | 'done' | 'error'
  currentBlock: number
  totalBlocks: number
  percentage: number
  message: string
}

// Message query types
export interface MessageResult {
  id: number
  senderId: number
  senderName: string
  senderPlatformId: string
  senderAliases: string[]
  senderAvatar: string | null
  content: string
  timestamp: number
  type: number
  replyToMessageId: string | null
  replyToContent: string | null
  replyToSenderName: string | null
}

export interface PaginatedMessages {
  messages: MessageResult[]
  hasMore: boolean
}

export interface MessagesWithTotal {
  messages: MessageResult[]
  total: number
}

// SQL types
export interface SQLResult {
  columns: string[]
  rows: any[][]
  rowCount: number
  duration: number
  limited: boolean
}

export interface TableSchema {
  name: string
  columns: {
    name: string
    type: string
    notnull: boolean
    pk: boolean
  }[]
}

// Member management types
export interface MemberWithStats {
  id: number
  platformId: string
  accountName: string | null
  groupNickname: string | null
  aliases: string[]
  messageCount: number
  avatar: string | null
}

export interface MembersPaginationParams {
  page: number
  pageSize: number
  search?: string
  sortOrder?: 'asc' | 'desc'
}

export interface MembersPaginatedResult {
  members: MemberWithStats[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// Advanced analysis types
export interface ClusterGraphNode {
  id: number
  name: string
  messageCount: number
  symbolSize: number
  degree: number
  normalizedDegree: number
}

export interface ClusterGraphLink {
  source: string
  target: string
  value: number
  rawScore: number
  expectedScore: number
  coOccurrenceCount: number
}

export interface ClusterGraphData {
  nodes: ClusterGraphNode[]
  links: ClusterGraphLink[]
  maxLinkValue: number
  communities: Array<{ id: number; name: string; size: number }>
  stats: {
    totalMembers: number
    totalMessages: number
    involvedMembers: number
    edgeCount: number
    communityCount: number
  }
}

export interface ClusterGraphOptions {
  lookAhead?: number
  decaySeconds?: number
  topEdges?: number
}

export interface MentionGraphNode {
  id: number
  name: string
  value: number
  symbolSize: number
}

export interface MentionGraphLink {
  source: string
  target: string
  value: number
}

export interface MentionGraphData {
  nodes: MentionGraphNode[]
  links: MentionGraphLink[]
  maxLinkValue: number
}
