import { Router } from 'express'
import { isMongoReady } from '../../config/database.js'
import { isRedisReady } from '../../config/redis.js'

export const healthRouter = Router()

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' })
})

healthRouter.get('/ready', async (_req, res) => {
  const [mongoReady, redisReady] = await Promise.all([isMongoReady(), isRedisReady()])
  const ready = mongoReady && redisReady

  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    dependencies: { mongodb: mongoReady ? 'up' : 'down', redis: redisReady ? 'up' : 'down' },
  })
})
