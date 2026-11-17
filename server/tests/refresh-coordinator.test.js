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
  let held = false
  return {
    request: (_name, options, callback) => {
      if (held && options.ifAvailable) return Promise.resolve(callback(null))
      const execute = async () => {
        held = true
        try { return await callback({ name: 'pulsewatch-auth-refresh-v1' }) }
        finally { held = false }
      }
      return execute()
    },
  }
}

function createSharedStorage() {
  const entries = new Map()
  return {
    getItem: jest.fn((key) => entries.get(key) ?? null),
    setItem: jest.fn((key, value) => entries.set(key, value)),
    removeItem: jest.fn((key) => entries.delete(key)),
  }
}

function httpRefresh(fetchImpl) {
  return async () => {
    const response = await fetchImpl('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
    if (!response.ok) return null
    return (await response.json()).accessToken
  }
}

async function runConcurrentTabs({ count, locks, createChannel, storage, timestamps = [] }) {
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
  const coordinators = ids.map((id, index) => createRefreshCoordinator({
    locks,
    createChannel,
    storage,
    wait: () => new Promise((resolve) => setImmediate(resolve)),
    now: timestamps[index] === undefined ? Date.now : () => timestamps[index],
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

  it('groups two Web Locks refresh requests with distinct timestamps', async () => {
    const result = await runConcurrentTabs({
      count: 2,
      locks: createWebLocks(),
      createChannel: createBroadcastHub(),
      storage: createSharedStorage(),
      timestamps: [10_000, 10_040],
    })
    expect(result.fetchCount).toBe(1)
    expect(result.results).toEqual(['rotated-access-token', 'rotated-access-token'])
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

  it('sends a new HTTP request for an independent operation after a successful group', async () => {
    const coordinate = createRefreshCoordinator({ locks: createWebLocks(), createChannel: createBroadcastHub(), wait: async () => {} })
    const responses = ['first-access-token', 'second-access-token']
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ accessToken: responses.shift() }) }))

    const first = await coordinate(httpRefresh(fetchImpl))
    const second = await coordinate(httpRefresh(fetchImpl))

    expect(first).toBe('first-access-token')
    expect(second).toBe('second-access-token')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('sends a new HTTP request for an independent operation after a failed group', async () => {
    const coordinate = createRefreshCoordinator({ locks: createWebLocks(), createChannel: createBroadcastHub(), wait: async () => {} })
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ accessToken: 'recovered-access-token' }) })

    const first = await coordinate(httpRefresh(fetchImpl))
    const second = await coordinate(httpRefresh(fetchImpl))

    expect(first).toBeNull()
    expect(second).toBe('recovered-access-token')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('returns within the configured bound if a refresh leader disappears without a result', async () => {
    jest.useFakeTimers()
    try {
      let onMessage
      const createChannel = () => ({
        addEventListener(_type, listener) { onMessage = listener },
        postMessage(data) {
          if (data.type === 'refresh-request') {
            onMessage({ data: { type: 'refresh-start', operationId: 'vanished-leader', requestIds: ['follower'] } })
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
      expect(jest.getTimerCount()).toBe(0)
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

  it('uses Web Locks without BroadcastChannel and localStorage without storing any token', async () => {
    const storage = createSharedStorage()
    const createChannel = () => { throw new Error('BroadcastChannel unavailable') }
    const options = { locks: createWebLocks(), createChannel, storage, wait: () => new Promise((resolve) => setImmediate(resolve)) }
    const first = createRefreshCoordinator({ ...options, idFactory: () => 'first' })
    const second = createRefreshCoordinator({ ...options, idFactory: () => 'second' })
    const firstOperation = jest.fn(async () => 'secret-access-token')
    const secondOperation = jest.fn(async () => 'duplicate-token')
    let release
    const heldOperation = new Promise((resolve) => { release = resolve })
    const firstPending = first(async () => { await heldOperation; return firstOperation() })
    const secondPending = second(secondOperation)
    release()
    const results = await Promise.all([firstPending, secondPending])
    expect(firstOperation).toHaveBeenCalledTimes(1)
    expect(secondOperation).not.toHaveBeenCalled()
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('does not send a second storage-only request when competing tabs have different timestamps', async () => {
    const locks = createWebLocks()
    const storage = createSharedStorage()
    const createOptions = (timestamp, id) => ({
      locks,
      createChannel: null,
      storage,
      now: () => timestamp,
      wait: () => new Promise((resolve) => setImmediate(resolve)),
      idFactory: () => id,
    })
    const first = createRefreshCoordinator(createOptions(10_000, 'earlier-tab'))
    const second = createRefreshCoordinator(createOptions(10_250, 'later-tab'))
    let releaseResponse
    const responseBarrier = new Promise((resolve) => { releaseResponse = resolve })
    const firstFetch = jest.fn(async () => {
      await responseBarrier
      return { ok: true, json: async () => ({ accessToken: 'only-token' }) }
    })
    const secondFetch = jest.fn(async () => ({ ok: true, json: async () => ({ accessToken: 'duplicate-token' }) }))

    const firstPending = first(httpRefresh(firstFetch))
    const secondPending = second(httpRefresh(secondFetch))
    await new Promise((resolve) => setImmediate(resolve))
    expect(firstFetch).toHaveBeenCalledTimes(1)
    expect(secondFetch).not.toHaveBeenCalled()
    releaseResponse()
    await Promise.all([firstPending, secondPending])
    expect(firstFetch).toHaveBeenCalledTimes(1)
    expect(secondFetch).not.toHaveBeenCalled()
  })

  it('does not depend on localStorage when it is unavailable', async () => {
    const locks = createWebLocks()
    const coordinate = createRefreshCoordinator({
      locks,
      createChannel: null,
      storage: { getItem() { throw new Error('storage blocked') }, setItem() { throw new Error('storage blocked') } },
      wait: async () => {},
    })
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ accessToken: 'lock-only-token' }) }))
    await expect(coordinate(httpRefresh(fetchImpl))).resolves.toBe('lock-only-token')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
