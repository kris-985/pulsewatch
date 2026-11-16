import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import { env } from '../src/config/env.js'
import { createAuthRateLimit } from '../src/middleware/auth-rate-limit.js'
import { getCsrfCookieOptions, getRefreshCookieOptions } from '../src/modules/auth/auth.controller.js'
import { verifyAccessToken, verifyRefreshToken } from '../src/security/tokens/jwt.js'

describe('authentication hardening', () => {
  it('rejects expired access and refresh JWTs', () => {
    const common = {
      algorithm: 'HS256',
      subject: 'user-1',
      issuer: 'pulsewatch',
      audience: 'pulsewatch-client',
      expiresIn: -1,
    }
    const accessToken = jwt.sign({ typ: 'access', sid: 'family-1' }, env.JWT_ACCESS_SECRET, common)
    const refreshToken = jwt.sign({ typ: 'refresh', sid: 'family-1' }, env.JWT_REFRESH_SECRET, common)

    expect(verifyAccessToken(accessToken)).toBeNull()
    expect(verifyRefreshToken(refreshToken)).toBeNull()
  })

  it('uses HttpOnly refresh cookies and enables Secure only in production', () => {
    expect(getRefreshCookieOptions('development')).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/api/v1/auth',
    })
    expect(getRefreshCookieOptions('production')).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
    })
    expect(getCsrfCookieOptions('production')).toMatchObject({
      httpOnly: false,
      secure: true,
      sameSite: 'strict',
      path: '/',
    })
  })

  it('fails closed with 503 when a Redis rate-limit command does not reply', async () => {
    const redisClient = {
      status: 'ready',
      eval: jest.fn(() => new Promise(() => {})),
    }
    const middleware = createAuthRateLimit({
      prefix: 'test',
      max: 1,
      windowSeconds: 60,
      redisClient,
      timeoutMs: 10,
    })
    const next = jest.fn()

    await middleware({ ip: '127.0.0.1', requestId: 'request-1' }, {}, next)

    expect(redisClient.eval).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 503, code: 'SERVICE_UNAVAILABLE' }))
  })
})
