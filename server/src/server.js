import { app } from './api.js'
import { env } from './config/env.js'
import { connectMongo, disconnectMongo } from './config/database.js'
import { connectRedis, disconnectRedis } from './config/redis.js'
import { logger } from './config/logger.js'
import { registerShutdown } from './shared/shutdown.js'

await connectMongo()
await connectRedis()

const server = app.listen(env.API_PORT, () => {
  logger.info('PulseWatch API listening', { port: env.API_PORT, environment: env.NODE_ENV })
})

registerShutdown({
  name: 'API',
  close: async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await Promise.all([disconnectMongo(), disconnectRedis()])
  },
})
