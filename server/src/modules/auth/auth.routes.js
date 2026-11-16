import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { createAuthRateLimit } from '../../middleware/auth-rate-limit.js'
import { requireCsrf } from '../../middleware/csrf.js'
import { requireAllowedOrigin } from '../../middleware/auth-origin.js'
import { validateBody } from '../../middleware/validate-body.js'
import { asyncHandler } from '../../shared/async-handler.js'
import { loginSchema, registerSchema } from './auth.schemas.js'
import { createAuthController } from './auth.controller.js'

export function createAuthRouter({ service, rateLimit = createAuthRateLimit } = {}) {
  const router = Router()
  const controller = createAuthController(service)
  const limit = (options) => rateLimit(options)

  router.post('/register', requireAllowedOrigin, validateBody(registerSchema), limit({ prefix: 'register', max: 8, windowSeconds: 900, includeEmail: true }), asyncHandler(controller.register))
  router.post('/login', requireAllowedOrigin, validateBody(loginSchema), limit({ prefix: 'login', max: 10, windowSeconds: 900, includeEmail: true }), asyncHandler(controller.login))
  router.post('/refresh', requireCsrf, limit({ prefix: 'refresh', max: 30, windowSeconds: 900 }), asyncHandler(controller.refresh))
  router.post('/logout', requireCsrf, asyncHandler(controller.logout))
  router.get('/me', authenticate, asyncHandler(controller.me))

  return router
}
