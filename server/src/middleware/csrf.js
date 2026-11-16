import { timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { CSRF_COOKIE, parseCookies } from '../security/tokens/cookies.js'
import { forbidden } from '../shared/http-error.js'

export function requireCsrf(req, _res, next) {
  const origin = req.get('origin')
  const cookieToken = parseCookies(req.get('cookie'))[CSRF_COOKIE]
  const headerToken = req.get('x-csrf-token')

  if (!origin || !env.CORS_ORIGINS.includes(origin) || !cookieToken || !headerToken) {
    return next(forbidden())
  }

  const cookieBuffer = Buffer.from(cookieToken)
  const headerBuffer = Buffer.from(headerToken)
  if (cookieBuffer.length !== headerBuffer.length || !timingSafeEqual(cookieBuffer, headerBuffer)) {
    return next(forbidden())
  }

  return next()
}
