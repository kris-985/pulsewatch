import {
  createMonitorSchema,
  listMonitorsQuerySchema,
  monitorIdParamsSchema,
  updateMonitorSchema,
} from '../src/modules/monitors/monitor.schemas.js'

const validMonitor = { name: '  Production API  ', url: 'https://status.example.com' }

describe('Monitor schemas', () => {
  it('trims the name and defaults the interval to 60 seconds', () => {
    expect(createMonitorSchema.parse(validMonitor)).toEqual({
      name: 'Production API',
      url: 'https://status.example.com',
      intervalSeconds: 60,
    })
  })

  it.each(['http://status.example.com', 'https://status.example.com'])('accepts absolute HTTP(S) URL %s', (url) => {
    expect(createMonitorSchema.safeParse({ ...validMonitor, url }).success).toBe(true)
  })

  it.each(['ftp://status.example.com', '/status', 'not a URL'])('rejects invalid URL or protocol %s', (url) => {
    expect(createMonitorSchema.safeParse({ ...validMonitor, url }).success).toBe(false)
  })

  it('accepts a 60-second interval and rejects intervals below 60 or non-integers', () => {
    expect(createMonitorSchema.safeParse({ ...validMonitor, intervalSeconds: 60 }).success).toBe(true)
    expect(createMonitorSchema.safeParse({ ...validMonitor, intervalSeconds: 59 }).success).toBe(false)
    expect(createMonitorSchema.safeParse({ ...validMonitor, intervalSeconds: 60.5 }).success).toBe(false)
  })

  it.each([
    'workspaceId',
    'currentStatus',
    'deletedAt',
    'activeMonitorCount',
    'nextCheckAt',
    'claimedSlotAt',
    'schedulerClaimUntil',
    'executionUntil',
  ])('rejects client-supplied internal field %s', (field) => {
    expect(createMonitorSchema.safeParse({ ...validMonitor, [field]: 'forbidden' }).success).toBe(false)
  })

  it('allows partial edits to documented fields and lifecycle status', () => {
    expect(updateMonitorSchema.safeParse({ name: 'Renamed API' }).success).toBe(true)
    expect(updateMonitorSchema.safeParse({ status: 'paused' }).success).toBe(true)
    expect(updateMonitorSchema.safeParse({ status: 'deleted' }).success).toBe(false)
  })

  it('rejects an empty update and unknown update fields', () => {
    expect(updateMonitorSchema.safeParse({}).success).toBe(false)
    expect(updateMonitorSchema.safeParse({ workspaceId: 'forbidden' }).success).toBe(false)
    expect(updateMonitorSchema.safeParse({ activeMonitorCount: 1 }).success).toBe(false)
  })

  it('validates MongoDB ObjectId route params', () => {
    expect(monitorIdParamsSchema.safeParse({ monitorId: '507f1f77bcf86cd799439011' }).success).toBe(true)
    expect(monitorIdParamsSchema.safeParse({ monitorId: 'not-an-object-id' }).success).toBe(false)
  })

  it('defaults and bounds list query parameters', () => {
    expect(listMonitorsQuerySchema.parse({})).toEqual({ limit: 20 })
    expect(listMonitorsQuerySchema.parse({ limit: '100', cursor: 'opaque-cursor' })).toEqual({ limit: 100, cursor: 'opaque-cursor' })
    expect(listMonitorsQuerySchema.parse({ cursor: null })).toEqual({ limit: 20, cursor: null })
    expect(listMonitorsQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
    expect(listMonitorsQuerySchema.safeParse({ limit: '2.5' }).success).toBe(false)
    expect(listMonitorsQuerySchema.safeParse({ cursor: '' }).success).toBe(false)
  })
})
