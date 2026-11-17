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

  it('fails closed with 503 when a Redis rate-limit command times out', async () => {
    jest.useFakeTimers()
    const redisClient = {
      status: 'ready',
      eval: jest.fn(() => new Promise(() => {})),
    }
    const middleware = createAuthRateLimit({
      prefix: 'test',
      max: 1,
      windowSeconds: 60,
      redisClient,
      timeoutMs: 1_000,
      now: () => 1_000,
    })
    const next = jest.fn()

    try {
      const pending = middleware({ ip: '127.0.0.1', requestId: 'request-1' }, {}, next)
      await jest.advanceTimersByTimeAsync(1_000)
      await pending
    } finally {
      jest.useRealTimers()
    }

    expect(redisClient.eval).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 503, code: 'SERVICE_UNAVAILABLE' }))
  })

  it('sets a cooldown after a Redis failure', async () => {
    const redisClient = { status: 'ready', eval: jest.fn().mockRejectedValue(new Error('Redis unavailable')) }
    const middleware = createAuthRateLimit({ prefix: 'failure', max: 2, windowSeconds: 60, redisClient, now: () => 10_000 })
    const next = jest.fn()

    await middleware({ ip: '127.0.0.1' }, {}, next)

    expect(redisClient.eval).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 503, code: 'SERVICE_UNAVAILABLE' }))
  })

  it('does not retry Redis or extend cooldown on subsequent requests', async () => {
    let currentTime = 20_000
    const redisClient = {
      status: 'ready',
      eval: jest.fn()
        .mockRejectedValueOnce(new Error('Redis unavailable'))
        .mockResolvedValueOnce([1, 0]),
    }
    const middleware = createAuthRateLimit({ prefix: 'no-extension', max: 2, windowSeconds: 60, redisClient, now: () => currentTime })
    const firstNext = jest.fn()
    const secondNext = jest.fn()

    await middleware({ ip: '127.0.0.1' }, {}, firstNext)
    currentTime += 500
    await middleware({ ip: '127.0.0.1' }, {}, secondNext)

    expect(redisClient.eval).toHaveBeenCalledTimes(1)
    expect(secondNext).toHaveBeenCalledWith(expect.objectContaining({ status: 503, code: 'SERVICE_UNAVAILABLE' }))

    // At the original deadline, a Redis success proves the intervening request
    // did not push the cooldown forward.
    currentTime += 500
    const recoveredNext = jest.fn()
    await middleware({ ip: '127.0.0.1' }, {}, recoveredNext)
    expect(redisClient.eval).toHaveBeenCalledTimes(2)
    expect(recoveredNext).toHaveBeenCalledWith()
  })

  it('retries Redis after cooldown expiration and resumes normal limit decisions', async () => {
    let currentTime = 30_000
    const redisClient = {
      status: 'ready',
      eval: jest.fn()
        .mockRejectedValueOnce(new Error('Redis unavailable'))
        .mockResolvedValueOnce([1, 1])
        .mockResolvedValueOnce([2, 2]),
    }
    const middleware = createAuthRateLimit({ prefix: 'recovery', max: 1, windowSeconds: 60, redisClient, now: () => currentTime })
    const failedNext = jest.fn()
    await middleware({ ip: '127.0.0.1' }, {}, failedNext)

    currentTime += 1_000
    const recoveredNext = jest.fn()
    await middleware({ ip: '127.0.0.1' }, {}, recoveredNext)
    expect(recoveredNext).toHaveBeenCalledWith()

    const limitedRes = { set: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() }
    const limitedNext = jest.fn()
    await middleware({ ip: '127.0.0.1' }, limitedRes, limitedNext)
    expect(limitedRes.status).toHaveBeenCalledWith(429)
    expect(limitedNext).not.toHaveBeenCalled()
    expect(redisClient.eval).toHaveBeenCalledTimes(3)
  })
})
