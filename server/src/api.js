import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { errorHandler } from './middleware/error-handler.js'
import { notFoundHandler } from './middleware/not-found.js'
import { requestLogger } from './middleware/request-logger.js'
import { healthRouter } from './modules/health/health.routes.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true)
      return callback(Object.assign(new Error('Origin is not allowed by CORS policy'), { status: 403 }))
    },
  }))
  app.use(requestLogger)
  app.use(express.json({ limit: '100kb' }))
  app.use('/api/v1', healthRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export const app = createApp()
