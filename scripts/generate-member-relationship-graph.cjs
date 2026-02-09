#!/usr/bin/env node
'use strict'

/**
 * Generate member relationship graph from exported chat JSON.
 * Model:
 * closeness = mentionWeight * normalizedMention + temporalWeight * normalizedTemporal
 */

const fs = require('fs')
const path = require('path')

function parseArgs(argv) {
  const args = {
    input: '',
    outputJson: path.join('data', 'member-relationship-model.json'),
    outputMermaid: path.join('data', 'member-relationship-graph.mmd'),
    windowSeconds: 300,
    decaySeconds: 120,
    mentionWeight: 0.6,
    temporalWeight: 0.4,
    minScore: 0.12,
    minTemporalTurns: 2,
    topEdges: 80,
    includeBots: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    if (!raw.startsWith('--')) continue
    const [k, vMaybe] = raw.split('=')
    const key = k.slice(2)
    const next = vMaybe !== undefined ? vMaybe : argv[i + 1]
    const useNext = vMaybe === undefined

    const applyNum = (target) => {
      const n = Number(next)
      if (!Number.isFinite(n)) throw new Error(`Invalid numeric value for --${key}: ${next}`)
      args[target] = n
    }

    switch (key) {
      case 'input':
        args.input = String(next)
        if (useNext) i++
        break
      case 'output-json':
        args.outputJson = String(next)
        if (useNext) i++
        break
      case 'output-mermaid':
        args.outputMermaid = String(next)
        if (useNext) i++
        break
      case 'window-seconds':
        applyNum('windowSeconds')
        if (useNext) i++
        break
      case 'decay-seconds':
        applyNum('decaySeconds')
        if (useNext) i++
        break
      case 'mention-weight':
        applyNum('mentionWeight')
        if (useNext) i++
        break
      case 'temporal-weight':
        applyNum('temporalWeight')
        if (useNext) i++
        break
      case 'min-score':
        applyNum('minScore')
        if (useNext) i++
        break
      case 'min-temporal-turns':
        applyNum('minTemporalTurns')
        if (useNext) i++
        break
      case 'top-edges':
        applyNum('topEdges')
        if (useNext) i++
        break
      case 'include-bots':
        args.includeBots = true
        break
      default:
        throw new Error(`Unknown argument: ${raw}`)
    }
  }

  const weightSum = args.mentionWeight + args.temporalWeight
  if (weightSum <= 0) throw new Error('mentionWeight + temporalWeight must be > 0')
  args.mentionWeight /= weightSum
  args.temporalWeight /= weightSum

  if (args.windowSeconds <= 0) throw new Error('windowSeconds must be > 0')
  if (args.decaySeconds <= 0) throw new Error('decaySeconds must be > 0')

  return args
}

function pickInputFile(inputArg) {
  if (inputArg) return inputArg
  const dataDir = path.join(process.cwd(), 'data')
  if (!fs.existsSync(dataDir)) {
    throw new Error(`data directory not found: ${dataDir}`)
  }
  const files = fs
    .readdirSync(dataDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => path.join(dataDir, name))
  if (files.length === 0) throw new Error(`No JSON file found in ${dataDir}`)
  files.sort((a, b) => a.localeCompare(b))
  return files[0]
}

function normalizeName(candidate, fallback) {
  if (typeof candidate === 'string') {
    const trimmed = candidate.trim()
    if (trimmed) return trimmed
  }
  return fallback
}

function upsertMember(map, memberLike) {
  const id = String(memberLike?.id || '')
  if (!id) return null
  const existing = map.get(id)
  const name = normalizeName(memberLike?.nickname, normalizeName(memberLike?.name, id))
  if (existing) {
    // Prefer nickname when available, else keep existing.
    if (name && existing.name === existing.id) existing.name = name
    return existing
  }
  const member = {
    id,
    name,
    isBot: Boolean(memberLike?.isBot),
    messageCount: 0,
    mentionOut: 0,
    mentionIn: 0,
    totalCloseness: 0,
    degree: 0,
  }
  map.set(id, member)
  return member
}

function directedKey(fromId, toId) {
  return `${fromId}=>${toId}`
}

function undirectedKey(aId, bId) {
  return aId < bId ? `${aId}<->${bId}` : `${bId}<->${aId}`
}

function parseDirectedKey(key) {
  const [from, to] = key.split('=>')
  return { from, to }
}

function round(value, digits = 4) {
  const p = 10 ** digits
  return Math.round(value * p) / p
}

