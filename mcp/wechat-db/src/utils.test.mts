/**
 * 单元测试：MCP 工具函数
 * 运行方式：node --experimental-strip-types --test src/utils.test.mts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGroupSender,
  buildMemberNameMap,
  enrichMessagesWithNames,
  resolveDisplayName,
  type GroupMemberResolved,
  type MessageForEnrich,
} from './utils.ts'

// ============================
// parseGroupSender
// ============================

describe('parseGroupSender', () => {
  it('自己发送的消息：返回 __self__ 标记', () => {
    const result = parseGroupSender(
      { content: '你好大家' },
      1, // isSender
      'room123@chatroom'
    )
    assert.equal(result.senderWxid, '__self__')
    assert.equal(result.actualContent, '你好大家')
  })

  it('自己发送且 content 为 null：actualContent 也为 null', () => {
    const result = parseGroupSender({ content: null }, 1, 'room@chatroom')
    assert.equal(result.senderWxid, '__self__')
    assert.equal(result.actualContent, null)
  })

  it('独立发言人字段（senderUserName）优先于 content 前缀', () => {
    const result = parseGroupSender(
      { content: 'wxid_other:\n消息内容', senderUserName: 'wxid_real' },
      0,
      'room@chatroom'
    )
    assert.equal(result.senderWxid, 'wxid_real')
    assert.equal(result.actualContent, 'wxid_other:\n消息内容')
  })

  it('fromUser 字段也可被识别', () => {
    const result = parseGroupSender(
      { content: '消息内容', fromUser: 'wxid_from' },
      0,
      'room@chatroom'
    )
    assert.equal(result.senderWxid, 'wxid_from')
  })

  it('私聊消息：发言人就是 talker', () => {
    const result = parseGroupSender({ content: '私信内容' }, 0, 'wxid_friend')
    assert.equal(result.senderWxid, 'wxid_friend')
    assert.equal(result.actualContent, '私信内容')
  })

  it('群消息：从 content 前缀解析 "wxid_xxx:\\n内容"', () => {
    const result = parseGroupSender(
      { content: 'wxid_abc123:\n这是消息正文' },
      0,
      'room@chatroom'
    )
    assert.equal(result.senderWxid, 'wxid_abc123')
    assert.equal(result.actualContent, '这是消息正文')
  })

  it('群消息前缀末尾的冒号会被去掉', () => {
    const result = parseGroupSender(
      { content: 'wxid_hello:\n内容' },
      0,
      'room@chatroom'
    )
    assert.equal(result.senderWxid, 'wxid_hello')
  })

  it('前缀含空格（非 wxid）：不解析为发言人', () => {
    const result = parseGroupSender(
      { content: 'not a wxid:\n内容' },
      0,
      'room@chatroom'
    )
    assert.equal(result.senderWxid, '')
  })

  it('前缀含 < 字符（XML 内容）：不解析为发言人', () => {
    const result = parseGroupSender(
      { content: '<msg><text>hello</text></msg>' },
      0,
      'room@chatroom'
    )
    assert.equal(result.senderWxid, '')
  })

  it('content 为 null：返回空 senderWxid', () => {
    const result = parseGroupSender({ content: null }, 0, 'room@chatroom')
    assert.equal(result.senderWxid, '')
    assert.equal(result.actualContent, null)
  })

  it('多行消息内容正确保留', () => {
    const multiline = 'wxid_user:\n第一行\n第二行\n第三行'
    const result = parseGroupSender({ content: multiline }, 0, 'room@chatroom')
    assert.equal(result.senderWxid, 'wxid_user')
    assert.equal(result.actualContent, '第一行\n第二行\n第三行')
  })
})

// ============================
// resolveDisplayName
// ============================

describe('resolveDisplayName', () => {
  it('备注优先级最高', () => {
    assert.equal(resolveDisplayName('备注名', '群昵称', '微信昵称', 'wxid'), '备注名')
  })

  it('没有备注则用群昵称', () => {
    assert.equal(resolveDisplayName(null, '群昵称', '微信昵称', 'wxid'), '群昵称')
  })

  it('没有群昵称则用微信昵称', () => {
    assert.equal(resolveDisplayName(null, null, '微信昵称', 'wxid'), '微信昵称')
  })

  it('全为空则 fallback 到 wxid', () => {
    assert.equal(resolveDisplayName(null, null, null, 'wxid_fallback'), 'wxid_fallback')
  })

  it('空字符串视为 falsy，继续往下找', () => {
    assert.equal(resolveDisplayName('', '', '微信昵称', 'wxid'), '微信昵称')
  })
})

// ============================
// buildMemberNameMap
// ============================

describe('buildMemberNameMap', () => {
  const members: GroupMemberResolved[] = [
    {
      memberWxid: 'wxid_a',
      displayName: '群昵称A',
      nickName: '昵称A',
      remarkName: '备注A',
      resolvedName: '备注A',
    },
    {
      memberWxid: 'wxid_b',
      displayName: '群昵称B',
      nickName: '昵称B',
      remarkName: null,
      resolvedName: '群昵称B',
    },
  ]

  it('构建 wxid → resolvedName 的 Map', () => {
    const map = buildMemberNameMap(members)
    assert.equal(map.get('wxid_a'), '备注A')
    assert.equal(map.get('wxid_b'), '群昵称B')
  })

  it('不在列表里的 wxid 返回 undefined', () => {
    const map = buildMemberNameMap(members)
    assert.equal(map.get('wxid_unknown'), undefined)
  })

  it('空成员列表返回空 Map', () => {
    const map = buildMemberNameMap([])
    assert.equal(map.size, 0)
  })
})

// ============================
// enrichMessagesWithNames
// ============================

describe('enrichMessagesWithNames', () => {
  const nameMap = new Map([
    ['wxid_alice', 'Alice'],
    ['wxid_bob', 'Bob'],
  ])

  it('自己发的消息（__self__）填入 selfName', () => {
    const msgs: MessageForEnrich[] = [{ senderWxid: '__self__', isSender: 1 }]
    const result = enrichMessagesWithNames(msgs, nameMap, '张三')
    assert.equal(result[0].senderDisplayName, '张三')
  })

  it('默认 selfName 为 "我"', () => {
    const msgs: MessageForEnrich[] = [{ senderWxid: '__self__', isSender: 1 }]
    const result = enrichMessagesWithNames(msgs, nameMap)
    assert.equal(result[0].senderDisplayName, '我')
  })

  it('已知 wxid 填入对应显示名', () => {
    const msgs: MessageForEnrich[] = [{ senderWxid: 'wxid_alice', isSender: 0 }]
    const result = enrichMessagesWithNames(msgs, nameMap)
    assert.equal(result[0].senderDisplayName, 'Alice')
  })

  it('未知 wxid fallback 为 wxid 本身', () => {
    const msgs: MessageForEnrich[] = [{ senderWxid: 'wxid_unknown', isSender: 0 }]
    const result = enrichMessagesWithNames(msgs, nameMap)
    assert.equal(result[0].senderDisplayName, 'wxid_unknown')
  })

  it('没有 senderWxid 字段的消息不修改', () => {
    const msgs: MessageForEnrich[] = [{ isSender: 0 }]
    const result = enrichMessagesWithNames(msgs, nameMap)
    assert.equal(result[0].senderDisplayName, undefined)
  })

  it('不修改消息的其他字段', () => {
    const msgs: MessageForEnrich[] = [
      { senderWxid: 'wxid_alice', isSender: 0, content: '原始内容', createTime: 12345 },
    ]
    const result = enrichMessagesWithNames(msgs, nameMap)
    assert.equal(result[0].content, '原始内容')
    assert.equal(result[0].createTime, 12345)
  })

  it('批量处理多条消息', () => {
    const msgs: MessageForEnrich[] = [
      { senderWxid: 'wxid_alice', isSender: 0 },
      { senderWxid: 'wxid_bob', isSender: 0 },
      { senderWxid: '__self__', isSender: 1 },
    ]
    const result = enrichMessagesWithNames(msgs, nameMap, '我')
    assert.equal(result[0].senderDisplayName, 'Alice')
    assert.equal(result[1].senderDisplayName, 'Bob')
    assert.equal(result[2].senderDisplayName, '我')
  })
})
