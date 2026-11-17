import mongoose from 'mongoose'
import { env } from './env.js'

export async function connectMongo() {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  }
  const connection = mongoose.connection

  try {
    await assertMongoTransactionReady(connection)
    return connection
  } catch (error) {
    await mongoose.disconnect()
    throw error
  }
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

async function assertMongoTransactionReady(connection) {
  const hello = await connection.db.admin().command({ hello: 1 })
  if (
    hello.setName !== 'rs0'
    || hello.isWritablePrimary !== true
    || typeof hello.logicalSessionTimeoutMinutes !== 'number'
  ) {
    throw new Error('MongoDB replica set rs0 is not PRIMARY and transaction-ready')
  }
}

export async function isMongoReady() {
  if (mongoose.connection.readyState !== 1) return false
  try {
    await assertMongoTransactionReady(mongoose.connection)
    return true
  } catch {
    return false
  }
}
