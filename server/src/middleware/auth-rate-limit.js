import { createHash } from 'node:crypto'
import { redis } from '../config/redis.js'
import { serviceUnavailable } from '../shared/http-error.js'

const INCREMENT_WITH_TTL = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`
const FAILURE_COOLDOWN_MS = 1_000
let redisUnavailableUntil = 0

export function createAuthRateLimit({ prefix, max, windowSeconds, includeEmail = false, redisClient = redis, timeoutMs = 1_000 }) {
  return async (req, res, next) => {
    const ipHash = createHash('sha256').update(req.ip || 'unknown').digest('hex').slice(0, 24)
    const email = includeEmail ? String(req.validatedBody?.email ?? '').toLowerCase() : ''
    const emailHash = email ? createHash('sha256').update(email).digest('hex').slice(0, 24) : 'none'
    const bucket = Math.floor(Date.now() / (windowSeconds * 1_000))
    const key = `pulsewatch:auth-limit:${prefix}:${ipHash}:${emailHash}:${bucket}`

    try {
      if (Date.now() < redisUnavailableUntil || redisClient.status !== 'ready') {
        throw new Error('Redis is not ready')
      }

      let timeout
      const countPromise = redisClient.eval(INCREMENT_WITH_TTL, 1, key, windowSeconds)
      const count = Number(await Promise.race([
        countPromise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Redis rate-limit command timed out')), timeoutMs)
        }),
      ]).finally(() => clearTimeout(timeout)))
      redisUnavailableUntil = 0
      if (count > max) {
        res.set('Retry-After', String(windowSeconds))
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts', requestId: req.requestId } })
      }
      return next()
    } catch {
      redisUnavailableUntil = Date.now() + FAILURE_COOLDOWN_MS
      return next(serviceUnavailable('Authentication rate limiting is temporarily unavailable'))
    }
  }
}
