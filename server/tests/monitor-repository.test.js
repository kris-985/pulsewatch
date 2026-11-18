import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { Monitor } from '../src/modules/monitors/monitor.model.js'
import {
  createMonitor,
  findMonitorById,
  findMonitorsByWorkspace,
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
})
