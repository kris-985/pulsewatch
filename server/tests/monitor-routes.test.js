import { jest } from '@jest/globals'
import request from 'supertest'
import { createApp } from '../src/api.js'
import { createTokenPair } from '../src/security/tokens/jwt.js'
import { badRequest } from '../src/shared/http-error.js'

describe('Monitor routes', () => {
  const monitor = { id: '507f1f77bcf86cd799439011', name: 'API monitor' }
  const service = {
    create: jest.fn(async () => monitor),
    getById: jest.fn(async () => monitor),
    list: jest.fn(async () => [monitor]),
    update: jest.fn(async () => monitor),
    delete: jest.fn(async () => monitor),
  }
  const workspaceService = {
    getCurrent: jest.fn(async () => ({ id: 'workspace-1', name: 'Test workspace', planCode: 'free' })),
  }
  const app = createApp({ monitorService: service, workspaceService })
  const token = createTokenPair({ userId: 'user-1', familyId: 'session-1' }).accessToken
  const auth = { Authorization: `Bearer ${token}` }
  const id = monitor.id

  beforeEach(() => jest.clearAllMocks())

  it('protects every Monitor endpoint with authentication', async () => {
    const responses = await Promise.all([
      request(app).post('/api/v1/monitors').send({ name: 'API monitor', url: 'https://example.com' }),
      request(app).get('/api/v1/monitors'),
      request(app).get(`/api/v1/monitors/${id}`),
      request(app).patch(`/api/v1/monitors/${id}`).send({ name: 'Updated' }),
      request(app).delete(`/api/v1/monitors/${id}`),
    ])

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401])
    expect(service.create).not.toHaveBeenCalled()
    expect(service.list).not.toHaveBeenCalled()
    expect(service.getById).not.toHaveBeenCalled()
    expect(service.update).not.toHaveBeenCalled()
    expect(service.delete).not.toHaveBeenCalled()
  })

  it('routes POST / to create handler and responds with 201', async () => {
    const response = await request(app)
      .post('/api/v1/monitors')
      .set(auth)
      .send({ name: 'API monitor', url: 'https://example.com' })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ monitor })
    expect(workspaceService.getCurrent).toHaveBeenCalledWith('user-1')
    expect(service.create).toHaveBeenCalledWith('workspace-1', { name: 'API monitor', url: 'https://example.com' })
  })

  it('routes GET / before the monitorId route and passes pagination query values', async () => {
    const response = await request(app)
      .get('/api/v1/monitors?limit=10&cursor=cursor-1')
      .set(auth)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ monitors: [monitor] })
    expect(service.list).toHaveBeenCalledWith('workspace-1', { limit: '10', cursor: 'cursor-1' })
    expect(service.getById).not.toHaveBeenCalled()
  })

  it('routes GET /:monitorId to the read handler', async () => {
    const response = await request(app).get(`/api/v1/monitors/${id}`).set(auth)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ monitor })
    expect(service.getById).toHaveBeenCalledWith('workspace-1', id)
  })

  it('routes PATCH /:monitorId to the update handler', async () => {
    const response = await request(app)
      .patch(`/api/v1/monitors/${id}`)
      .set(auth)
      .send({ name: 'Updated API monitor' })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ monitor })
    expect(service.update).toHaveBeenCalledWith('workspace-1', id, { name: 'Updated API monitor' })
  })

  it('routes DELETE /:monitorId to soft delete and responds with 204', async () => {
    const response = await request(app).delete(`/api/v1/monitors/${id}`).set(auth)

    expect(response.status).toBe(204)
    expect(response.text).toBe('')
    expect(service.delete).toHaveBeenCalledWith('workspace-1', id)
  })

  it('returns the Service validation error for an invalid monitorId', async () => {
    const logSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    service.getById.mockImplementation(async (_workspaceId, monitorId) => {
      if (!/^[\da-f]{24}$/i.test(monitorId)) throw badRequest('Monitor ID is invalid')
      return monitor
    })
    const response = await request(app).get('/api/v1/monitors/not-an-object-id').set(auth)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('BAD_REQUEST')
    expect(service.getById).toHaveBeenCalledWith('workspace-1', 'not-an-object-id')
    logSpy.mockRestore()
  })
})
