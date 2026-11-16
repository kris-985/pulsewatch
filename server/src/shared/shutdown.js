import { logger } from '../config/logger.js'

export function registerShutdown({ name, close }) {
  let shuttingDown = false

  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`${name} shutting down`, { signal })
    const forceExit = setTimeout(() => process.exit(1), 10_000)
    forceExit.unref()
    try {
      await close()
      clearTimeout(forceExit)
      process.exit(0)
    } catch (error) {
      logger.error(`${name} shutdown failed`, { message: error.message })
      process.exit(1)
    }
  }

  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}
