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

export function isMongoReady() {
  return mongoose.connection.readyState === 1
}
