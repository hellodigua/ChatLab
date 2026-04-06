/**
 * 时间参数解析工具
 */

export interface ExtendedTimeParams {
  start_time?: string // 格式: "YYYY-MM-DD HH:mm"
  end_time?: string // 格式: "YYYY-MM-DD HH:mm"
}

/**
 * 解析时间参数，返回时间过滤器
 * 优先级: start_time/end_time > context.timeFilter
 */
export function parseExtendedTimeParams(
  params: ExtendedTimeParams,
  contextTimeFilter?: { startTs: number; endTs: number }
): { startTs: number; endTs: number } | undefined {
  if (params.start_time || params.end_time) {
    let startTs: number | undefined
    let endTs: number | undefined

    if (params.start_time) {
      const startDate = new Date(params.start_time.replace(' ', 'T'))
      if (!isNaN(startDate.getTime())) {
        startTs = Math.floor(startDate.getTime() / 1000)
      }
    }

    if (params.end_time) {
      const endDate = new Date(params.end_time.replace(' ', 'T'))
      if (!isNaN(endDate.getTime())) {
        endTs = Math.floor(endDate.getTime() / 1000)
      }
    }

    if (startTs !== undefined || endTs !== undefined) {
      return {
        startTs: startTs ?? 0,
        endTs: endTs ?? Math.floor(Date.now() / 1000),
      }
    }
  }

  return contextTimeFilter
}
