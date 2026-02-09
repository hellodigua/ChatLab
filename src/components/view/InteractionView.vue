<script setup lang="ts">
/**
 * 互动分析视图（群聊专属）
 * 支持两种模式：
 * 1. @ 互动图（旧模式）
 * 2. 关系模型图（@ + 时间相邻共现 + 互惠度）
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EChartGraph } from '@/components/charts'
import type { EChartGraphData } from '@/components/charts'
import { EmptyState, LoadingState, SectionCard } from '@/components/UI'
import type { RelationshipGraphOptions, RelationshipGraphData } from '@/types/analysis'

const { t } = useI18n()

interface TimeFilter {
  startTs?: number
  endTs?: number
}

type GraphMode = 'relationship' | 'mention'
type GraphLayout = 'circular' | 'force'

const DEFAULT_MODEL_OPTIONS: Required<RelationshipGraphOptions> = {
  mentionWeight: 0.45,
  temporalWeight: 0.4,
  reciprocityWeight: 0.15,
  windowSeconds: 300,
  decaySeconds: 120,
  minScore: 0.12,
  minTemporalTurns: 2,
  topEdges: 120,
}

const props = defineProps<{
  sessionId: string
  timeFilter?: TimeFilter
  memberId?: number | null
}>()

const graphMode = ref<GraphMode>('relationship')
const isLoading = ref(false)
const loadError = ref<string | null>(null)

const graphData = ref<EChartGraphData>({ nodes: [], links: [], maxLinkValue: 0 })
const relationshipMeta = ref<RelationshipGraphData | null>(null)

const layoutType = ref<GraphLayout>('force')
const showDirection = ref(false)
const showLegend = ref(true)
const relationViewMode = ref<'core' | 'full'>('core')
const minRenderScore = ref(0)
const hideIsolates = ref(true)
const selectedNodeName = ref<string | null>(null)
const graphRef = ref<InstanceType<typeof EChartGraph> | null>(null)
const requestSeq = ref(0)

const modelOptions = ref<Required<RelationshipGraphOptions>>({ ...DEFAULT_MODEL_OPTIONS })

const isRelationshipMode = computed(() => graphMode.value === 'relationship')

const graphSectionTitle = computed(() =>
  isRelationshipMode.value ? t('section.relationshipTitle') : t('section.mentionTitle')
)

const graphSectionDescription = computed(() =>
  isRelationshipMode.value ? t('section.relationshipDescription') : t('section.mentionDescription')
)

const weightSum = computed(
  () => modelOptions.value.mentionWeight + modelOptions.value.temporalWeight + modelOptions.value.reciprocityWeight
)

const graphHintText = computed(() => {
  if (isRelationshipMode.value && relationshipMeta.value) {
    return t('relationshipHint', {
      nodes: renderGraphData.value.nodes.length,
      links: renderGraphData.value.links.length,
      communities: relationshipMeta.value.communities.length,
    })
  }
  return t('graphHint', { nodes: renderGraphData.value.nodes.length, links: renderGraphData.value.links.length })
})

function toNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function toInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(toNumber(value, fallback, min, max))
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function createPlainFilter(): { startTs?: number; endTs?: number; memberId?: number | null } {
  return {
    startTs: props.timeFilter?.startTs,
    endTs: props.timeFilter?.endTs,
    memberId: props.memberId ?? null,
  }
}

function createPlainModelOptions(): RelationshipGraphOptions {
  return {
    mentionWeight: toNumber(modelOptions.value.mentionWeight, DEFAULT_MODEL_OPTIONS.mentionWeight, 0, 1),
    temporalWeight: toNumber(modelOptions.value.temporalWeight, DEFAULT_MODEL_OPTIONS.temporalWeight, 0, 1),
    reciprocityWeight: toNumber(modelOptions.value.reciprocityWeight, DEFAULT_MODEL_OPTIONS.reciprocityWeight, 0, 1),
    windowSeconds: toInteger(modelOptions.value.windowSeconds, DEFAULT_MODEL_OPTIONS.windowSeconds, 30, 3600),
    decaySeconds: toInteger(modelOptions.value.decaySeconds, DEFAULT_MODEL_OPTIONS.decaySeconds, 10, 3600),
    minScore: toNumber(modelOptions.value.minScore, DEFAULT_MODEL_OPTIONS.minScore, 0, 1),
    minTemporalTurns: toInteger(
      modelOptions.value.minTemporalTurns,
      DEFAULT_MODEL_OPTIONS.minTemporalTurns,
      0,
      50
    ),
    topEdges: toInteger(modelOptions.value.topEdges, DEFAULT_MODEL_OPTIONS.topEdges, 10, 500),
  }
}

function normalizeRelationshipData(raw: RelationshipGraphData | null | undefined): RelationshipGraphData {
  const data = raw || ({} as RelationshipGraphData)
  const stats = data.stats || {
    totalMembers: 0,
    involvedMembers: 0,
    rawEdgeCount: 0,
    keptEdges: 0,
    maxMentionCount: 0,
    maxTemporalScore: 0,
  }

  return {
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    links: Array.isArray(data.links) ? data.links : [],
    maxLinkValue: toNumber(data.maxLinkValue, 0, 0, Number.MAX_SAFE_INTEGER),
    communities: Array.isArray(data.communities)
      ? data.communities.map((item, index) => ({
          id: toInteger(item.id, index, 0, Number.MAX_SAFE_INTEGER),
          name: item.name || `Community ${index + 1}`,
          size: toInteger(item.size, 1, 1, Number.MAX_SAFE_INTEGER),
        }))
      : [],
    stats: {
      totalMembers: toInteger(stats.totalMembers, 0, 0, Number.MAX_SAFE_INTEGER),
      involvedMembers: toInteger(stats.involvedMembers, 0, 0, Number.MAX_SAFE_INTEGER),
      rawEdgeCount: toInteger(stats.rawEdgeCount, 0, 0, Number.MAX_SAFE_INTEGER),
      keptEdges: toInteger(stats.keptEdges, 0, 0, Number.MAX_SAFE_INTEGER),
      maxMentionCount: toInteger(stats.maxMentionCount, 0, 0, Number.MAX_SAFE_INTEGER),
      maxTemporalScore: round(toNumber(stats.maxTemporalScore, 0, 0, Number.MAX_SAFE_INTEGER), 4),
    },
    options: {
      ...DEFAULT_MODEL_OPTIONS,
      ...data.options,
    },
  }
}

function buildCoreGraphData(data: EChartGraphData): EChartGraphData {
  if (!data.links || data.links.length <= 8) return data

  const sortedLinks = [...data.links].sort((a, b) => (b.value || 0) - (a.value || 0))
  const targetCount = Math.min(sortedLinks.length, Math.max(8, Math.floor(sortedLinks.length * 0.55)))
  const scoreThreshold = sortedLinks[targetCount - 1]?.value || 0

  const candidateLinks = data.links.filter((link) => {
    const valueStrong = (link.value || 0) >= scoreThreshold
    const temporalStrong = (link.temporalTurns || 0) >= 3
    const mentionStrong = (link.mentionCount || 0) >= 2
    return valueStrong || temporalStrong || mentionStrong
  })

  const selectedLinks = candidateLinks.length >= 4 ? candidateLinks : sortedLinks.slice(0, targetCount)
  if (selectedLinks.length === 0) return data

  const degreeMap = new Map<string, number>()
  for (const link of selectedLinks) {
    degreeMap.set(link.source, (degreeMap.get(link.source) || 0) + 1)
    degreeMap.set(link.target, (degreeMap.get(link.target) || 0) + 1)
  }

  const keepNames = new Set<string>([...degreeMap.keys()])
  const hubCandidates = [...data.nodes]
    .sort((a, b) => (b.weightedDegree || b.value || 0) - (a.weightedDegree || a.value || 0))
    .slice(0, 3)
  for (const node of hubCandidates) {
    if (degreeMap.has(node.name)) keepNames.add(node.name)
  }

  const nodes = data.nodes.filter((node) => keepNames.has(node.name) && degreeMap.has(node.name))
  const nodeNames = new Set(nodes.map((node) => node.name))
  const links = selectedLinks.filter((link) => nodeNames.has(link.source) && nodeNames.has(link.target))
  const maxLinkValue = links.length > 0 ? Math.max(...links.map((link) => link.value || 0), 0) : 0

  return {
    nodes,
    links,
    maxLinkValue: maxLinkValue || data.maxLinkValue || 0,
    categories: data.categories,
  }
}

function recomputeMaxValue(links: EChartGraphData['links'], fallback: number): number {
  if (!links.length) return 0
  return Math.max(...links.map((item) => item.value || 0), 0, fallback)
}

const baseGraphData = computed<EChartGraphData>(() => {
  if (!isRelationshipMode.value) return graphData.value
  if (relationViewMode.value === 'full') return graphData.value
  return buildCoreGraphData(graphData.value)
})

const relationshipThresholdMax = computed(() => {
  if (!isRelationshipMode.value) return 1
  return Math.max(1, baseGraphData.value.maxLinkValue || 0)
})

const renderGraphData = computed<EChartGraphData>(() => {
  if (!isRelationshipMode.value) return graphData.value

  const minScore = Math.max(0, minRenderScore.value || 0)
  const links =
    minScore > 0 ? baseGraphData.value.links.filter((link) => (link.value || 0) >= minScore) : baseGraphData.value.links

  if (!hideIsolates.value) {
    return {
      ...baseGraphData.value,
      links,
      maxLinkValue: recomputeMaxValue(links, baseGraphData.value.maxLinkValue || 0),
    }
  }

  const nodeNames = new Set<string>()
  for (const link of links) {
    nodeNames.add(link.source)
    nodeNames.add(link.target)
  }

  const nodes = baseGraphData.value.nodes.filter((node) => nodeNames.has(node.name))
  const validNodeNames = new Set(nodes.map((node) => node.name))
  const normalizedLinks = links.filter((link) => validNodeNames.has(link.source) && validNodeNames.has(link.target))

  return {
    ...baseGraphData.value,
    nodes,
    links: normalizedLinks,
    maxLinkValue: recomputeMaxValue(normalizedLinks, baseGraphData.value.maxLinkValue || 0),
  }
})

const topRelationPairs = computed(() => {
  if (!isRelationshipMode.value) return []
  return [...renderGraphData.value.links]
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, 6)
    .map((link) => ({
      source: link.source,
      target: link.target,
      value: link.value || 0,
      mentionCount: link.mentionCount || 0,
      temporalTurns: link.temporalTurns || 0,
    }))
})

const selectedNode = computed(() =>
  selectedNodeName.value ? renderGraphData.value.nodes.find((node) => node.name === selectedNodeName.value) || null : null
)

const selectedNeighborPairs = computed(() => {
  if (!selectedNodeName.value) return []
  return renderGraphData.value.links
    .filter((link) => link.source === selectedNodeName.value || link.target === selectedNodeName.value)
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, 8)
    .map((link) => ({
      name: link.source === selectedNodeName.value ? link.target : link.source,
      value: link.value || 0,
      mentionCount: link.mentionCount || 0,
      temporalTurns: link.temporalTurns || 0,
      reciprocity: link.reciprocity || 0,
    }))
})

const selectedNeighborCount = computed(() => {
  if (!selectedNodeName.value) return 0
  return renderGraphData.value.links.filter(
    (link) => link.source === selectedNodeName.value || link.target === selectedNodeName.value
  ).length
})

const statCards = computed(() => {
  if (isRelationshipMode.value && relationshipMeta.value) {
    const cards = [
      {
        label: t('stat.members'),
        value: relationshipMeta.value.stats.involvedMembers,
        sub: `${t('stat.total')}: ${relationshipMeta.value.stats.totalMembers}`,
      },
      {
        label: t('stat.edges'),
        value: relationshipMeta.value.stats.keptEdges,
        sub: `${t('stat.raw')}: ${relationshipMeta.value.stats.rawEdgeCount}`,
      },
      {
        label: t('stat.communities'),
        value: relationshipMeta.value.communities.length,
        sub: t('stat.maxTemporal', { value: relationshipMeta.value.stats.maxTemporalScore.toFixed(2) }),
      },
    ]
    if (renderGraphData.value.links.length !== baseGraphData.value.links.length) {
      cards.push({
        label: t('stat.displayEdges'),
        value: renderGraphData.value.links.length,
        sub: t('stat.coreView'),
      })
    }
    return cards
  }

  return [
    { label: t('stat.members'), value: graphData.value.nodes.length, sub: t('stat.mentionMode') },
    { label: t('stat.edges'), value: graphData.value.links.length, sub: t('stat.mentionHint') },
  ]
})

function normalizeWeights() {
  const sum = weightSum.value
  if (sum <= 0) {
    modelOptions.value = { ...modelOptions.value, ...DEFAULT_MODEL_OPTIONS }
    return
  }
  modelOptions.value.mentionWeight = round(modelOptions.value.mentionWeight / sum)
  modelOptions.value.temporalWeight = round(modelOptions.value.temporalWeight / sum)
  modelOptions.value.reciprocityWeight = round(modelOptions.value.reciprocityWeight / sum)
}

function resetModelOptions() {
  modelOptions.value = { ...DEFAULT_MODEL_OPTIONS }
  loadData()
}

function handleResetView() {
  graphRef.value?.resetView()
}

function handleNodeClick(nodeName: string | null) {
  selectedNodeName.value = nodeName
}

function clearNodeSelection() {
  selectedNodeName.value = null
}

async function loadData() {
  if (!props.sessionId) return
  const currentRequest = ++requestSeq.value

  isLoading.value = true
  loadError.value = null

  try {
    if (isRelationshipMode.value) {
      normalizeWeights()
      const response = await window.chatApi.getRelationshipGraph(
        props.sessionId,
        createPlainFilter(),
        createPlainModelOptions()
      )
      if (currentRequest !== requestSeq.value) return
      const data = normalizeRelationshipData(response)
      relationshipMeta.value = data
      graphData.value = {
        nodes: data.nodes,
        links: data.links,
        maxLinkValue: data.maxLinkValue,
        categories: data.communities.map((item) => ({ name: item.name })),
      }
    } else {
      const data = await window.chatApi.getMentionGraph(props.sessionId, createPlainFilter())
      if (currentRequest !== requestSeq.value) return
      relationshipMeta.value = null
      graphData.value = {
        nodes: Array.isArray(data?.nodes) ? data.nodes : [],
        links: Array.isArray(data?.links) ? data.links : [],
        maxLinkValue: toNumber(data?.maxLinkValue, 0, 0, Number.MAX_SAFE_INTEGER),
      }
    }
  } catch (error) {
    if (currentRequest !== requestSeq.value) return
    console.error('加载互动关系图数据失败:', error)
    loadError.value = isRelationshipMode.value ? t('loadFailedRelationship') : t('loadFailedMention')
    graphData.value = { nodes: [], links: [], maxLinkValue: 0 }
    relationshipMeta.value = null
  } finally {
    if (currentRequest === requestSeq.value) {
      isLoading.value = false
    }
  }
}

function applyModelOptions() {
  loadData()
}

watch(
  () => relationshipThresholdMax.value,
  (maxScore) => {
    if (minRenderScore.value > maxScore) {
      minRenderScore.value = maxScore
    }
  }
)

watch(
  () => renderGraphData.value.nodes,
  (nodes) => {
    if (!selectedNodeName.value) return
    if (!nodes.some((node) => node.name === selectedNodeName.value)) {
      selectedNodeName.value = null
    }
  },
  { deep: true }
)

watch(
  () => [props.sessionId, props.timeFilter?.startTs, props.timeFilter?.endTs, props.memberId, graphMode.value],
  () => {
    selectedNodeName.value = null
    loadData()
  },
  { immediate: true }
)
</script>

<template>
  <div class="main-content space-y-6 p-6">
    <SectionCard :title="t('controls.title')" :description="t('controls.description')">
      <div class="space-y-4 p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <UButtonGroup size="xs">
              <UButton
                :color="graphMode === 'relationship' ? 'primary' : 'neutral'"
                :variant="graphMode === 'relationship' ? 'solid' : 'outline'"
                @click="graphMode = 'relationship'"
              >
                {{ t('mode.relationship') }}
              </UButton>
              <UButton
                :color="graphMode === 'mention' ? 'primary' : 'neutral'"
                :variant="graphMode === 'mention' ? 'solid' : 'outline'"
                @click="graphMode = 'mention'"
              >
                {{ t('mode.mention') }}
              </UButton>
            </UButtonGroup>

            <UButtonGroup size="xs">
              <UButton
                :color="layoutType === 'force' ? 'primary' : 'neutral'"
                :variant="layoutType === 'force' ? 'solid' : 'ghost'"
                @click="layoutType = 'force'"
              >
                {{ t('layout.force') }}
              </UButton>
              <UButton
                :color="layoutType === 'circular' ? 'primary' : 'neutral'"
                :variant="layoutType === 'circular' ? 'solid' : 'ghost'"
                @click="layoutType = 'circular'"
              >
                {{ t('layout.circular') }}
              </UButton>
            </UButtonGroup>

            <UButtonGroup v-if="isRelationshipMode" size="xs">
              <UButton
                :color="relationViewMode === 'core' ? 'primary' : 'neutral'"
                :variant="relationViewMode === 'core' ? 'solid' : 'ghost'"
                @click="relationViewMode = 'core'"
              >
                {{ t('viewMode.core') }}
              </UButton>
              <UButton
                :color="relationViewMode === 'full' ? 'primary' : 'neutral'"
                :variant="relationViewMode === 'full' ? 'solid' : 'ghost'"
                @click="relationViewMode = 'full'"
              >
                {{ t('viewMode.full') }}
              </UButton>
            </UButtonGroup>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>{{ t('directed') }}</span>
              <USwitch v-model="showDirection" size="xs" />
            </div>
            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>{{ t('legend') }}</span>
              <USwitch v-model="showLegend" size="xs" />
            </div>

            <UPopover v-if="isRelationshipMode" :ui="{ content: 'w-[360px] p-4' }">
              <UButton size="xs" color="primary" variant="soft" icon="i-heroicons-adjustments-horizontal">
                {{ t('modelSettings') }}
              </UButton>
              <template #content>
                <div class="space-y-4">
                  <div>
                    <p class="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">{{ t('weightTitle') }}</p>
                    <div class="space-y-3">
                      <div>
                        <div class="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span>{{ t('weight.mention') }}</span>
                          <span>{{ modelOptions.mentionWeight.toFixed(2) }}</span>
                        </div>
                        <USlider v-model="modelOptions.mentionWeight" :min="0" :max="1" :step="0.01" />
                      </div>
                      <div>
                        <div class="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span>{{ t('weight.temporal') }}</span>
                          <span>{{ modelOptions.temporalWeight.toFixed(2) }}</span>
                        </div>
                        <USlider v-model="modelOptions.temporalWeight" :min="0" :max="1" :step="0.01" />
                      </div>
                      <div>
                        <div class="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          <span>{{ t('weight.reciprocity') }}</span>
                          <span>{{ modelOptions.reciprocityWeight.toFixed(2) }}</span>
                        </div>
                        <USlider v-model="modelOptions.reciprocityWeight" :min="0" :max="1" :step="0.01" />
                      </div>
                    </div>
                    <p class="mt-2 text-xs text-gray-400 dark:text-gray-500">
                      {{ t('weightTotal', { value: weightSum.toFixed(2) }) }}
                    </p>
                  </div>

                  <div class="grid grid-cols-2 gap-3">
                    <div>
                      <p class="mb-1 text-xs text-gray-500 dark:text-gray-400">{{ t('windowSeconds') }}</p>
                      <UInput v-model.number="modelOptions.windowSeconds" type="number" :min="30" :step="30" size="xs" />
                    </div>
                    <div>
                      <p class="mb-1 text-xs text-gray-500 dark:text-gray-400">{{ t('decaySeconds') }}</p>
                      <UInput v-model.number="modelOptions.decaySeconds" type="number" :min="10" :step="10" size="xs" />
                    </div>
                    <div>
                      <p class="mb-1 text-xs text-gray-500 dark:text-gray-400">{{ t('minScore') }}</p>
                      <UInput
                        v-model.number="modelOptions.minScore"
                        type="number"
                        :min="0"
                        :max="1"
                        :step="0.01"
                        size="xs"
                      />
                    </div>
                    <div>
                      <p class="mb-1 text-xs text-gray-500 dark:text-gray-400">{{ t('minTemporalTurns') }}</p>
                      <UInput v-model.number="modelOptions.minTemporalTurns" type="number" :min="0" :step="1" size="xs" />
                    </div>
                    <div class="col-span-2">
                      <p class="mb-1 text-xs text-gray-500 dark:text-gray-400">{{ t('topEdges') }}</p>
                      <UInput v-model.number="modelOptions.topEdges" type="number" :min="10" :step="10" size="xs" />
                    </div>
                  </div>

                  <div class="flex items-center justify-end gap-2 pt-1">
                    <UButton size="xs" color="neutral" variant="outline" @click="resetModelOptions">
                      {{ t('resetModel') }}
                    </UButton>
                    <UButton size="xs" color="primary" @click="applyModelOptions">{{ t('apply') }}</UButton>
                  </div>
                </div>
              </template>
            </UPopover>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            v-for="item in statCards"
            :key="item.label"
            color="neutral"
            variant="soft"
            class="border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <span class="font-semibold">{{ item.label }}:</span>
            <span class="ml-1">{{ item.value }}</span>
            <span v-if="item.sub" class="ml-1 text-gray-500 dark:text-gray-400">{{ item.sub }}</span>
          </UBadge>
        </div>

        <div v-if="isRelationshipMode" class="grid gap-3 rounded-xl border border-gray-200/80 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-gray-900/50 md:grid-cols-[minmax(0,1fr),auto]">
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{{ t('minRenderScore') }}</span>
              <span>{{ minRenderScore.toFixed(2) }} / {{ relationshipThresholdMax.toFixed(2) }}</span>
            </div>
            <USlider
              v-model="minRenderScore"
              :min="0"
              :max="relationshipThresholdMax"
              :step="0.01"
              :disabled="relationshipThresholdMax <= 0"
            />
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{{ t('hideIsolates') }}</span>
            <USwitch v-model="hideIsolates" size="xs" />
          </div>
        </div>
      </div>
    </SectionCard>

    <SectionCard :title="graphSectionTitle" :description="graphSectionDescription" :show-divider="false">
      <template #headerRight>
        <UButton size="xs" color="neutral" variant="ghost" icon="i-heroicons-arrow-path" @click="handleResetView">
          {{ t('resetView') }}
        </UButton>
      </template>

      <div class="relative h-[58vh] min-h-[420px]">
        <div
          class="pointer-events-none absolute inset-0 bg-gradient-to-br from-pink-50/50 via-white to-indigo-50/55 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800"
        />
        <div
          class="pointer-events-none absolute inset-0 opacity-35 dark:opacity-20"
          style="background-image: radial-gradient(circle at 1px 1px, rgba(148,163,184,0.2) 1px, transparent 0); background-size: 18px 18px;"
        />

        <LoadingState v-if="isLoading" variant="overlay" :text="t('loading')" />

        <div v-if="!isLoading && loadError" class="flex h-full items-center justify-center px-5 text-sm text-red-500">
          {{ loadError }}
        </div>

        <template v-else-if="renderGraphData.nodes.length > 0">
          <EChartGraph
            ref="graphRef"
            :data="renderGraphData"
            :layout="layoutType"
            :directed="showDirection"
            :height="'100%'"
            :show-legend="showLegend && isRelationshipMode"
            :neon="isRelationshipMode"
            :selected-node="selectedNodeName"
            @node-click="handleNodeClick"
          />

          <div
            v-if="isRelationshipMode"
            class="absolute right-3 top-3 z-10 w-[320px] max-w-[calc(100%-24px)] rounded-xl border border-gray-200/90 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/85 md:w-[320px]"
          >
            <div class="mb-2 flex items-center justify-between">
              <h4 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {{ selectedNode ? t('selectedNode') : t('insightTitle') }}
              </h4>
              <UButton
                v-if="selectedNode"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-heroicons-x-mark"
                @click="clearNodeSelection"
              >
                {{ t('clearFocus') }}
              </UButton>
            </div>

            <template v-if="selectedNode">
              <div class="rounded-lg border border-pink-100 bg-pink-50/70 p-2.5 dark:border-pink-900/40 dark:bg-pink-900/20">
                <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ selectedNode.name }}</p>
                <p class="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  {{ t('neighborCount', { count: selectedNeighborCount }) }}
                </p>
              </div>
              <div class="mt-2 max-h-[230px] space-y-2 overflow-auto pr-1">
                <div v-for="item in selectedNeighborPairs" :key="`${selectedNode.name}-${item.name}`" class="rounded-lg border border-gray-200/80 bg-gray-50/85 p-2 dark:border-gray-700 dark:bg-gray-800/70">
                  <div class="flex items-center justify-between gap-2">
                    <span class="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{{ item.name }}</span>
                    <span class="text-xs text-pink-600 dark:text-pink-300">{{ item.value.toFixed(2) }}</span>
                  </div>
                  <div class="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      class="h-full rounded-full bg-gradient-to-r from-pink-500 to-indigo-500"
                      :style="{ width: `${Math.min(100, (item.value / Math.max(0.01, renderGraphData.maxLinkValue || 1)) * 100)}%` }"
                    />
                  </div>
                  <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    @ {{ item.mentionCount }} · {{ t('temporalTurns') }} {{ item.temporalTurns }} · {{ t('reciprocity') }}
                    {{ item.reciprocity.toFixed(2) }}
                  </p>
                </div>
                <p v-if="selectedNeighborPairs.length === 0" class="py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                  {{ t('noStrongLinks') }}
                </p>
              </div>
            </template>

            <template v-else>
              <p class="mb-2 text-xs text-gray-500 dark:text-gray-400">{{ t('focusHint') }}</p>
              <div class="max-h-[250px] space-y-2 overflow-auto pr-1">
                <div
                  v-for="item in topRelationPairs"
                  :key="`${item.source}-${item.target}`"
                  class="rounded-lg border border-gray-200/80 bg-gray-50/85 p-2 dark:border-gray-700 dark:bg-gray-800/70"
                >
                  <div class="flex items-center justify-between gap-2">
                    <p class="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                      {{ item.source }} ↔ {{ item.target }}
                    </p>
                    <span class="text-xs text-pink-600 dark:text-pink-300">{{ item.value.toFixed(2) }}</span>
                  </div>
                  <div class="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      class="h-full rounded-full bg-gradient-to-r from-rose-500 to-fuchsia-500"
                      :style="{ width: `${Math.min(100, (item.value / Math.max(0.01, renderGraphData.maxLinkValue || 1)) * 100)}%` }"
                    />
                  </div>
                  <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                    @ {{ item.mentionCount }} · {{ t('temporalTurns') }} {{ item.temporalTurns }}
                  </p>
                </div>
                <p v-if="topRelationPairs.length === 0" class="py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                  {{ t('noStrongLinks') }}
                </p>
              </div>
            </template>
          </div>

          <div
            class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-gray-200 bg-white/95 px-3 py-1 text-xs text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-300"
          >
            {{ graphHintText }}
          </div>
        </template>

        <div v-else-if="!isLoading" class="flex h-full items-center justify-center">
          <EmptyState :text="t('noInteraction')" padding="lg" />
        </div>
      </div>
    </SectionCard>
  </div>
</template>

<i18n>
{
  "zh-CN": {
    "controls": {
      "title": "互动关系模型",
      "description": "基于 {'@'} 互动、相邻时间共现与互惠度推测成员关系"
    },
    "section": {
      "relationshipTitle": "关系模型图谱",
      "relationshipDescription": "用于推测成员之间潜在亲近关系",
      "mentionTitle": "{'@'} 互动图谱",
      "mentionDescription": "仅展示显式 {'@'} 互动边"
    },
    "mode": {
      "relationship": "关系模型",
      "mention": "艾特图"
    },
    "viewMode": {
      "core": "核心关系",
      "full": "全部关系"
    },
    "layout": {
      "force": "力导向",
      "circular": "环形"
    },
    "directed": "有向",
    "legend": "图例",
    "resetView": "重置视图",
    "modelSettings": "模型参数",
    "weightTitle": "特征权重（会自动归一化）",
    "weightTotal": "权重总和：{value}",
    "weight": {
      "mention": "{'@'} 互动",
      "temporal": "时间相邻",
      "reciprocity": "互惠度"
    },
    "windowSeconds": "时间窗口(秒)",
    "decaySeconds": "衰减常数(秒)",
    "minScore": "最小关系分",
    "minTemporalTurns": "最小时序共现",
    "topEdges": "最多边数",
    "minRenderScore": "可视化强度阈值",
    "hideIsolates": "隐藏孤立成员",
    "insightTitle": "关系洞察",
    "selectedNode": "成员焦点",
    "clearFocus": "清除焦点",
    "focusHint": "点击图中的成员查看其最强联系",
    "neighborCount": "可见邻接关系 {count} 条",
    "noStrongLinks": "当前筛选下暂无明显关系",
    "temporalTurns": "时序共现",
    "reciprocity": "互惠度",
    "resetModel": "恢复默认",
    "apply": "应用参数",
    "graphHint": "共 {nodes} 位成员，{links} 条互动边",
    "relationshipHint": "共 {nodes} 位成员，{links} 条关系边，{communities} 个社群",
    "noInteraction": "暂无互动关系数据",
    "loading": "正在加载互动关系图...",
    "loadFailedRelationship": "加载关系图失败，请稍后重试",
    "loadFailedMention": "加载 {'@'} 互动图失败，请稍后重试",
    "stat": {
      "members": "成员",
      "edges": "边",
      "communities": "社群",
      "total": "总成员",
      "raw": "候选边",
      "displayEdges": "展示边",
      "coreView": "核心视图",
      "maxTemporal": "时序强度峰值 {value}",
      "mentionMode": "艾特模式",
      "mentionHint": "仅统计 {'@'} 边"
    }
  },
  "en-US": {
    "mode": {
      "relationship": "Relation Model",
      "mention": "Mention Graph"
    },
    "viewMode": {
      "core": "Core",
      "full": "All"
    },
    "layout": {
      "force": "Force",
      "circular": "Circular"
    },
    "controls": {
      "title": "Interaction Relation Model",
      "description": "Estimate member closeness from mentions, temporal adjacency, and reciprocity"
    },
    "section": {
      "relationshipTitle": "Relationship Graph",
      "relationshipDescription": "Potential closeness inferred from behavior signals",
      "mentionTitle": "Mention Graph",
      "mentionDescription": "Explicit {'@'} mention interactions only"
    },
    "directed": "Directed",
    "legend": "Legend",
    "resetView": "Reset View",
    "modelSettings": "Model Settings",
    "weightTitle": "Feature weights (auto normalized)",
    "weightTotal": "Weight sum: {value}",
    "weight": {
      "mention": "{'@'} Mention",
      "temporal": "Temporal",
      "reciprocity": "Reciprocity"
    },
    "windowSeconds": "Window (sec)",
    "decaySeconds": "Decay (sec)",
    "minScore": "Min Score",
    "minTemporalTurns": "Min Temporal Turns",
    "topEdges": "Max Edges",
    "minRenderScore": "Display strength threshold",
    "hideIsolates": "Hide isolates",
    "insightTitle": "Relationship Insights",
    "selectedNode": "Member Focus",
    "clearFocus": "Clear",
    "focusHint": "Click a member node to inspect strongest links",
    "neighborCount": "{count} visible connected links",
    "noStrongLinks": "No strong links under current filter",
    "temporalTurns": "Temporal turns",
    "reciprocity": "Reciprocity",
    "resetModel": "Reset Defaults",
    "apply": "Apply",
    "graphHint": "{nodes} members, {links} interaction edges",
    "relationshipHint": "{nodes} members, {links} edges, {communities} communities",
    "noInteraction": "No interaction data",
    "loading": "Loading interaction graph...",
    "loadFailedRelationship": "Failed to load relationship graph",
    "loadFailedMention": "Failed to load {'@'} mention graph",
    "stat": {
      "members": "Members",
      "edges": "Edges",
      "communities": "Communities",
      "total": "Total",
      "raw": "Raw edges",
      "displayEdges": "Shown edges",
      "coreView": "Core view",
      "maxTemporal": "Peak temporal {value}",
      "mentionMode": "Mention mode",
      "mentionHint": "{'@'}-only edges"
    }
  }
}
</i18n>
