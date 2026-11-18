import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { CheckResult } from '../src/modules/monitors/check-result.model.js'
import {
  createCheckResult,
  findCheckResultBySlot,
  findPendingCheckResults,
  markCheckResultApplied,
  markCheckResultSkipped,
} from '../src/modules/monitors/check-result.repository.js'

describe('CheckResult repository', () => {
  let spies

  beforeEach(() => {
    spies = [
      jest.spyOn(CheckResult, 'create'),
      jest.spyOn(CheckResult, 'findOne'),
      jest.spyOn(CheckResult, 'find'),
      jest.spyOn(CheckResult, 'findOneAndUpdate'),
    ]
  })

  afterEach(() => spies.forEach((spy) => spy.mockRestore()))

  it('creates a pending result without expiration and forwards a MongoDB session', async () => {
    const session = { id: 'transaction-session' }
    const data = {
      workspaceId: 'workspace-id',
      monitorId: 'monitor-id',
      slotId: 'slot-1',
      slotSequence: 1,
      scheduledAt: new Date(),
      status: 'applied',
      expiresAt: new Date(),
      ignoredField: 'not persisted',
    }
    const document = { _id: 'result-id', status: 'pending', expiresAt: null }
    CheckResult.create.mockResolvedValue([document])

    await expect(createCheckResult(data, session)).resolves.toBe(document)
    expect(CheckResult.create).toHaveBeenCalledWith([{
      workspaceId: 'workspace-id',
      monitorId: 'monitor-id',
      slotId: 'slot-1',
      slotSequence: 1,
      scheduledAt: data.scheduledAt,
      status: 'pending',
      expiresAt: null,
    }], { session })
  })

  it('finds a result by monitor and stable slot ID with session support', () => {
    const query = { session: jest.fn().mockReturnThis() }
    const session = { id: 'transaction-session' }
    CheckResult.findOne.mockReturnValue(query)

    expect(findCheckResultBySlot('monitor-id', 'slot-1', { session })).toBe(query)
    expect(CheckResult.findOne).toHaveBeenCalledWith({ monitorId: 'monitor-id', slotId: 'slot-1' })
    expect(query.session).toHaveBeenCalledWith(session)
  })

  it('queries pending results after a sequence in ascending sequence order', () => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
    }
    const session = { id: 'transaction-session' }
    CheckResult.find.mockReturnValue(query)

    expect(findPendingCheckResults('monitor-id', { afterSequence: 4, limit: 20, session })).toBe(query)
    expect(CheckResult.find).toHaveBeenCalledWith({
      monitorId: 'monitor-id',
      status: 'pending',
      slotSequence: { $gt: 4 },
    })
    expect(query.sort).toHaveBeenCalledWith({ slotSequence: 1 })
    expect(query.limit).toHaveBeenCalledWith(20)
    expect(query.session).toHaveBeenCalledWith(session)
  })

  it.each([
    ['applied', markCheckResultApplied],
    ['skipped', markCheckResultSkipped],
  ])('atomically changes only pending results to %s and applies 30-day expiry', (status, markStatus) => {
    const query = { result: true }
    const session = { id: 'transaction-session' }
    const before = Date.now()
    CheckResult.findOneAndUpdate.mockReturnValue(query)

    expect(markStatus('monitor-id', 'slot-1', { session })).toBe(query)
    const [filter, update, options] = CheckResult.findOneAndUpdate.mock.calls[0]
    expect(filter).toEqual({ monitorId: 'monitor-id', slotId: 'slot-1', status: 'pending' })
    expect(update.$set.status).toBe(status)
    expect(update.$set.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1_000)
    expect(update.$set.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 24 * 60 * 60 * 1_000)
    expect(update.$set).toHaveProperty('expiresAt')
    expect(options).toMatchObject({ new: true, runValidators: true, session })
  })

  it('does not allow terminal-to-terminal transitions', () => {
    CheckResult.findOneAndUpdate.mockReturnValue(null)

    markCheckResultApplied('monitor-id', 'slot-1')
    markCheckResultSkipped('monitor-id', 'slot-1')

    expect(CheckResult.findOneAndUpdate.mock.calls[0][0].status).toBe('pending')
    expect(CheckResult.findOneAndUpdate.mock.calls[1][0].status).toBe('pending')
  })
})
