import { z } from 'zod'

const monitorNameSchema = z.string().trim().min(2).max(80)
const monitorUrlSchema = z.url().max(2_048).refine((value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}, 'URL must use HTTP or HTTPS')
const intervalSecondsSchema = z.number().int().min(60)

export const createMonitorSchema = z.object({
  name: monitorNameSchema,
  url: monitorUrlSchema,
  intervalSeconds: intervalSecondsSchema.default(60),
}).strict()

export const updateMonitorSchema = z.object({
  name: monitorNameSchema,
  url: monitorUrlSchema,
  intervalSeconds: intervalSecondsSchema,
  status: z.enum(['active', 'paused']),
}).partial().strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one monitor field must be provided',
})

export const monitorIdParamsSchema = z.object({
  monitorId: z.string().regex(/^[\da-f]{24}$/i),
}).strict()

export const listMonitorsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).max(256).nullable().optional(),
}).strict()
