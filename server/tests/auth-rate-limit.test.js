import { jest } from '@jest/globals'
import { createAuthRateLimit } from '../src/middleware/auth-rate-limit.js'

function createMemoryRedis() {
  const counts = new Map()
  const expirations = new Map()
  return {
    status: 'ready',
    counts,
    expirations,
    eval: jest.fn(async (_script, keyCount, ...args) => {
      const keys = args.slice(0, keyCount)
      const ttl = Number(args[keyCount])
      const nextCounts = keys.map((key) => {
        const count = (counts.get(key) ?? 0) + 1
        counts.set(key, count)
        if (count === 1) expirations.set(key, ttl)
        return count
      })
      return [nextCounts[0], nextCounts[1] ?? 0]
    }),
  }
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(name, value) { this.headers[name] = value; return this },
    status(value) { this.statusCode = value; return this },
    json(value) { this.body = value; return this },
  }
}

async function send(middleware, { ip, email }, res = createResponse()) {
  const next = jest.fn()
  await middleware({ ip, validatedBody: { email }, requestId: 'test-request' }, res, next)
  return { res, next }
}

describe('authentication rate limit counters', () => {
  it('limits a shared IP across distinct email addresses', async () => {
    const redisClient = createMemoryRedis()
    const middleware = createAuthRateLimit({
      prefix: 'login-ip', max: 10, ipMax: 1, windowSeconds: 900,
      includeEmail: true, redisClient, now: () => 1_000,
    })

    const first = await send(middleware, { ip: '192.0.2.1', email: 'one@example.com' })
    const second = await send(middleware, { ip: '192.0.2.1', email: 'two@example.com' })

    expect(first.next).toHaveBeenCalledWith()
    expect(second.res.statusCode).toBe(429)
    expect(redisClient.eval).toHaveBeenCalledTimes(2)
    expect(redisClient.eval.mock.calls[0][1]).toBe(2)
    expect(redisClient.eval.mock.calls[0][2]).toBe(redisClient.eval.mock.calls[1][2])
  })

  it('shares the IP counter between login and registration middleware', async () => {
    const redisClient = createMemoryRedis()
    const loginLimit = createAuthRateLimit({
      prefix: 'login', max: 10, ipMax: 1, windowSeconds: 900,
      includeEmail: true, redisClient, now: () => 1_000,
    })
    const registrationLimit = createAuthRateLimit({
      prefix: 'register', max: 8, ipMax: 1, windowSeconds: 900,
      includeEmail: true, redisClient, now: () => 1_000,
    })

    expect((await send(loginLimit, { ip: '192.0.2.10', email: 'one@example.com' })).next).toHaveBeenCalledWith()
    expect((await send(registrationLimit, { ip: '192.0.2.10', email: 'new@example.com' })).res.statusCode).toBe(429)
  })

  it('limits one email per IP without coupling that email across different IPs', async () => {
    const redisClient = createMemoryRedis()
    const middleware = createAuthRateLimit({
      prefix: 'login-identity', max: 1, ipMax: 10, windowSeconds: 900,
      includeEmail: true, redisClient, now: () => 1_000,
    })

    const firstIp = await send(middleware, { ip: '192.0.2.1', email: 'same@example.com' })
    const secondIp = await send(middleware, { ip: '192.0.2.2', email: 'same@example.com' })
    const repeated = await send(middleware, { ip: '192.0.2.1', email: 'same@example.com' })

    expect(firstIp.next).toHaveBeenCalledWith()
    expect(secondIp.next).toHaveBeenCalledWith()
    expect(repeated.res.statusCode).toBe(429)
  })

  it('atomically enforces the shared IP limit under concurrent requests', async () => {
    const redisClient = createMemoryRedis()
    const middleware = createAuthRateLimit({
      prefix: 'concurrent-ip', max: 10, ipMax: 1, windowSeconds: 900,
      includeEmail: true, redisClient, now: () => 1_000,
    })

    const results = await Promise.all([
      send(middleware, { ip: '192.0.2.3', email: 'one@example.com' }),
      send(middleware, { ip: '192.0.2.3', email: 'two@example.com' }),
    ])

    expect(results.filter(({ next }) => next.mock.calls.length === 1 && next.mock.calls[0].length === 0)).toHaveLength(1)
    expect(results.filter(({ res }) => res.statusCode === 429)).toHaveLength(1)
  })

  it('resets both counters when the fixed window rolls over', async () => {
    let currentTime = 1_000
    const redisClient = createMemoryRedis()
    const middleware = createAuthRateLimit({
      prefix: 'window-reset', max: 10, ipMax: 1, windowSeconds: 60,
      includeEmail: true, redisClient, now: () => currentTime,
    })

    expect((await send(middleware, { ip: '192.0.2.4', email: 'one@example.com' })).next).toHaveBeenCalledWith()
    expect((await send(middleware, { ip: '192.0.2.4', email: 'two@example.com' })).res.statusCode).toBe(429)
    currentTime = 60_000
    expect((await send(middleware, { ip: '192.0.2.4', email: 'two@example.com' })).next).toHaveBeenCalledWith()
    expect([...redisClient.expirations.values()].every((ttl) => ttl === 60)).toBe(true)
  })

  it('does not extend a Redis outage cooldown when concurrent requests fail later', async () => {
    let currentTime = 10_000
    const failures = []
    const redisClient = {
      status: 'ready',
      eval: jest.fn()
        .mockImplementationOnce(() => new Promise((_resolve, reject) => failures.push(reject)))
        .mockImplementationOnce(() => new Promise((_resolve, reject) => failures.push(reject)))
        .mockResolvedValueOnce([1, 1]),
    }
    const middleware = createAuthRateLimit({
      prefix: 'concurrent-failure', max: 3, ipMax: 3, windowSeconds: 60,
      includeEmail: true, redisClient, now: () => currentTime,
    })

    const first = send(middleware, { ip: '192.0.2.5', email: 'one@example.com' })
    const second = send(middleware, { ip: '192.0.2.5', email: 'two@example.com' })
    expect(redisClient.eval).toHaveBeenCalledTimes(2)

    failures[0](new Error('Redis unavailable'))
    await first
    currentTime += 500
    failures[1](new Error('Redis unavailable'))
    await second

    currentTime += 500
    const recovered = await send(middleware, { ip: '192.0.2.5', email: 'one@example.com' })
    expect(recovered.next).toHaveBeenCalledWith()
    expect(redisClient.eval).toHaveBeenCalledTimes(3)
  })
})
