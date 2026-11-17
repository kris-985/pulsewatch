const mongoose = require('mongoose')

const REPLICA_SET_NAME = 'rs0'
const MEMBER_HOST = 'mongodb:27017'
const STARTUP_TIMEOUT_MS = 120_000
const RETRY_INTERVAL_MS = 500

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function connectUntilReachable({
  mongooseInstance = mongoose,
  uri,
  timeoutMs = STARTUP_TIMEOUT_MS,
  now = Date.now,
  wait = delay,
}) {
  const deadline = now() + timeoutMs
  let lastError

  while (now() < deadline) {
    try {
      if (mongooseInstance.connection.readyState !== 1) {
        await mongooseInstance.connect(uri, { serverSelectionTimeoutMS: 2_000 })
      }
      return mongooseInstance.connection
    } catch (error) {
      lastError = error
      try {
        await mongooseInstance.disconnect()
      } catch {
        // A failed or partially opened connection is discarded before retry.
      }
      const remaining = deadline - now()
      if (remaining > 0) await wait(Math.min(RETRY_INTERVAL_MS, remaining))
    }
  }

  throw new Error(`MongoDB did not become reachable before the ${timeoutMs}ms initialization deadline (${lastError?.name ?? 'timeout'})`)
}

async function ensureReplicaSet({
  admin,
  replicaSetName = REPLICA_SET_NAME,
  memberHost = MEMBER_HOST,
  timeoutMs = STARTUP_TIMEOUT_MS,
  now = Date.now,
  wait = delay,
}) {
  const deadline = now() + timeoutMs
  let lastError

  while (now() < deadline) {
    let hello
    try {
      hello = await admin.command({ hello: 1 })
    } catch (error) {
      lastError = error
      const remaining = deadline - now()
      if (remaining > 0) await wait(Math.min(RETRY_INTERVAL_MS, remaining))
      continue
    }

    if (hello.setName && hello.setName !== replicaSetName) {
      throw new Error(`MongoDB is already configured as replica set ${hello.setName}; expected ${replicaSetName}`)
    }

    if (!hello.setName) {
      try {
        await admin.command({
          replSetInitiate: {
            _id: replicaSetName,
            members: [{ _id: 0, host: memberHost }],
          },
        })
      } catch (error) {
        const alreadyInitialized = error.code === 23 || error.codeName === 'AlreadyInitialized'
        if (!alreadyInitialized) {
          throw new Error(`MongoDB replica set initialization failed (${error.codeName ?? error.code ?? error.name})`)
        }
        lastError = error
      }
    }

    if (
      hello.setName === replicaSetName
      && hello.isWritablePrimary === true
      && typeof hello.logicalSessionTimeoutMinutes === 'number'
    ) {
      return { replicaSetName, primary: true }
    }

    const remaining = deadline - now()
    if (remaining > 0) await wait(Math.min(RETRY_INTERVAL_MS, remaining))
  }

  throw new Error(`MongoDB replica set ${replicaSetName} did not become transaction-ready before the ${timeoutMs}ms deadline (${lastError?.name ?? 'not PRIMARY'})`)
}

async function runInitialization({ mongooseInstance = mongoose, env = process.env } = {}) {
  if (!env.MONGODB_BOOTSTRAP_URI) throw new Error('MONGODB_BOOTSTRAP_URI is required')

  try {
    const connection = await connectUntilReachable({ mongooseInstance, uri: env.MONGODB_BOOTSTRAP_URI })
    const result = await ensureReplicaSet({ admin: connection.db.admin() })
    console.log(`MongoDB replica set ${result.replicaSetName} is PRIMARY and transaction-ready`)
    return result
  } finally {
    if (mongooseInstance.connection.readyState !== 0) await mongooseInstance.disconnect()
  }
}

if (require.main === module) {
  runInitialization().catch((error) => {
    console.error(`[mongo-rs-init] ${error.message}`)
    process.exitCode = 1
  })
}

module.exports = { connectUntilReachable, ensureReplicaSet, runInitialization }
