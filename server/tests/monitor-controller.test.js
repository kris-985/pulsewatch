import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { createMonitorController } from '../src/modules/monitors/monitor.controller.js'

function responseMock() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  }
}

describe('Monitor controller', () => {
  let service
  let workspaces
  let controller
  let req
  let res
  let next

  beforeEach(() => {
    service = {
      create: jest.fn(),
      getById: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    }
    workspaces = { getCurrent: jest.fn(async () => ({ id: 'workspace-from-auth' })) }
    controller = createMonitorController({ service, workspaces })
    req = {
      auth: { userId: 'authenticated-user' },
      params: { monitorId: '507f1f77bcf86cd799439011' },
      body: { name: 'API monitor' },
      query: { limit: '10', cursor: 'cursor-value' },
    }
    res = responseMock()
    next = jest.fn()
  })

  afterEach(() => jest.clearAllMocks())

  it('creates a Monitor with HTTP 201 and wraps the response', async () => {
    const monitor = { id: 'monitor-1' }
    service.create.mockResolvedValue(monitor)

    await controller.create(req, res, next)

    expect(workspaces.getCurrent).toHaveBeenCalledWith('authenticated-user')
    expect(service.create).toHaveBeenCalledWith('workspace-from-auth', req.body)
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ monitor })
    expect(next).not.toHaveBeenCalled()
  })

  it('prefers middleware-validated create data', async () => {
    req.validatedBody = { name: 'Validated monitor' }
    service.create.mockResolvedValue({ id: 'monitor-2' })

    await controller.create(req, res, next)

    expect(service.create).toHaveBeenCalledWith('workspace-from-auth', req.validatedBody)
  })

  it('retrieves a Monitor by route ID with HTTP 200', async () => {
    const monitor = { id: 'monitor-1' }
    service.getById.mockResolvedValue(monitor)

    await controller.getById(req, res, next)

    expect(service.getById).toHaveBeenCalledWith('workspace-from-auth', req.params.monitorId)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ monitor })
  })

  it('lists Monitors with pagination parameters and HTTP 200', async () => {
    const monitors = [{ id: 'monitor-1' }]
    service.list.mockResolvedValue(monitors)
    req.validatedQuery = { limit: 10, cursor: 'cursor-value' }

    await controller.list(req, res, next)

    expect(service.list).toHaveBeenCalledWith('workspace-from-auth', req.validatedQuery)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ monitors })
  })

  it('updates a Monitor with HTTP 200 and forwards only ID and body', async () => {
    const monitor = { id: 'monitor-1', name: 'Renamed monitor' }
    service.update.mockResolvedValue(monitor)

    await controller.update(req, res, next)

    expect(service.update).toHaveBeenCalledWith('workspace-from-auth', req.params.monitorId, req.body)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ monitor })
  })

  it('soft deletes a Monitor and returns HTTP 204', async () => {
    service.delete.mockResolvedValue({ id: 'monitor-1', deletedAt: new Date() })

    await controller.delete(req, res, next)

    expect(service.delete).toHaveBeenCalledWith('workspace-from-auth', req.params.monitorId)
    expect(res.status).toHaveBeenCalledWith(204)
    expect(res.end).toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  it('does not accept Workspace identifiers from body, params, or query', async () => {
    req.body.workspaceId = 'attacker-workspace'
    req.params.workspaceId = 'attacker-workspace'
    req.query.workspaceId = 'attacker-workspace'
    service.create.mockResolvedValue({ id: 'monitor-1' })

    await controller.create(req, res, next)

    expect(service.create).toHaveBeenCalledWith('workspace-from-auth', req.body)
    expect(workspaces.getCurrent).toHaveBeenCalledWith('authenticated-user')
  })

  it('forwards asynchronous service failures to Express error handling', async () => {
    const failure = new Error('Service failed')
    service.getById.mockRejectedValue(failure)

    await controller.getById(req, res, next)

    expect(next).toHaveBeenCalledWith(failure)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  it('forwards Workspace resolution failures to Express error handling', async () => {
    const failure = new Error('Workspace unavailable')
    workspaces.getCurrent.mockRejectedValue(failure)

    await controller.list(req, res, next)

    expect(next).toHaveBeenCalledWith(failure)
    expect(service.list).not.toHaveBeenCalled()
  })
})
