import { User } from './user.model.js'

export const findUserByEmail = (email, { includePassword = false, session } = {}) => {
  let query = User.findOne({ email })
  if (includePassword) query = query.select('+passwordHash')
  if (session) query = query.session(session)
  return query
}

export const findUserById = (userId) => User.findById(userId)

export async function createUser(data, session) {
  const [user] = await User.create([data], { session })
  return user
}
