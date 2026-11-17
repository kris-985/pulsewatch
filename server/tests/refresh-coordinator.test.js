import { jest } from '@jest/globals'
import { createRefreshCoordinator } from '../../client/src/features/auth/refresh-coordinator.js'

function createBroadcastHub() {
  const peers = []
  return () => {
    const listeners = new Set()
    const peer = {
      addEventListener(_type, listener) { listeners.add(listener) },
      postMessage(data) {
        for (const other of peers) {
          if (other === peer) continue
          queueMicrotask(() => {
            for (const listener of other.listeners) listener({ data })
          })
        }
      },
      listeners,
    }
    peers.push(peer)
    return peer
  }
}

function createSharedStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('cross-tab refresh coordination', () => {
  it('shares one refresh result between simultaneous tabs with BroadcastChannel fallback', async () => {
    const createChannel = createBroadcastHub()
    const storage = createSharedStorage()
    const options = {
      locks: null,
      createChannel,
      storage,
      wait: async () => {},
    }
    const tabA = createRefreshCoordinator({ ...options, idFactory: () => 'tab-b' })
    const tabB = createRefreshCoordinator({ ...options, idFactory: () => 'tab-a' })
    const refreshA = jest.fn(async () => 'new-access-token')
    const refreshB = jest.fn(async () => 'unexpected-second-refresh')

    const results = await Promise.all([tabA(refreshA), tabB(refreshB)])

    expect(results).toEqual(['new-access-token', 'new-access-token'])
    expect(refreshA.mock.calls.length + refreshB.mock.calls.length).toBe(1)
  })

  it('uses BroadcastChannel as a fallback when browser storage is unavailable', async () => {
    const options = {
      locks: null,
      createChannel: createBroadcastHub(),
      storage: null,
      wait: () => new Promise((resolve) => setImmediate(resolve)),
    }
    const tabA = createRefreshCoordinator({ ...options, idFactory: () => 'tab-z' })
    const tabB = createRefreshCoordinator({ ...options, idFactory: () => 'tab-a' })
    const refreshA = jest.fn(async () => 'shared-token')
    const refreshB = jest.fn(async () => 'unexpected-second-refresh')

    const results = await Promise.all([tabA(refreshA), tabB(refreshB)])

    expect(results[0]).toBe(results[1])
    expect(refreshA.mock.calls.length + refreshB.mock.calls.length).toBe(1)
  })

  it('serializes refresh operations through Web Locks when available', async () => {
    let tail = Promise.resolve()
    let active = 0
    let maxActive = 0
    const locks = {
      request: (_name, _options, callback) => {
        const result = tail.then(async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          try { return await callback() } finally { active -= 1 }
        })
        tail = result.then(() => undefined, () => undefined)
        return result
      },
    }
    const options = { locks, createChannel: null, storage: null }
    const tabA = createRefreshCoordinator(options)
    const tabB = createRefreshCoordinator(options)
    const refreshA = jest.fn(async () => 'token-a')
    const refreshB = jest.fn(async () => 'token-b')

    const results = await Promise.all([tabA(refreshA), tabB(refreshB)])

    expect(results).toEqual(['token-a', 'token-b'])
    expect(maxActive).toBe(1)
  })
})
