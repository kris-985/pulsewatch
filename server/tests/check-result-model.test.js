import mongoose from 'mongoose'
import { CheckResult } from '../src/modules/monitors/check-result.model.js'

describe('CheckResult model', () => {
  const valid = {
    workspaceId: new mongoose.Types.ObjectId(),
    monitorId: new mongoose.Types.ObjectId(),
    slotId: 'monitor-slot-1720000000000',
    slotSequence: 1,
    scheduledAt: new Date('2026-01-01T00:00:00.000Z'),
  }

  it('defaults to pending without an expiration and enables timestamps', () => {
    const result = new CheckResult(valid)

    expect(result.status).toBe('pending')
    expect(result.expiresAt).toBeNull()
    expect(result.schema.options.timestamps).toBe(true)
    expect(result.validateSync()).toBeUndefined()
  })

  it.each([
    [{ ...valid, workspaceId: 'bad-id' }, 'workspaceId'],
    [{ ...valid, monitorId: 'bad-id' }, 'monitorId'],
    [{ ...valid, slotId: '' }, 'slotId'],
    [{ ...valid, slotId: undefined }, 'slotId'],
    [{ ...valid, slotSequence: 0 }, 'slotSequence'],
    [{ ...valid, slotSequence: 1.5 }, 'slotSequence'],
    [{ ...valid, scheduledAt: undefined }, 'scheduledAt'],
    [{ ...valid, status: 'failed' }, 'status'],
    [{ ...valid, httpStatusCode: 99 }, 'httpStatusCode'],
    [{ ...valid, responseTimeMs: -1 }, 'responseTimeMs'],
    [{ ...valid, checkOutcome: 'unknown' }, 'checkOutcome'],
    [{ ...valid, expiresAt: new Date(), status: 'pending' }, 'expiresAt'],
  ])('rejects invalid values at %s', (data, path) => {
    expect(new CheckResult(data).validateSync()?.errors[path]).toBeDefined()
  })

  it('defines unique slot identity, pending apply, and date-only TTL indexes', () => {
    const indexes = CheckResult.schema.indexes()

    expect(indexes).toContainEqual([
      { monitorId: 1, slotId: 1 },
      { unique: true, background: true },
    ])
    expect(indexes).toContainEqual([
      { monitorId: 1, slotSequence: 1 },
      { partialFilterExpression: { status: 'pending' }, background: true },
    ])
    expect(indexes).toContainEqual([
      { expiresAt: 1 },
      {
        expireAfterSeconds: 0,
        partialFilterExpression: { expiresAt: { $type: 'date' } },
        background: true,
      },
    ])
  })
})
