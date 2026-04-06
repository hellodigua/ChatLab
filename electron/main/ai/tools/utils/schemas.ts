/**
 * 共享 TypeBox Schema 片段
 * 多个工具复用的时间参数 schema
 */

import { Type } from '@mariozechner/pi-ai'

export const timeParamProperties = {
  start_time: Type.Optional(Type.String({ description: 'ai.tools._shared.params.start_time' })),
  end_time: Type.Optional(Type.String({ description: 'ai.tools._shared.params.end_time' })),
}
