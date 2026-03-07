/**
 * Agent content parsing utilities (server-side)
 * Handles thinking tag extraction and tool call tag cleanup.
 * Ported from electron/main/ai/agent/content-parser.ts — no Electron imports.
 */

const THINK_TAGS = ['think', 'analysis', 'reasoning', 'reflection', 'thought', 'thinking']

/**
 * Extract thinking-tag content from text
 */
export function extractThinkingContent(content: string): { thinking: string; cleanContent: string } {
  if (!content) {
    return { thinking: '', cleanContent: '' }
  }

  const tagPattern = THINK_TAGS.join('|')
  const thinkRegex = new RegExp(`<(${tagPattern})>([\\s\\S]*?)<\\/\\1>`, 'gi')
  const thinkingParts: string[] = []
  let cleanContent = content

  const matches = content.matchAll(thinkRegex)
  for (const match of matches) {
    const thinkText = match[2].trim()
    if (thinkText) {
      thinkingParts.push(thinkText)
    }
    cleanContent = cleanContent.replace(match[0], '')
  }

  return { thinking: thinkingParts.join('\n').trim(), cleanContent: cleanContent.trim() }
}

/**
 * Strip <tool_call> tag content to avoid showing tool call text to users
 */
export function stripToolCallTags(content: string): string {
  return content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim()
}
