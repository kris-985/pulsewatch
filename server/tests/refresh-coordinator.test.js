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
            for (const listener of other.listeners) listener({ data: structuredClone(data) })
          })
        }
      },
      listeners,
    }
    peers.push(peer)
    return peer
  }
}

function createWebLocks() {
  let tail = Promise.resolve()
  return {
    request: (_name, _options, callback) => {
      const current = tail.then(() => callback({ name: 'pulsewatch-auth-refresh-v1' }))
      tail = current.then(() => undefined, () => undefined)
      return current
    },
  }
}

function createSharedStorage() {
  const entries = new Map()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  }
}

function httpRefresh(fetchImpl) {
  return async () => {
    const response = await fetchImpl('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
    if (!response.ok) return null
    return (await response.json()).accessToken
  }
}

async function runConcurrentTabs({ count, locks, createChannel, storage }) {
  const ids = Array.from({ length: count }, (_, index) => `tab-${String(index).padStart(2, '0')}`)
  let fetchCount = 0
  let releaseResponse
  const responseBarrier = new Promise((resolve) => { releaseResponse = resolve })
  const fetchImpl = jest.fn(async (url, options) => {
    expect(url).toBe('/api/v1/auth/refresh')
    expect(options.method).toBe('POST')
    fetchCount += 1
    await responseBarrier
    return { ok: true, json: async () => ({ accessToken: 'rotated-access-token' }) }
  })
  const coordinators = ids.map((id) => createRefreshCoordinator({
    locks,
    createChannel,
    storage,
    wait: () => new Promise((resolve) => setImmediate(resolve)),
    idFactory: () => id,
  }))
  const calls = coordinators.map((coordinate) => coordinate(httpRefresh(fetchImpl)))
  await new Promise((resolve) => setImmediate(resolve))
  releaseResponse()
  const results = await Promise.all(calls)
  return { fetchCount, fetchImpl, results }
}

describe('cross-tab refresh coordination', () => {
  it.each([2, 5])('sends exactly one real refresh HTTP request for %i simultaneous tabs with Web Locks', async (count) => {
    const createChannel = createBroadcastHub()
    const result = await runConcurrentTabs({ count, locks: createWebLocks(), createChannel, storage: createSharedStorage() })
    expect(result.fetchCount).toBe(1)
    expect(result.fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.results).toEqual(Array(count).fill('rotated-access-token'))
  })

  it.each([2, 5])('sends exactly one refresh request for %i tabs using BroadcastChannel fallback', async (count) => {
    const result = await runConcurrentTabs({ count, locks: null, createChannel: createBroadcastHub(), storage: null })
    expect(result.fetchCount).toBe(1)
    expect(result.results.filter(Boolean)).toHaveLength(count)
    expect(new Set(result.results)).toEqual(new Set(['rotated-access-token']))
  })

  it('does not retry after a refresh HTTP failure and shares the failure result', async () => {
    const createChannel = createBroadcastHub()
    let calls = 0
    const failing = async () => { calls += 1; throw new Error('network failure') }
    const options = { locks: createWebLocks(), createChannel, storage: createSharedStorage(), wait: () => new Promise((resolve) => setImmediate(resolve)) }
    const first = createRefreshCoordinator({ ...options, idFactory: () => 'first' })
    const second = createRefreshCoordinator({ ...options, idFactory: () => 'second' })
    const outcomes = await Promise.all([first(failing), second(failing)])
    expect(calls).toBe(1)
    expect(outcomes).toEqual([null, null])
  })

  it('treats an HTTP 401 as a shared failure without a second refresh request', async () => {
    const createChannel = createBroadcastHub()
    let calls = 0
    const unauthorizedRefresh = async () => {
      calls += 1
      return null
    }
    const options = { locks: createWebLocks(), createChannel, storage: createSharedStorage(), wait: () => new Promise((resolve) => setImmediate(resolve)) }
    const first = createRefreshCoordinator({ ...options, idFactory: () => 'first' })
    const second = createRefreshCoordinator({ ...options, idFactory: () => 'second' })
    await expect(Promise.all([first(unauthorizedRefresh), second(unauthorizedRefresh)])).resolves.toEqual([null, null])
    expect(calls).toBe(1)
  })

  it('returns within the configured bound if a refresh leader disappears without a result', async () => {
    jest.useFakeTimers()
    try {
      let onMessage
      const createChannel = () => ({
        addEventListener(_type, listener) { onMessage = listener },
        postMessage(data) {
          if (data.type === 'refresh-request') {
            onMessage({ data: { type: 'refresh-start', id: 'vanished-leader' } })
          }
        },
      })
      const coordinate = createRefreshCoordinator({
        locks: null,
        createChannel,
        storage: null,
        wait: async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() },
        resultWaitMs: 25,
        idFactory: () => 'follower',
      })
      const operation = jest.fn(async () => 'must-not-run')
      const pending = coordinate(operation)
      await Promise.resolve()
      await Promise.resolve()
      await jest.advanceTimersByTimeAsync(25)
      await expect(pending).resolves.toBeNull()
      expect(operation).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('fails closed when Web Locks, BroadcastChannel, and usable storage are unavailable', async () => {
    const coordinate = createRefreshCoordinator({ locks: null, createChannel: null, storage: null })
    const operation = jest.fn(async () => 'must-not-be-issued')
    await expect(coordinate(operation)).resolves.toBeNull()
    expect(operation).not.toHaveBeenCalled()
  })

  it('uses storage metadata with Web Locks but never stores an access token', async () => {
    const storage = createSharedStorage()
    const createChannel = () => { throw new Error('BroadcastChannel unavailable') }
    const options = { locks: createWebLocks(), createChannel, storage, wait: () => new Promise((resolve) => setImmediate(resolve)) }
    const first = createRefreshCoordinator({ ...options, idFactory: () => 'first' })
    const second = createRefreshCoordinator({ ...options, idFactory: () => 'second' })
    const firstOperation = jest.fn(async () => 'secret-access-token')
    const secondOperation = jest.fn(async () => 'duplicate-token')
    const results = await Promise.all([first(firstOperation), second(secondOperation)])
    expect(firstOperation).toHaveBeenCalledTimes(1)
    expect(secondOperation).not.toHaveBeenCalled()
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(JSON.stringify(storage.getItem('pulsewatch:auth-refresh-state:v1'))).not.toContain('secret-access-token')
  })
})
