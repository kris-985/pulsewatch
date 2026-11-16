import { createHash, randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'

const ISSUER = 'pulsewatch'
const AUDIENCE = 'pulsewatch-client'
const DURATION_UNITS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

export function durationToMilliseconds(value) {
  const match = /^(\d+)([smhd])$/.exec(value)
  if (!match) throw new Error('Invalid token duration configuration')
  return Number(match[1]) * DURATION_UNITS[match[2]]
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function createTokenPair({ userId, familyId }) {
  const accessToken = jwt.sign(
    { typ: 'access', sid: familyId },
    env.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', subject: String(userId), issuer: ISSUER, audience: AUDIENCE, expiresIn: env.ACCESS_TOKEN_TTL, jwtid: randomUUID() },
  )
  const refreshToken = jwt.sign(
    { typ: 'refresh', sid: familyId },
    env.JWT_REFRESH_SECRET,
    { algorithm: 'HS256', subject: String(userId), issuer: ISSUER, audience: AUDIENCE, expiresIn: env.REFRESH_TOKEN_TTL, jwtid: randomUUID() },
  )
  const refreshClaims = jwt.decode(refreshToken)

  return {
    accessToken,
    refreshToken,
    refreshTokenHash: hashToken(refreshToken),
    refreshExpiresAt: new Date(refreshClaims.exp * 1_000),
  }
}

function verify(token, secret, type, { ignoreExpiration = false } = {}) {
  try {
    const claims = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      ignoreExpiration,
    })
    if (claims.typ !== type || typeof claims.sub !== 'string' || typeof claims.sid !== 'string') return null
    return claims
  } catch {
    return null
  }
}

export const verifyAccessToken = (token) => verify(token, env.JWT_ACCESS_SECRET, 'access')
export const verifyRefreshToken = (token, options) => verify(token, env.JWT_REFRESH_SECRET, 'refresh', options)
