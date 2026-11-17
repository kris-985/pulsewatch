import { jest } from '@jest/globals'
import request from 'supertest'
import { createApp } from '../src/api.js'
import { createTokenPair } from '../src/security/tokens/jwt.js'

const passRateLimit = () => (_req, _res, next) => next()

function authResult() {
  return {
    accessToken: 'access-token-from-service',
    accessTokenTtlSeconds: 900,
    refreshToken: 'signed-refresh-cookie-value',
    refreshExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
    user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
    workspace: { id: 'workspace-1', name: "Ada Lovelace's workspace", planCode: 'free' },
  }
}

describe('authentication HTTP routes', () => {
  const service = {
    register: jest.fn(async () => authResult()),
    login: jest.fn(async () => authResult()),
    refresh: jest.fn(async () => authResult()),
    logout: jest.fn(async () => undefined),
    getMe: jest.fn(async () => ({ user: authResult().user, workspace: authResult().workspace })),
  }
  const workspaceService = {
    getCurrent: jest.fn(async () => authResult().workspace),
  }
  const app = createApp({ authService: service, authRateLimit: passRateLimit, workspaceService })
  const origin = 'http://localhost:5173'

  beforeEach(() => jest.clearAllMocks())

  it('registers an account, creates its workspace response, and keeps refresh token in HttpOnly cookie', async () => {
    const logSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct horse battery' })

    expect(response.status).toBe(201)
    expect(service.register).toHaveBeenCalledWith({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct horse battery' })
    expect(response.body.workspace.planCode).toBe('free')
    expect(response.body).not.toHaveProperty('refreshToken')
    expect(response.body.user).not.toHaveProperty('passwordHash')
    const cookies = response.headers['set-cookie']
    const refreshCookie = cookies.find((cookie) => cookie.startsWith('pw_refresh='))
    expect(refreshCookie).toContain('Path=/api/v1/auth')
    expect(refreshCookie).toContain('HttpOnly')
    expect(refreshCookie).toContain('SameSite=Strict')
    expect(cookies.some((cookie) => cookie.startsWith('pw_csrf=') && cookie.includes('Path=/'))).toBe(true)
    expect(logSpy.mock.calls.flat().join(' ')).not.toContain('correct horse battery')
    logSpy.mockRestore()
  })

  it('logs in and rotates the browser session cookie', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'ada@example.com', password: 'correct horse battery' })

    expect(response.status).toBe(200)
    expect(service.login).toHaveBeenCalledWith({ email: 'ada@example.com', password: 'correct horse battery' })
    expect(response.headers['set-cookie'].some((cookie) => cookie.startsWith('pw_refresh='))).toBe(true)
  })

  it('rejects weak registration input before calling the service', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ name: 'A', email: 'invalid', password: 'short' })

    expect(response.status).toBe(400)
    expect(service.register).not.toHaveBeenCalled()
  })

  it('rejects passwords that exceed bcrypt’s UTF-8 byte limit', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'é'.repeat(37) })

    expect(response.status).toBe(400)
    expect(service.register).not.toHaveBeenCalled()
  })

  it('requires a matching CSRF cookie/header pair and allowed origin for refresh', async () => {
    const denied = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', 'pw_csrf=csrf-value; pw_refresh=refresh-value')
      .send({})
    expect(denied.status).toBe(403)
    expect(service.refresh).not.toHaveBeenCalled()

    const accepted = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', 'pw_csrf=csrf-value; pw_refresh=refresh-value')
      .set('X-CSRF-Token', 'csrf-value')
      .send({})
    expect(accepted.status).toBe(200)
    expect(service.refresh).toHaveBeenCalledWith('refresh-value')
    expect(accepted.body.accessToken).toBe('access-token-from-service')
  })

  it('protects the current user/workspace endpoint with an access JWT', async () => {
    const denied = await request(app).get('/api/v1/auth/me')
    expect(denied.status).toBe(401)

    const pair = createTokenPair({ userId: 'user-1', familyId: 'session-1' })
    const accepted = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${pair.accessToken}`)

    expect(accepted.status).toBe(200)
    expect(accepted.body.user.email).toBe('ada@example.com')
    expect(accepted.body.workspace.planCode).toBe('free')
    expect(service.getMe).toHaveBeenCalledWith('user-1')
  })

  it('protects the current workspace endpoint with the same access JWT', async () => {
    const pair = createTokenPair({ userId: 'user-1', familyId: 'session-1' })
    const response = await request(app)
      .get('/api/v1/workspaces/current')
      .set('Authorization', `Bearer ${pair.accessToken}`)

    expect(response.status).toBe(200)
    expect(response.body.workspace.id).toBe('workspace-1')
    expect(workspaceService.getCurrent).toHaveBeenCalledWith('user-1')
  })

  it('revokes the refresh family and clears session cookies on logout', async () => {
    const denied = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Cookie', 'pw_csrf=csrf-value; pw_refresh=refresh-value')
      .send({})
    expect(denied.status).toBe(403)
    expect(service.logout).not.toHaveBeenCalled()

    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('Cookie', 'pw_csrf=csrf-value; pw_refresh=refresh-value')
      .set('X-CSRF-Token', 'csrf-value')
      .send({})

    expect(response.status).toBe(204)
    expect(service.logout).toHaveBeenCalledWith('refresh-value')
    expect(response.headers['set-cookie'].join(';')).toContain('pw_refresh=;')
  })

  it('configures the same atomic IP bucket for every auth mutation and endpoint-specific identity policies', async () => {
    const policies = []
    const appWithPolicies = createApp({
      authService: service,
      authRateLimit: (policy) => { policies.push(policy); return passRateLimit() },
      workspaceService,
    })
    // Force router construction and inspect the actual policies wired to routes.
    await request(appWithPolicies).post('/api/v1/auth/logout').set('Origin', origin).send({})

    expect(policies.map(({ prefix }) => prefix)).toEqual(['register', 'login', 'refresh', 'logout'])
    expect(policies.every(({ ipNamespace, ipMax, windowSeconds }) => ipNamespace === 'auth' && ipMax === 60 && windowSeconds === 900)).toBe(true)
    expect(policies.find(({ prefix }) => prefix === 'register')).toMatchObject({ max: 8, includeEmail: true })
    expect(policies.find(({ prefix }) => prefix === 'login')).toMatchObject({ max: 10, includeEmail: true })
    expect(policies.find(({ prefix }) => prefix === 'refresh')).toMatchObject({ max: 60 })
    expect(policies.find(({ prefix }) => prefix === 'refresh')).not.toHaveProperty('includeEmail', true)
    expect(policies.find(({ prefix }) => prefix === 'logout')).toMatchObject({ max: 60 })
    expect(policies.find(({ prefix }) => prefix === 'logout')).not.toHaveProperty('includeEmail', true)
  })
})
