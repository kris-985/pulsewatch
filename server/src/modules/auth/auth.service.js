import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { env } from '../../config/env.js'
import { createTokenPair, durationToMilliseconds, hashToken, verifyRefreshToken } from '../../security/tokens/jwt.js'
import { conflict, unauthorized } from '../../shared/http-error.js'
import * as defaultRepository from './auth.repository.js'

const BCRYPT_COST = 12
const DUMMY_PASSWORD_HASH = '$2b$12$bmiQXkY2V3uhmGjodnpe5.nlGUlk3EgBlmrioyUcK/Zkj7ijv9AV6'

function safeUser(user) {
  return { id: String(user._id ?? user.id), name: user.name, email: user.email }
}

function safeWorkspace(workspace) {
  return { id: String(workspace._id ?? workspace.id), name: workspace.name, planCode: workspace.planCode }
}

export class AuthService {
  constructor({ repository = defaultRepository, passwordHasher = bcrypt, tokenFactory = createTokenPair } = {}) {
    this.repository = repository
    this.passwordHasher = passwordHasher
    this.tokenFactory = tokenFactory
  }

  async register({ name, email, password }) {
    const normalizedEmail = email.trim().toLowerCase()
    const passwordHash = await this.passwordHasher.hash(password, BCRYPT_COST)
    const familyId = randomUUID()

    try {
      const result = await this.repository.withTransaction(async (session) => {
        const user = await this.repository.createUser({ name: name.trim(), email: normalizedEmail, passwordHash }, session)
        const workspace = await this.repository.createWorkspace({
          ownerId: user._id ?? user.id,
          name: `${name.trim()}'s workspace`,
          planCode: 'free',
          activeMonitorCount: 0,
        }, session)
        const actualPair = this.tokenFactory({ userId: user._id ?? user.id, familyId })
        await this.repository.createSessionToken({
          userId: user._id ?? user.id,
          familyId,
          tokenHash: actualPair.refreshTokenHash,
          status: 'active',
          expiresAt: actualPair.refreshExpiresAt,
        }, session)
        return { user, workspace, pair: actualPair }
      })

      return this.#authResult(result.user, result.workspace, result.pair)
    } catch (error) {
      if (error?.code === 11000) throw conflict('EMAIL_ALREADY_EXISTS', 'An account with this email already exists')
      throw error
    }
  }

  async login({ email, password }) {
    const normalizedEmail = email.trim().toLowerCase()
    const user = await this.repository.findUserByEmail(normalizedEmail, { includePassword: true })
    const passwordMatches = await this.passwordHasher.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)

    if (!user || !passwordMatches || user.status !== 'active') {
      throw unauthorized('Email or password is incorrect')
    }

    const workspace = await this.repository.findWorkspaceByOwner(user._id ?? user.id)
    if (!workspace) throw new Error('User workspace invariant is missing')

    const familyId = randomUUID()
    const pair = this.tokenFactory({ userId: user._id ?? user.id, familyId })
    await this.repository.withTransaction((session) => this.repository.createSessionToken({
      userId: user._id ?? user.id,
      familyId,
      tokenHash: pair.refreshTokenHash,
      status: 'active',
      expiresAt: pair.refreshExpiresAt,
    }, session))

    return this.#authResult(user, workspace, pair)
  }

  async refresh(refreshToken) {
    const claims = verifyRefreshToken(refreshToken)
    if (!claims) throw unauthorized('Refresh token is invalid or expired')

    const user = await this.repository.findUserById(claims.sub)
    if (!user || user.status !== 'active') throw unauthorized('Account is unavailable')

    const oldHash = hashToken(refreshToken)
    const familyId = claims.sid
    const nextPair = this.tokenFactory({ userId: claims.sub, familyId })
    const outcome = await this.repository.withTransaction(async (session) => {
      const stored = await this.repository.findSessionTokenByHash(oldHash, session)
      if (!stored) return { kind: 'invalid' }

      if (stored.status === 'used') {
        await this.repository.revokeSessionFamily(familyId, session)
        return { kind: 'reused' }
      }

      if (stored.status !== 'active' || String(stored.userId) !== claims.sub || stored.familyId !== familyId) {
        return { kind: 'invalid' }
      }

      const consumed = await this.repository.consumeSessionToken(oldHash, nextPair.refreshTokenHash, session)
      if (!consumed) return { kind: 'race' }

      await this.repository.createSessionToken({
        userId: claims.sub,
        familyId,
        tokenHash: nextPair.refreshTokenHash,
        status: 'active',
        expiresAt: nextPair.refreshExpiresAt,
      }, session)
      return { kind: 'rotated' }
    })

    if (outcome.kind === 'race') {
      const current = await this.repository.findSessionTokenByHash(oldHash)
      if (current?.status === 'used') {
        await this.repository.withTransaction((session) => this.repository.revokeSessionFamily(familyId, session))
      }
      throw unauthorized('Refresh token reuse detected; sign in again')
    }
    if (outcome.kind === 'reused') throw unauthorized('Refresh token reuse detected; sign in again')
    if (outcome.kind !== 'rotated') throw unauthorized('Refresh token is invalid or expired')

    return this.#authResult(user, null, nextPair)
  }

  async logout(refreshToken) {
    if (!refreshToken) return
    const claims = verifyRefreshToken(refreshToken, { ignoreExpiration: true })
    if (!claims) return
    await this.repository.withTransaction((session) => this.repository.revokeSessionFamily(claims.sid, session))
  }

  async getMe(userId) {
    const [user, workspace] = await Promise.all([
      this.repository.findUserById(userId),
      this.repository.findWorkspaceByOwner(userId),
    ])
    if (!user || user.status !== 'active') throw unauthorized('Account is unavailable')
    if (!workspace) throw new Error('User workspace invariant is missing')
    return { user: safeUser(user), workspace: safeWorkspace(workspace) }
  }

  #authResult(user, workspace, pair) {
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      refreshExpiresAt: pair.refreshExpiresAt,
      user: safeUser(user),
      workspace: workspace ? safeWorkspace(workspace) : null,
      accessTokenTtlSeconds: Math.floor(durationToMilliseconds(env.ACCESS_TOKEN_TTL) / 1_000),
    }
  }
}

export const authService = new AuthService()
