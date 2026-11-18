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
  ])('rejects invalid monitor values', (data, path) => {
    expect(new Monitor(data).validateSync()?.errors[path]).toBeDefined()
  })

  it('indexes workspace-scoped non-deleted list ordering', () => {
    expect(Monitor.schema.indexes()).toContainEqual([
      { workspaceId: 1, deletedAt: 1, _id: -1 },
      { background: true },
    ])
  })
})
