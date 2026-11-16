import { env } from '../config/env.js'
import { forbidden } from '../shared/http-error.js'

export function requireAllowedOrigin(req, _res, next) {
  const origin = req.get('origin')
  if (!origin || !env.CORS_ORIGINS.includes(origin)) return next(forbidden('Request origin is not allowed'))
  return next()
}
