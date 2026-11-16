import { connectMongo, disconnectMongo } from './config/database.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { connectRedis, disconnectRedis } from './config/redis.js'
import { registerShutdown } from './shared/shutdown.js'

await connectMongo()
await connectRedis()
logger.info('PulseWatch scheduler foundation ready', { environment: env.NODE_ENV, note: 'Scheduling is not enabled at this stage' })

registerShutdown({
  name: 'Scheduler',
  close: async () => Promise.all([disconnectMongo(), disconnectRedis()]),
})
