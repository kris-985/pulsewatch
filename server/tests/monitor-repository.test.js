import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Monitor } from '../src/modules/monitors/monitor.model.js'
import {
  createMonitor,
  claimExpiredSchedulerClaim,
  claimNextCheckSlot,
  confirmSchedulerEnqueue,
  findDueMonitors,
  findExpiredSchedulerClaims,
  findMonitorById,
  findMonitorsByWorkspace,
  releaseSchedulerClaim,
  softDeleteMonitor,
  updateMonitor,
} from '../src/modules/monitors/monitor.repository.js'

describe('Monitor repository', () => {
  let spies
  beforeEach(() => {
    spies = [
      jest.spyOn(Monitor, 'create'),
      jest.spyOn(Monitor, 'findOne'),
      jest.spyOn(Monitor, 'find'),
      jest.spyOn(Monitor, 'findOneAndUpdate'),
    ]
  })
  afterEach(() => spies.forEach((spy) => spy.mockRestore()))

  it('creates a Monitor with the supplied Workspace and session', async () => {
    const workspaceId = 'workspace-a'
    const session = { id: 'session' }
    const document = { _id: 'monitor-a' }
    Monitor.create.mockResolvedValue([document])

    await expect(createMonitor(workspaceId, { name: 'API' }, session)).resolves.toBe(document)
    expect(Monitor.create).toHaveBeenCalledWith([{ name: 'API', workspaceId }], { session })
  })

  it('scopes find and update operations to the Workspace and excludes deleted records', () => {
    const query = { session: jest.fn().mockReturnThis() }
    Monitor.findOne.mockReturnValue(query)
    Monitor.findOneAndUpdate.mockReturnValue(query)
    const session = { id: 'session' }

    findMonitorById('workspace-a', 'monitor-a', { session })
    expect(Monitor.findOne).toHaveBeenCalledWith({ _id: 'monitor-a', workspaceId: 'workspace-a', deletedAt: null })
    expect(query.session).toHaveBeenCalledWith(session)

    updateMonitor('workspace-a', 'monitor-a', { name: 'Updated' }, { session })
    expect(Monitor.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'monitor-a', workspaceId: 'workspace-a', deletedAt: null },
      { $set: { name: 'Updated' } },
      { new: true, runValidators: true, session },
    )
  })

  it('lists only non-deleted Workspace records using cursor pagination', () => {
    const query = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), session: jest.fn().mockReturnThis() }
    Monitor.find.mockReturnValue(query)

    findMonitorsByWorkspace('workspace-a', { limit: 10, cursor: 'monitor-c', session: 'session' })
    expect(Monitor.find).toHaveBeenCalledWith({
      workspaceId: 'workspace-a', deletedAt: null, _id: { $lt: 'monitor-c' },
    })
    expect(query.sort).toHaveBeenCalledWith({ _id: -1 })
    expect(query.limit).toHaveBeenCalledWith(10)
    expect(query.session).toHaveBeenCalledWith('session')
  })

  it('soft deletes only a live Monitor in the specified Workspace', () => {
    const query = { result: true }
    Monitor.findOneAndUpdate.mockReturnValue(query)

    expect(softDeleteMonitor('workspace-a', 'monitor-a')).toBe(query)
    const [filter, update, options] = Monitor.findOneAndUpdate.mock.calls[0]
    expect(filter).toEqual({ _id: 'monitor-a', workspaceId: 'workspace-a', deletedAt: null })
    expect(update.$set.deletedAt).toBeInstanceOf(Date)
    expect(options).toMatchObject({ new: true, runValidators: true })
  })

  it('finds only due, active, non-deleted Monitors without a pending enqueue', () => {
    const query = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), session: jest.fn().mockReturnThis() }
    const now = new Date('2026-05-01T12:00:00Z')
    const session = { id: 'session' }
    Monitor.find.mockReturnValue(query)

    findDueMonitors({ now, limit: 25, session })

    const filter = Monitor.find.mock.calls[0][0]
    expect(filter).toMatchObject({ status: 'active', deletedAt: null, nextCheckAt: { $lte: now } })
    expect(filter.$or).toEqual([
      { schedulerEnqueueState: { $in: ['idle', 'enqueued'] } },
      { schedulerEnqueueState: { $exists: false } },
    ])
    expect(query.sort).toHaveBeenCalledWith({ nextCheckAt: 1, _id: 1 })
    expect(query.limit).toHaveBeenCalledWith(25)
    expect(query.session).toHaveBeenCalledWith(session)
  })

  it('atomically claims the expected due slot and moves nextCheckAt to a future slot', () => {
    const now = new Date('2026-05-01T12:03:00Z')
    const slotAt = new Date('2026-05-01T12:00:00Z')
    const claimUntil = new Date(now.getTime() + 30_000)
    const session = { id: 'session' }
    Monitor.findOneAndUpdate.mockReturnValue('claimed-monitor')

    expect(claimNextCheckSlot('monitor-1', {
      expectedNextCheckAt: slotAt,
      expectedIntervalSeconds: 60,
      now,
      claimToken: 'claim-a',
      claimUntil,
      session,
    })).toBe('claimed-monitor')

    const [filter, update, options] = Monitor.findOneAndUpdate.mock.calls[0]
    expect(filter).toMatchObject({
      _id: 'monitor-1',
      status: 'active',
      deletedAt: null,
      nextCheckAt: { $eq: slotAt, $lte: now },
      intervalSeconds: 60,
    })
    expect(filter.$or).toEqual([
      { schedulerEnqueueState: { $in: ['idle', 'enqueued'] } },
      { schedulerEnqueueState: { $exists: false } },
    ])
    expect(update.$set.claimedSlotAt).toEqual(slotAt)
    expect(update.$set.schedulerEnqueueState).toBe('pending')
    expect(update.$set.schedulerClaimToken).toBe('claim-a')
    expect(update.$set.schedulerClaimUntil).toEqual(claimUntil)
    expect(update.$set.nextCheckAt).toEqual(new Date('2026-05-01T12:04:00Z'))
    expect(update.$inc).toEqual({ slotSequence: 1 })
    expect(options).toMatchObject({ new: true, runValidators: true, session })
  })

  it('allows only one of two concurrent claims for the same slot', async () => {
    const slotAt = new Date('2026-05-01T12:00:00Z')
    const args = {
      expectedNextCheckAt: slotAt,
      expectedIntervalSeconds: 60,
      now: new Date('2026-05-01T12:00:01Z'),
      claimToken: 'scheduler-a',
      claimUntil: new Date('2026-05-01T12:00:31Z'),
    }
    Monitor.findOneAndUpdate.mockResolvedValueOnce({ _id: 'monitor-1' }).mockResolvedValueOnce(null)

    const results = await Promise.all([
      claimNextCheckSlot('monitor-1', args),
      claimNextCheckSlot('monitor-1', args),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(Monitor.findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(Monitor.findOneAndUpdate.mock.calls[0][0]).toEqual(Monitor.findOneAndUpdate.mock.calls[1][0])
    expect(Monitor.findOneAndUpdate.mock.calls[0][0].$or).toEqual([
      { schedulerEnqueueState: { $in: ['idle', 'enqueued'] } },
      { schedulerEnqueueState: { $exists: false } },
    ])
  })

  it('confirms enqueue only for a matching unexpired owner token', () => {
    const now = new Date('2026-05-01T12:00:00Z')
    Monitor.findOneAndUpdate.mockReturnValue(null)

    confirmSchedulerEnqueue('monitor-1', 'wrong-token', { now })

    const [filter, update] = Monitor.findOneAndUpdate.mock.calls[0]
    expect(filter).toMatchObject({
      _id: 'monitor-1', schedulerEnqueueState: 'pending', schedulerClaimToken: 'wrong-token',
      schedulerClaimUntil: { $gt: now },
    })
    expect(filter.$or).toEqual([
      { schedulerRecoveryToken: null },
      { schedulerRecoveryToken: { $exists: false } },
    ])
    expect(update.$set).toMatchObject({ schedulerEnqueueState: 'enqueued', schedulerClaimToken: null, schedulerClaimUntil: null })
  })

  it('requires the recovery token to confirm a recovered enqueue', () => {
    const now = new Date('2026-05-01T12:00:00Z')
    confirmSchedulerEnqueue('monitor-1', 'claim-token', { recoveryToken: 'recovery-token', now })

    const filter = Monitor.findOneAndUpdate.mock.calls[0][0]
    expect(filter).toMatchObject({
      schedulerClaimToken: 'claim-token',
      schedulerRecoveryToken: 'recovery-token',
      schedulerRecoveryUntil: { $gt: now },
    })
  })

  it('finds expired pending claims only when their recovery lease is also available', () => {
    const query = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis() }
    const now = new Date('2026-05-01T12:00:00Z')
    Monitor.find.mockReturnValue(query)

    findExpiredSchedulerClaims({ now, limit: 10 })

    const filter = Monitor.find.mock.calls[0][0]
    expect(filter.schedulerEnqueueState).toBe('pending')
    expect(filter.$and).toHaveLength(2)
    expect(filter.$and[0].$or).toContainEqual({ schedulerClaimUntil: { $lte: now } })
    expect(filter.$and[1].$or).toContainEqual({ schedulerRecoveryUntil: { $lte: now } })
    expect(query.sort).toHaveBeenCalledWith({ schedulerClaimUntil: 1, _id: 1 })
    expect(query.limit).toHaveBeenCalledWith(10)
  })

  it('atomically acquires and releases a recovery claim using its token', () => {
    const now = new Date('2026-05-01T12:00:00Z')
    const recoveryUntil = new Date(now.getTime() + 30_000)
    const retryAt = new Date(now.getTime() + 5_000)

    claimExpiredSchedulerClaim('monitor-1', { now, recoveryToken: 'recovery-a', recoveryUntil })
    let [filter, update] = Monitor.findOneAndUpdate.mock.calls[0]
    expect(filter).toMatchObject({ _id: 'monitor-1', schedulerEnqueueState: 'pending' })
    expect(filter.$and).toHaveLength(2)
    expect(update.$set).toEqual({ schedulerRecoveryToken: 'recovery-a', schedulerRecoveryUntil: recoveryUntil })

    releaseSchedulerClaim('monitor-1', 'claim-a', { recoveryToken: 'wrong-recovery-token', now, retryAt })
    ;[filter, update] = Monitor.findOneAndUpdate.mock.calls[1]
    expect(filter).toMatchObject({ schedulerClaimToken: 'claim-a', schedulerRecoveryToken: 'wrong-recovery-token' })
    expect(update.$set.schedulerClaimUntil).toEqual(retryAt)
    expect(update.$set.schedulerRecoveryToken).toBeNull()
  })

  it('prevents normal due claims for paused or soft-deleted Monitors', () => {
    const slotAt = new Date('2026-05-01T12:00:00Z')
    const dueQuery = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis() }
    Monitor.find.mockReturnValue(dueQuery)
    findDueMonitors({ now: new Date('2026-05-01T12:01:00Z') })
    expect(Monitor.find.mock.calls[0][0]).toMatchObject({ status: 'active', deletedAt: null })

    claimNextCheckSlot('monitor-1', {
      expectedNextCheckAt: slotAt,
      expectedIntervalSeconds: 60,
      now: new Date('2026-05-01T12:01:00Z'),
      claimToken: 'claim-a',
      claimUntil: new Date('2026-05-01T12:01:30Z'),
    })
    expect(Monitor.findOneAndUpdate.mock.calls[0][0]).toMatchObject({ status: 'active', deletedAt: null })
  })
})
