import { AuthService } from '../src/modules/auth/auth.service.js'
import { hashToken } from '../src/security/tokens/jwt.js'

function createMemoryRepository() {
  const state = { users: [], workspaces: [], tokens: new Map() }
  let userId = 0
  let transactionTail = Promise.resolve()

  return {
    state,
    async withTransaction(operation) {
      const previousTransaction = transactionTail
      let release
      transactionTail = new Promise((resolve) => { release = resolve })
      await previousTransaction
      try {
        return await operation({ memorySession: true })
      } finally {
        release()
      }
    },
    async createUser(data) {
      const user = { _id: `user-${++userId}`, ...data, status: 'active' }
      state.users.push(user)
      return user
    },
    async createWorkspace(data) {
      const workspace = { _id: `workspace-${state.workspaces.length + 1}`, ...data }
      state.workspaces.push(workspace)
      return workspace
    },
    async findUserByEmail(email) {
      return state.users.find((user) => user.email === email) ?? null
    },
    async findUserById(id) {
      return state.users.find((user) => user._id === id) ?? null
    },
    async findWorkspaceByOwner(ownerId) {
      return state.workspaces.find((workspace) => workspace.ownerId === ownerId) ?? null
    },
    async createSessionToken(data) {
      const token = { ...data }
      state.tokens.set(data.tokenHash, token)
      return token
    },
    async findSessionTokenByHash(tokenHash) {
      return state.tokens.get(tokenHash) ?? null
    },
    async consumeSessionToken(tokenHash, replacementHash) {
      const token = state.tokens.get(tokenHash)
      if (!token || token.status !== 'active') return null
      token.status = 'used'
      token.replacedByTokenHash = replacementHash
      return token
    },
    async revokeSessionFamily(familyId) {
      for (const token of state.tokens.values()) {
        if (token.familyId === familyId && ['active', 'used'].includes(token.status)) token.status = 'revoked'
      }
    },
  }
}

describe('AuthService', () => {
  it('creates a personal free workspace atomically with the account and initial refresh session', async () => {
    const repository = createMemoryRepository()
    const service = new AuthService({
      repository,
      passwordHasher: { hash: async (password, cost) => `hashed:${cost}:${password}`, compare: async () => true },
    })

    const result = await service.register({ name: 'Ada Lovelace', email: 'ADA@example.com', password: 'correct horse battery' })

    expect(repository.state.users).toHaveLength(1)
    expect(repository.state.users[0].email).toBe('ada@example.com')
    expect(repository.state.workspaces).toHaveLength(1)
    expect(repository.state.workspaces[0]).toMatchObject({ ownerId: 'user-1', planCode: 'free', activeMonitorCount: 0 })
    expect(repository.state.tokens.size).toBe(1)
    expect(result.workspace.planCode).toBe('free')
    expect(result).not.toHaveProperty('passwordHash')
  })

  it('creates a separate refresh-token family at login', async () => {
    const repository = createMemoryRepository()
    const service = new AuthService({
      repository,
      passwordHasher: { hash: async (password) => `hashed:${password}`, compare: async () => true },
    })
    await service.register({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct horse battery' })

    const result = await service.login({ email: 'ADA@example.com', password: 'correct horse battery' })

    expect(repository.state.tokens.size).toBe(2)
    expect(result.user.email).toBe('ada@example.com')
    expect(result.workspace.name).toBe("Ada Lovelace's workspace")
  })

  it('rotates refresh tokens and revokes a family when a used token is replayed', async () => {
    const repository = createMemoryRepository()
    const service = new AuthService({
      repository,
      passwordHasher: { hash: async (password) => password, compare: async () => true },
    })
    const original = await service.register({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct horse battery' })
    const rotated = await service.refresh(original.refreshToken)

    expect(repository.state.tokens.get(hashToken(original.refreshToken)).status).toBe('used')
    expect(repository.state.tokens.size).toBe(2)
    await expect(service.refresh(original.refreshToken)).rejects.toMatchObject({ status: 401 })
    expect([...repository.state.tokens.values()].every((token) => token.status === 'revoked')).toBe(true)
    await expect(service.refresh(rotated.refreshToken)).rejects.toMatchObject({ status: 401 })
  })

  it('treats simultaneous refreshes of one token as reuse and revokes the family', async () => {
    const repository = createMemoryRepository()
    const service = new AuthService({
      repository,
      passwordHasher: { hash: async (password) => password, compare: async () => true },
    })
    const original = await service.register({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct horse battery' })

    const results = await Promise.allSettled([
      service.refresh(original.refreshToken),
      service.refresh(original.refreshToken),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected').reason).toMatchObject({ status: 401 })
    expect([...repository.state.tokens.values()].every((token) => token.status === 'revoked')).toBe(true)
  })
})
