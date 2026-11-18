import * as authRepository from '../src/modules/auth/auth.repository.js'
import { withMongoTransaction } from '../src/config/database.js'

describe('auth repository', () => {
  it('provides withTransaction as the database transaction implementation', () => {
    expect(authRepository.withTransaction).toBe(withMongoTransaction)
  })
})
