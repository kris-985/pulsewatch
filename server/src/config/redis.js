import Redis from 'ioredis'
import { env } from './env.js'
import { logger } from './logger.js'

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    return Math.min(times * 250, 5000)
  },
})

redis.on('error', (error) => logger.warn('Redis connection error', { name: error.name, message: error.message }))

export async function connectRedis() {
  if (redis.status === 'ready') return
  if (redis.status === 'wait') await redis.connect()
  else await redis.ping()
}

export async function disconnectRedis() {
  if (redis.status !== 'end') await redis.quit()
}

export async function isRedisReady() {
  if (redis.status !== 'ready') return false
  try {
    return (await redis.ping()) === 'PONG'
  } catch {
    return false
  }
}
