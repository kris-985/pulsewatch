import request from 'supertest'
import { createApp } from '../src/api.js'

describe('health endpoints', () => {
  const app = createApp()

  it('reports liveness without requiring connected dependencies', async () => {
    const response = await request(app).get('/api/v1/health')
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
  })

  it('returns service unavailable when readiness dependencies are disconnected', async () => {
    const response = await request(app).get('/api/v1/ready')
    expect(response.status).toBe(503)
    expect(response.body.status).toBe('not_ready')
    expect(response.body.dependencies).toEqual({ mongodb: 'down', redis: 'down' })
  })

  it('uses the not found handler for unknown routes', async () => {
    const response = await request(app).get('/api/v1/does-not-exist')
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
  })
})
