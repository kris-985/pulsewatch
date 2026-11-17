import { createHash } from 'node:crypto'
import { redis } from '../config/redis.js'
import { serviceUnavailable } from '../shared/http-error.js'

const INCREMENT_WITH_TTL = `
  local function increment(key)
    local count = redis.call('INCR', key)
    if count == 1 then redis.call('EXPIRE', key, ARGV[1]) end
    return count
  end

  local ipCount = increment(KEYS[1])
  local identityCount = 0
  if #KEYS > 1 then identityCount = increment(KEYS[2]) end
  return { ipCount, identityCount }
`
const FAILURE_COOLDOWN_MS = 1_000
const cooldownByRedisClient = new WeakMap()

export function createAuthRateLimit({ prefix, ipNamespace = prefix, max, ipMax = max, windowSeconds, includeEmail = false, redisClient = redis, timeoutMs = 1_000, now = Date.now }) {
  return async (req, res, next) => {
    const ipHash = createHash('sha256').update(req.ip || 'unknown').digest('hex').slice(0, 24)
    const email = includeEmail ? String(req.validatedBody?.email ?? '').toLowerCase() : ''
    const bucket = Math.floor(now() / (windowSeconds * 1_000))
    const keys = [`pulsewatch:auth-limit:${ipNamespace}:ip:${ipHash}:${bucket}`]
    if (includeEmail) {
      const emailHash = createHash('sha256').update(email).digest('hex').slice(0, 24)
      keys.push(`pulsewatch:auth-limit:${prefix}:identity:${ipHash}:${emailHash}:${bucket}`)
    }

    const cooldownUntil = cooldownByRedisClient.get(redisClient) ?? 0
    if (now() < cooldownUntil) {
      return next(serviceUnavailable('Authentication rate limiting is temporarily unavailable'))
    }

    try {
      if (redisClient.status !== 'ready') {
        throw new Error('Redis is not ready')
      }

      let timeout
      const countPromise = redisClient.eval(INCREMENT_WITH_TTL, keys.length, ...keys, windowSeconds)
      const counts = await Promise.race([
        countPromise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Redis rate-limit command timed out')), timeoutMs)
        }),
      ]).finally(() => clearTimeout(timeout))
      if (now() >= (cooldownByRedisClient.get(redisClient) ?? 0)) {
        cooldownByRedisClient.delete(redisClient)
      }
      if (!Array.isArray(counts)) throw new Error('Redis returned an invalid rate-limit result')
      const ipCount = Number(counts[0])
      const identityCount = Number(counts[1] ?? 0)
      if (!Number.isSafeInteger(ipCount) || ipCount < 1) throw new Error('Redis returned an invalid IP rate-limit count')
      if (includeEmail && (!Number.isSafeInteger(identityCount) || identityCount < 1)) {
        throw new Error('Redis returned an invalid identity rate-limit count')
      }
      if (ipCount > ipMax || (includeEmail && identityCount > max)) {
        res.set('Retry-After', String(windowSeconds))
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts', requestId: req.requestId } })
      }
      return next()
    } catch {
      // A request that was already in flight when another request opened the
      // cooldown must not extend it when its own Redis operation later fails.
      if (now() >= (cooldownByRedisClient.get(redisClient) ?? 0)) {
        cooldownByRedisClient.set(redisClient, now() + FAILURE_COOLDOWN_MS)
      }
      return next(serviceUnavailable('Authentication rate limiting is temporarily unavailable'))
    }
  }
}
