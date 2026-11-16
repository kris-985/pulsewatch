import mongoose from 'mongoose'
import { env } from './env.js'

export async function connectMongo() {
  if (mongoose.connection.readyState === 1) return mongoose.connection
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  return mongoose.connection
}

export async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect()
}

export async function withMongoTransaction(operation) {
  const session = await mongoose.startSession()
  let result

  try {
    await session.withTransaction(async () => {
      result = await operation(session)
    }, {
      readPreference: 'primary',
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    })
    return result
  } finally {
    await session.endSession()
  }
}

export function isMongoReady() {
  return mongoose.connection.readyState === 1
}
