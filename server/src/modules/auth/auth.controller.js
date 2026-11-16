import { randomBytes } from 'node:crypto'
import { env } from '../../config/env.js'
import { CSRF_COOKIE, REFRESH_COOKIE, AUTH_COOKIE_PATH, parseCookies } from '../../security/tokens/cookies.js'
import { authService } from './auth.service.js'

const cookieDefaults = () => ({
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: AUTH_COOKIE_PATH,
})

function setSessionCookies(res, result) {
  const options = cookieDefaults()
  res.cookie(REFRESH_COOKIE, result.refreshToken, {
    ...options,
    httpOnly: true,
    maxAge: result.refreshExpiresAt.getTime() - Date.now(),
  })
  res.cookie(CSRF_COOKIE, randomBytes(32).toString('hex'), {
    ...options,
    path: '/',
    httpOnly: false,
    maxAge: result.refreshExpiresAt.getTime() - Date.now(),
  })
}

function clearSessionCookies(res) {
  const options = cookieDefaults()
  res.clearCookie(REFRESH_COOKIE, { ...options, httpOnly: true })
  res.clearCookie(CSRF_COOKIE, { ...options, path: '/', httpOnly: false })
}

export function createAuthController(service = authService) {
  return {
    async register(req, res) {
      const result = await service.register(req.validatedBody)
      setSessionCookies(res, result)
      res.status(201).json({
        accessToken: result.accessToken,
        accessTokenTtlSeconds: result.accessTokenTtlSeconds,
        user: result.user,
        workspace: result.workspace,
      })
    },

    async login(req, res) {
      const result = await service.login(req.validatedBody)
      setSessionCookies(res, result)
      res.status(200).json({
        accessToken: result.accessToken,
        accessTokenTtlSeconds: result.accessTokenTtlSeconds,
        user: result.user,
        workspace: result.workspace,
      })
    },

    async refresh(req, res) {
      const refreshToken = parseCookies(req.get('cookie'))[REFRESH_COOKIE]
      try {
        const result = await service.refresh(refreshToken)
        setSessionCookies(res, result)
        res.status(200).json({
          accessToken: result.accessToken,
          accessTokenTtlSeconds: result.accessTokenTtlSeconds,
        })
      } catch (error) {
        if (error.status === 401) clearSessionCookies(res)
        throw error
      }
    },

    async logout(req, res) {
      const refreshToken = parseCookies(req.get('cookie'))[REFRESH_COOKIE]
      await service.logout(refreshToken)
      clearSessionCookies(res)
      res.status(204).end()
    },

    async me(req, res) {
      res.status(200).json(await service.getMe(req.auth.userId))
    },
  }
}
