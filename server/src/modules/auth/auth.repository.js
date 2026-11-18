import { withMongoTransaction } from '../../config/database.js'
import { SessionToken } from './session-token.model.js'
import * as userRepository from '../users/user.repository.js'
import * as workspaceRepository from '../workspaces/workspace.repository.js'

export { withMongoTransaction, withMongoTransaction as withTransaction }
export const findUserByEmail = userRepository.findUserByEmail
export const findUserById = userRepository.findUserById
export const createUser = userRepository.createUser
export const findWorkspaceByOwner = workspaceRepository.findWorkspaceByOwner
export const createWorkspace = workspaceRepository.createWorkspace

export function findSessionTokenByHash(tokenHash, session) {
  const query = SessionToken.findOne({ tokenHash })
  return session ? query.session(session) : query
}

export async function createSessionToken(data, session) {
  const [token] = await SessionToken.create([data], { session })
  return token
}

export function consumeSessionToken(tokenHash, replacementHash, session) {
  return SessionToken.findOneAndUpdate(
    { tokenHash, status: 'active' },
    { $set: { status: 'used', usedAt: new Date(), replacedByTokenHash: replacementHash } },
    { new: true, session },
  )
}

export function revokeSessionFamily(familyId, session) {
  return SessionToken.updateMany({ familyId, status: { $in: ['active', 'used'] } }, { $set: { status: 'revoked' } }, { session })
}
