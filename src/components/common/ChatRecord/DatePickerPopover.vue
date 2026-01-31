<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  min?: string
  max?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const { t } = useI18n()

const isOpen = ref(false)
const draftValue = ref<DateValue | undefined>(undefined)
const placeholderValue = ref<DateValue>(today(getLocalTimeZone()))
const initialValue = ref<string>('')

function parseDateValue(value?: string): DateValue | undefined {
  if (!value) return undefined
  try {
    return parseDate(value)
  } catch {
    return undefined
  }
}

const minValue = computed(() => parseDateValue(props.min))
const maxValue = computed(() => parseDateValue(props.max))

const displayValue = computed(() => props.modelValue || '')

const yearOptions = computed(() => {
  const currentYear = today(getLocalTimeZone()).year
  const startYear = currentYear - 15
  const endYear = currentYear + 15
  return Array.from({ length: endYear - startYear + 1 }, (_, i) => {
    const value = startYear + i
    return { value, label: String(value) }
  })
})

const monthOptions = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const value = i + 1
    return { value, label: String(value).padStart(2, '0') }
  })
)

const selectedYear = computed({
  get: () => placeholderValue.value.year,
  set: (year: number) => {
    placeholderValue.value = placeholderValue.value.set({ year, day: 1 })
  },
})

const selectedMonth = computed({
  get: () => placeholderValue.value.month,
  set: (month: number) => {
    placeholderValue.value = placeholderValue.value.set({ month, day: 1 })
  },
})

function syncDraftFromModel() {
  const parsed = parseDateValue(props.modelValue)
  draftValue.value = parsed
  placeholderValue.value = parsed?.copy() ?? today(getLocalTimeZone())
}

watch(
  () => props.modelValue,
  () => {
    if (!isOpen.value) syncDraftFromModel()
  },
  { immediate: true }
)

watch(isOpen, (open) => {
  if (open) {
    initialValue.value = props.modelValue || ''
    syncDraftFromModel()
  }
})

watch(draftValue, (value) => {
  if (value) {
    placeholderValue.value = value.copy()
    emit('update:modelValue', value.toString())
  }
})

function confirmSelection() {
  isOpen.value = false
}

function cancelSelection() {
  emit('update:modelValue', initialValue.value)
  isOpen.value = false
}
</script>

<template>
  <UPopover v-model:open="isOpen" :portal="false" :ui="{ content: 'p-0 z-[10001]' }">
    <div class="w-32" role="button" tabindex="0">
      <UInput
        :model-value="displayValue"
        :placeholder="placeholder"
        :disabled="disabled"
        readonly
        size="sm"
      />
    </div>

    <template #content>
      <div
        class="w-[272px] rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-900"
      >
        <div class="flex items-center gap-2">
          <USelectMenu v-model="selectedYear" :items="yearOptions" value-key="value" size="sm" class="flex-1" />
          <USelectMenu v-model="selectedMonth" :items="monthOptions" value-key="value" size="sm" class="flex-1" />
        </div>

        <UCalendar
          v-model="draftValue"
          v-model:placeholder="placeholderValue"
          :min-value="minValue"
          :max-value="maxValue"
          :month-controls="false"
          :year-controls="false"
          :week-starts-on="1"
          :disable-days-outside-current-view="true"
          :ui="{
            root: 'mt-3 w-full',
            header: 'hidden',
            grid: 'w-full',
            gridWeekDaysRow: 'mb-1',
            headCell: 'text-[11px] font-medium text-gray-400 dark:text-gray-500',
            gridRow: 'mt-1',
            cell: 'p-0',
            cellTrigger:
              'mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm text-gray-700 hover:bg-gray-100 data-[selected]:bg-pink-500 data-[selected]:text-white data-[today]:font-semibold data-[today]:text-pink-500 data-[disabled]:text-gray-300 data-[outside-view]:text-gray-300 dark:text-gray-200 dark:hover:bg-gray-800 dark:data-[today]:text-pink-400 dark:data-[disabled]:text-gray-600 dark:data-[outside-view]:text-gray-700',
          }"
        />

        <div class="mt-3 flex items-center justify-end gap-2">
          <UButton color="neutral" variant="ghost" size="sm" @click="cancelSelection">
            {{ t('common.cancel') }}
          </UButton>
          <UButton color="primary" size="sm" @click="confirmSelection">
            {{ t('common.confirm') }}
          </UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>
