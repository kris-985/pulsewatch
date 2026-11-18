import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { createAuthRouter } from './modules/auth/auth.routes.js'
import { createWorkspaceRouter } from './modules/workspaces/workspace.routes.js'
import { createMonitorRouter } from './modules/monitors/monitor.routes.js'
import { errorHandler } from './middleware/error-handler.js'
import { notFoundHandler } from './middleware/not-found.js'
import { requestLogger } from './middleware/request-logger.js'
import { healthRouter } from './modules/health/health.routes.js'

export function createApp({ authService, authRateLimit, workspaceService, monitorService } = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({
    origin(origin, callback) {
      if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true)
      return callback(Object.assign(new Error('Origin is not allowed by CORS policy'), { status: 403 }))
    },
    credentials: true,
  }))
  app.use(requestLogger)
  app.use(express.json({ limit: '100kb' }))
  app.use('/api/v1', healthRouter)
  app.use('/api/v1/auth', createAuthRouter({ service: authService, rateLimit: authRateLimit }))
  app.use('/api/v1/workspaces', createWorkspaceRouter({ service: workspaceService }))
  app.use('/api/v1/monitors', createMonitorRouter({ service: monitorService, workspaces: workspaceService }))
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export const app = createApp()