function escapeLabel(label) {
  return String(label).replace(/"/g, "'")
}

function buildGraphModel(payload, args, inputPath) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  if (messages.length === 0) {
    throw new Error('Input JSON has no messages[]')
  }

  const members = new Map()
  const mentionDirected = new Map()
  const timeline = []

  for (const msg of messages) {
    const author = upsertMember(members, msg?.author)
    if (!author) continue
    if (!args.includeBots && author.isBot) continue

    author.messageCount += 1

    const ts = Date.parse(msg?.timestamp || '')
    if (Number.isFinite(ts)) {
      timeline.push({
        messageId: String(msg?.id || ''),
        authorId: author.id,
        ts,
      })
    }

    const seenMentioned = new Set()
    const mentions = Array.isArray(msg?.mentions) ? msg.mentions : []
    for (const m of mentions) {
      const target = upsertMember(members, m)
      if (!target) continue
      if (!args.includeBots && target.isBot) continue
      if (target.id === author.id) continue
      if (seenMentioned.has(target.id)) continue
      seenMentioned.add(target.id)

      const key = directedKey(author.id, target.id)
      mentionDirected.set(key, (mentionDirected.get(key) || 0) + 1)
      author.mentionOut += 1
      target.mentionIn += 1
    }
  }

  timeline.sort((a, b) => a.ts - b.ts)

  const pairStats = new Map()

  for (const [key, count] of mentionDirected.entries()) {
    const { from, to } = parseDirectedKey(key)
    const pKey = undirectedKey(from, to)
    const pair = pairStats.get(pKey) || {
      aId: from < to ? from : to,
      bId: from < to ? to : from,
      mentionAB: 0,
      mentionBA: 0,
      mentionTotal: 0,
      temporalTurns: 0,
      temporalScore: 0,
      temporalDeltaSum: 0,
    }

    if (from === pair.aId && to === pair.bId) {
      pair.mentionAB += count
    } else {
      pair.mentionBA += count
    }
    pair.mentionTotal += count
    pairStats.set(pKey, pair)
  }

  for (let i = 0; i < timeline.length - 1; i++) {
    const anchor = timeline[i]
    const seenPartnerInWindow = new Set()

    for (let j = i + 1; j < timeline.length; j++) {
      const candidate = timeline[j]
      const deltaSec = (candidate.ts - anchor.ts) / 1000
      if (deltaSec <= 0) continue
      if (deltaSec > args.windowSeconds) break
      if (anchor.authorId === candidate.authorId) continue
      if (seenPartnerInWindow.has(candidate.authorId)) continue

      seenPartnerInWindow.add(candidate.authorId)

      const pKey = undirectedKey(anchor.authorId, candidate.authorId)
      const pair = pairStats.get(pKey) || {
        aId: anchor.authorId < candidate.authorId ? anchor.authorId : candidate.authorId,
        bId: anchor.authorId < candidate.authorId ? candidate.authorId : anchor.authorId,
        mentionAB: 0,
        mentionBA: 0,
        mentionTotal: 0,
        temporalTurns: 0,
        temporalScore: 0,
        temporalDeltaSum: 0,
      }

      const temporalWeight = Math.exp(-deltaSec / args.decaySeconds)
      pair.temporalTurns += 1
      pair.temporalScore += temporalWeight
      pair.temporalDeltaSum += deltaSec
      pairStats.set(pKey, pair)
    }
  }

  const pairs = Array.from(pairStats.values())
  const maxMention = Math.max(...pairs.map((p) => p.mentionTotal), 0)
  const maxTemporal = Math.max(...pairs.map((p) => p.temporalScore), 0)

  const edges = []
  for (const pair of pairs) {
    const mentionNorm = maxMention > 0 ? pair.mentionTotal / maxMention : 0
    const temporalNorm = maxTemporal > 0 ? pair.temporalScore / maxTemporal : 0
    const closeness = args.mentionWeight * mentionNorm + args.temporalWeight * temporalNorm

    const hasSignal = pair.mentionTotal > 0 || pair.temporalTurns >= args.minTemporalTurns
    if (!hasSignal || closeness < args.minScore) continue

    const a = members.get(pair.aId)
    const b = members.get(pair.bId)
    if (!a || !b) continue

    edges.push({
      sourceId: pair.aId,
      targetId: pair.bId,
      source: a.name,
      target: b.name,
      value: round(closeness, 4),
      mentionCount: pair.mentionTotal,
      mentionAB: pair.mentionAB,
      mentionBA: pair.mentionBA,
      mentionNorm: round(mentionNorm, 4),
      temporalTurns: pair.temporalTurns,
      temporalScore: round(pair.temporalScore, 4),
      temporalNorm: round(temporalNorm, 4),
      avgDeltaSec: pair.temporalTurns > 0 ? round(pair.temporalDeltaSum / pair.temporalTurns, 2) : null,
    })
  }

  edges.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value
    if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount
    return b.temporalScore - a.temporalScore
  })

  const keptEdges = edges.slice(0, Math.max(1, Math.floor(args.topEdges)))
  const involved = new Set()
  for (const e of keptEdges) {
    involved.add(e.sourceId)
    involved.add(e.targetId)
  }

  const nodes = Array.from(members.values())
    .filter((m) => involved.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      isBot: m.isBot,
      messageCount: m.messageCount,
      mentionOut: m.mentionOut,
      mentionIn: m.mentionIn,
    }))

  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  for (const edge of keptEdges) {
    const s = nodeById.get(edge.sourceId)
    const t = nodeById.get(edge.targetId)
    if (s) {
      s.degree = (s.degree || 0) + 1
      s.totalCloseness = round((s.totalCloseness || 0) + edge.value, 4)
    }
    if (t) {
      t.degree = (t.degree || 0) + 1
      t.totalCloseness = round((t.totalCloseness || 0) + edge.value, 4)
    }
  }

  nodes.sort((a, b) => {
    const bScore = b.totalCloseness || 0
    const aScore = a.totalCloseness || 0
    if (bScore !== aScore) return bScore - aScore
    return (b.messageCount || 0) - (a.messageCount || 0)
  })

  const model = {
    meta: {
      inputPath,
      generatedAt: new Date().toISOString(),
      messageCount: messages.length,
      timelineCount: timeline.length,
      memberCount: members.size,
      windowSeconds: args.windowSeconds,
      decaySeconds: args.decaySeconds,
      mentionWeight: round(args.mentionWeight, 4),
      temporalWeight: round(args.temporalWeight, 4),
      minScore: args.minScore,
      minTemporalTurns: args.minTemporalTurns,
      topEdges: args.topEdges,
      includeBots: args.includeBots,
      dateRange: payload?.dateRange || null,
      guild: payload?.guild || null,
      channel: payload?.channel || null,
    },
    stats: {
      maxMentionCount: maxMention,
      maxTemporalScore: round(maxTemporal, 4),
      rawEdgeCount: edges.length,
      keptEdgeCount: keptEdges.length,
      keptNodeCount: nodes.length,
    },
    nodes,
    edges: keptEdges,
    topRelations: keptEdges.slice(0, 20),
  }

  return model
}

