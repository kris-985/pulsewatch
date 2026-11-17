import { jest } from '@jest/globals'
import mongoInit from '../../docker/mongo-init.js'

const { connectUntilReachable, ensureReplicaSet } = mongoInit

function createFakeClock() {
  let time = 0
  return {
    now: () => time,
    wait: async (milliseconds) => { time += milliseconds },
  }
}

const primaryHello = {
  ok: 1,
  setName: 'rs0',
  isWritablePrimary: true,
  logicalSessionTimeoutMinutes: 30,
}

describe('MongoDB replica set initialization', () => {
  it('initializes a fresh replica set and waits until it is PRIMARY', async () => {
    const clock = createFakeClock()
    let initialized = false
    const admin = {
      command: jest.fn(async (command) => {
        if (command.hello) return initialized ? primaryHello : { ok: 1, isWritablePrimary: false }
        if (command.replSetInitiate) {
          initialized = true
          return { ok: 1 }
        }
        throw new Error('Unexpected MongoDB command')
      }),
    }

    const result = await ensureReplicaSet({ admin, now: clock.now, wait: clock.wait })

    expect(result).toEqual({ replicaSetName: 'rs0', primary: true })
    expect(admin.command).toHaveBeenCalledWith({
      replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'mongodb:27017' }] },
    })
    expect(admin.command.mock.calls.filter(([command]) => command.hello)).toHaveLength(2)
  })

  it('leaves an existing replica set unchanged on restart', async () => {
    const admin = { command: jest.fn().mockResolvedValue(primaryHello) }

    await expect(ensureReplicaSet({ admin })).resolves.toEqual({ replicaSetName: 'rs0', primary: true })

    expect(admin.command).toHaveBeenCalledTimes(1)
    expect(admin.command).toHaveBeenCalledWith({ hello: 1 })
  })

  it('retries MongoDB connectivity while it is temporarily unavailable', async () => {
    const clock = createFakeClock()
    const connection = { readyState: 0 }
    const mongooseInstance = {
      connection,
      connect: jest.fn()
        .mockRejectedValueOnce(new Error('MongoDB temporarily unavailable'))
        .mockImplementationOnce(async () => { connection.readyState = 1 }),
      disconnect: jest.fn(async () => { connection.readyState = 0 }),
    }

    await expect(connectUntilReachable({
      mongooseInstance,
      uri: 'mongodb://mongodb:27017/admin?directConnection=true',
      now: clock.now,
      wait: clock.wait,
    })).resolves.toBe(connection)

    expect(mongooseInstance.connect).toHaveBeenCalledTimes(2)
    expect(mongooseInstance.disconnect).toHaveBeenCalledTimes(1)
  })

  it('fails clearly if replica set initialization is rejected', async () => {
    const admin = {
      command: jest.fn(async (command) => {
        if (command.hello) return { ok: 1, isWritablePrimary: false }
        const error = new Error('invalid replica set config')
        error.code = 93
        error.codeName = 'InvalidReplicaSetConfig'
        throw error
      }),
    }

    await expect(ensureReplicaSet({ admin })).rejects.toThrow('MongoDB replica set initialization failed (InvalidReplicaSetConfig)')
  })

  it('times out if rs0 never reaches PRIMARY', async () => {
    const clock = createFakeClock()
    const admin = {
      command: jest.fn().mockResolvedValue({
        ok: 1,
        setName: 'rs0',
        isWritablePrimary: false,
        logicalSessionTimeoutMinutes: 30,
      }),
    }

    await expect(ensureReplicaSet({
      admin,
      timeoutMs: 1_000,
      now: clock.now,
      wait: clock.wait,
    })).rejects.toThrow('did not become transaction-ready before the 1000ms deadline')

    expect(admin.command).toHaveBeenCalledTimes(2)
  })

  it('does not reinitialize when another initializer already configured rs0', async () => {
    const admin = {
      command: jest.fn(async (command) => {
        if (command.hello) return { ok: 1, isWritablePrimary: false }
        const error = new Error('already initialized')
        error.code = 23
        error.codeName = 'AlreadyInitialized'
        return Promise.reject(error)
      })
        .mockResolvedValueOnce({ ok: 1, isWritablePrimary: false })
        .mockRejectedValueOnce(Object.assign(new Error('already initialized'), { code: 23, codeName: 'AlreadyInitialized' }))
        .mockResolvedValueOnce(primaryHello),
    }

    await expect(ensureReplicaSet({ admin })).resolves.toEqual({ replicaSetName: 'rs0', primary: true })
    expect(admin.command.mock.calls.filter(([command]) => command.replSetInitiate)).toHaveLength(1)
  })
})
