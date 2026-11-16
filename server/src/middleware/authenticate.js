import { verifyAccessToken } from '../security/tokens/jwt.js'
import { unauthorized } from '../shared/http-error.js'

export function authenticate(req, _res, next) {
  const authorization = req.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(authorization)
  const claims = match ? verifyAccessToken(match[1]) : null

  if (!claims) return next(unauthorized())
  req.auth = { userId: claims.sub, sessionFamilyId: claims.sid }
  return next()
}