function ensureParent(filePath) {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function buildMermaid(model) {
  const idMap = new Map()
  model.nodes.forEach((node, idx) => {
    idMap.set(node.id, `n${idx + 1}`)
  })

  const lines = []
  lines.push('%% Auto-generated by scripts/generate-member-relationship-graph.cjs')
  lines.push('%% Relation score = mentionWeight * mentionNorm + temporalWeight * temporalNorm')
  lines.push('graph LR')

  for (const node of model.nodes) {
    const nid = idMap.get(node.id)
    const label = `${escapeLabel(node.name)} | msg:${node.messageCount} | deg:${node.degree || 0}`
    lines.push(`  ${nid}["${label}"]`)
  }

  for (const edge of model.edges) {
    const s = idMap.get(edge.sourceId)
    const t = idMap.get(edge.targetId)
    if (!s || !t) continue
    const edgeLabel = `S:${edge.value} @:${edge.mentionCount} T:${edge.temporalTurns}`
    lines.push(`  ${s} ---|"${edgeLabel}"| ${t}`)
  }

  return lines.join('\n') + '\n'
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = pickInputFile(args.input)

  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const model = buildGraphModel(raw, args, inputPath)
  const mermaid = buildMermaid(model)

  ensureParent(args.outputJson)
  ensureParent(args.outputMermaid)

  fs.writeFileSync(args.outputJson, JSON.stringify(model, null, 2), 'utf8')
  fs.writeFileSync(args.outputMermaid, mermaid, 'utf8')

  const topPreview = model.topRelations.slice(0, 10).map((edge, i) => ({
    rank: i + 1,
    pair: `${edge.source} <-> ${edge.target}`,
    score: edge.value,
    mentionCount: edge.mentionCount,
    temporalTurns: edge.temporalTurns,
  }))

  console.log(`Input: ${inputPath}`)
  console.log(`Output JSON: ${args.outputJson}`)
  console.log(`Output Mermaid: ${args.outputMermaid}`)
  console.log(
    `Members: ${model.meta.memberCount}, Messages: ${model.meta.messageCount}, Nodes: ${model.stats.keptNodeCount}, Edges: ${model.stats.keptEdgeCount}`
  )
  console.log('Top relations:')
  for (const row of topPreview) {
    console.log(
      `${String(row.rank).padStart(2, '0')}. ${row.pair} | score=${row.score} | @=${row.mentionCount} | temporal=${row.temporalTurns}`
    )
  }
}

main()
