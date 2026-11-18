import mongoose from 'mongoose'
import { Monitor } from '../src/modules/monitors/monitor.model.js'

describe('Monitor model', () => {
  const valid = {
    workspaceId: new mongoose.Types.ObjectId(),
    name: 'Production API',
    url: 'https://status.example.com',
    intervalSeconds: 60,
  }

  it('applies defaults and timestamps fields', () => {
    const monitor = new Monitor(valid)
    expect(monitor.status).toBe('active')
    expect(monitor.currentStatus).toBe('unknown')
    expect(monitor.deletedAt).toBeNull()
    expect(monitor.slotSequence).toBe(0)
    expect(monitor.nextApplySequence).toBe(1)
    expect(monitor.schedulerEnqueueState).toBe('idle')
    expect(monitor.claimedSlotAt).toBeNull()
    expect(monitor.schedulerClaimToken).toBeNull()
    expect(monitor.schedulerClaimUntil).toBeNull()
    expect(monitor.schedulerRecoveryToken).toBeNull()
    expect(monitor.schedulerRecoveryUntil).toBeNull()
    expect(monitor.nextCheckAt).toBeInstanceOf(Date)
    expect(monitor.schema.options.timestamps).toBe(true)
    expect(monitor.validateSync()).toBeUndefined()
  })

  it.each([
    [{ ...valid, workspaceId: undefined }, 'workspaceId'],
    [{ ...valid, name: 'x' }, 'name'],
    [{ ...valid, intervalSeconds: 59 }, 'intervalSeconds'],
    [{ ...valid, intervalSeconds: 60.5 }, 'intervalSeconds'],
    [{ ...valid, status: 'deleted' }, 'status'],
    [{ ...valid, currentStatus: 'pending' }, 'currentStatus'],
    [{ ...valid, slotSequence: -1 }, 'slotSequence'],
    [{ ...valid, slotSequence: 1.5 }, 'slotSequence'],
    [{ ...valid, nextApplySequence: 0 }, 'nextApplySequence'],
    [{ ...valid, nextApplySequence: 2.5 }, 'nextApplySequence'],
    [{ ...valid, schedulerEnqueueState: 'claimed' }, 'schedulerEnqueueState'],
  ])('rejects invalid monitor values', (data, path) => {
    expect(new Monitor(data).validateSync()?.errors[path]).toBeDefined()
  })

  it('indexes workspace-scoped non-deleted list ordering', () => {
    expect(Monitor.schema.indexes()).toContainEqual([
      { workspaceId: 1, deletedAt: 1, _id: -1 },
      { background: true },
    ])
  })

  it('indexes active due scans and pending scheduler recovery scans', () => {
    const indexes = Monitor.schema.indexes()
    expect(indexes).toContainEqual([
      { status: 1, deletedAt: 1, schedulerEnqueueState: 1, nextCheckAt: 1, _id: 1 },
      { background: true },
    ])
    expect(indexes).toContainEqual([
      { schedulerClaimUntil: 1, schedulerRecoveryUntil: 1, _id: 1 },
      { partialFilterExpression: { schedulerEnqueueState: 'pending' }, background: true },
    ])
  })
})
