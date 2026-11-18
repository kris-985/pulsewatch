import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { MonitorService } from '../src/modules/monitors/monitor.service.js'
import { HttpError } from '../src/shared/http-error.js'

const MONITOR_ID = '507f1f77bcf86cd799439011'
const normalizedUrl = 'https://status.example.com/health'

function createRepository() {
  return {
    createMonitor: jest.fn(),
    findMonitorById: jest.fn(),
    findMonitorsByWorkspace: jest.fn(),
    updateMonitor: jest.fn(),
    softDeleteMonitor: jest.fn(),
  }
}

describe('MonitorService', () => {
  let repository
  let urlPolicy
  let service

  beforeEach(() => {
    repository = createRepository()
    urlPolicy = jest.fn(async () => normalizedUrl)
    service = new MonitorService({ repository, urlPolicy })
  })

  it('validates, applies URL policy, and creates within the contextual Workspace', async () => {
    const created = { _id: MONITOR_ID }
    repository.createMonitor.mockResolvedValue(created)
    const input = { name: ' Public API ', url: 'https://status.example.com/health' }

    await expect(service.create('workspace-context', input)).resolves.toBe(created)
    expect(urlPolicy).toHaveBeenCalledWith(input.url)
    expect(repository.createMonitor).toHaveBeenCalledWith('workspace-context', {
      name: 'Public API',
      url: normalizedUrl,
      intervalSeconds: 60,
    })
    expect(repository.createMonitor.mock.calls[0][1]).not.toHaveProperty('workspaceId')
  })

  it('rejects invalid create input before accessing the repository', async () => {
    await expect(service.create('workspace-context', { name: 'x', url: 'https://example.com' }))
      .rejects.toMatchObject({ status: 400, code: 'BAD_REQUEST' })
    expect(repository.createMonitor).not.toHaveBeenCalled()
  })

  it('rejects a URL denied by the SSRF policy', async () => {
    urlPolicy.mockRejectedValue(Object.assign(new Error('Blocked host'), { code: 'MONITOR_URL_NOT_ALLOWED' }))

    await expect(service.create('workspace-context', {
      name: 'Private API',
      url: 'http://127.0.0.1',
    })).rejects.toMatchObject({ status: 400, code: 'MONITOR_URL_NOT_ALLOWED' })
    expect(repository.createMonitor).not.toHaveBeenCalled()
  })

  it('retrieves a Monitor only through the supplied Workspace', async () => {
    const monitor = { _id: MONITOR_ID }
    repository.findMonitorById.mockResolvedValue(monitor)

    await expect(service.getById('workspace-a', MONITOR_ID)).resolves.toBe(monitor)
    expect(repository.findMonitorById).toHaveBeenCalledWith('workspace-a', MONITOR_ID)
  })

  it('returns the same not-found error for foreign and absent Monitors', async () => {
    repository.findMonitorById.mockResolvedValue(null)

    await expect(service.getById('workspace-b', MONITOR_ID)).rejects.toMatchObject({
      status: 404,
      code: 'MONITOR_NOT_FOUND',
    })
    expect(repository.findMonitorById).toHaveBeenCalledWith('workspace-b', MONITOR_ID)
  })

  it('lists only the contextual Workspace using validated pagination', async () => {
    repository.findMonitorsByWorkspace.mockResolvedValue([])

    await expect(service.list('workspace-context', { limit: '10', cursor: null })).resolves.toEqual([])
    expect(repository.findMonitorsByWorkspace).toHaveBeenCalledWith('workspace-context', { limit: 10, cursor: null })
  })

  it('validates and updates only permitted fields after URL policy approval', async () => {
    const updated = { _id: MONITOR_ID, name: 'Updated API' }
    repository.updateMonitor.mockResolvedValue(updated)

    await expect(service.update('workspace-context', MONITOR_ID, {
      name: 'Updated API',
      url: 'https://status.example.com/health',
    })).resolves.toBe(updated)
    expect(repository.updateMonitor).toHaveBeenCalledWith('workspace-context', MONITOR_ID, {
      name: 'Updated API',
      url: normalizedUrl,
    })
  })

  it.each([
    { workspaceId: 'attacker-workspace' },
    { currentStatus: 'down' },
    { deletedAt: new Date() },
    { schedulerClaimUntil: new Date() },
  ])('rejects attempts to modify system fields: %j', async (input) => {
    await expect(service.update('workspace-context', MONITOR_ID, input))
      .rejects.toMatchObject({ status: 400, code: 'BAD_REQUEST' })
    expect(repository.updateMonitor).not.toHaveBeenCalled()
  })

  it('rejects invalid IDs and does not access the repository', async () => {
    await expect(service.getById('workspace-context', 'not-an-id'))
      .rejects.toMatchObject({ status: 400, code: 'BAD_REQUEST' })
    expect(repository.findMonitorById).not.toHaveBeenCalled()
  })

  it('soft deletes within the contextual Workspace and reports unavailable records', async () => {
    const deleted = { _id: MONITOR_ID, deletedAt: new Date() }
    repository.softDeleteMonitor.mockResolvedValueOnce(deleted).mockResolvedValueOnce(null)

    await expect(service.delete('workspace-context', MONITOR_ID)).resolves.toBe(deleted)
    expect(repository.softDeleteMonitor).toHaveBeenCalledWith('workspace-context', MONITOR_ID)
    await expect(service.delete('workspace-context', MONITOR_ID)).rejects.toBeInstanceOf(HttpError)
  })
})
