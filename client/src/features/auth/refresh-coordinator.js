const LOCK_NAME = 'pulsewatch-auth-refresh-v1'
const CHANNEL_NAME = 'pulsewatch-auth-refresh-v1'
const STORAGE_KEY = 'pulsewatch:auth-refresh-lease:v1'
const ELECTION_WINDOW_MS = 80
const VERIFY_WINDOW_MS = 40
const LEASE_MS = 120_000
const HEARTBEAT_INTERVAL_MS = 10_000

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export function createRefreshCoordinator({
  locks = typeof navigator === 'undefined' ? null : navigator.locks,
  createChannel = typeof BroadcastChannel === 'undefined' ? null : (name) => new BroadcastChannel(name),
  storage,
  now = Date.now,
  wait = delay,
  idFactory = () => crypto.randomUUID(),
} = {}) {
  let inFlight = null
  let channel = null
  let channelInitialized = false
  let activeLeader = null
  let storageApi = storage
  const requests = new Map()
  const completed = new Map()
  const waiters = new Map()

  function initializeChannel() {
    if (channelInitialized) return channel
    channelInitialized = true
    channel = createChannel?.(CHANNEL_NAME) ?? null
    if (!channel) return null

    channel.addEventListener('message', ({ data }) => {
      if (!data || typeof data !== 'object') return
      if (data.type === 'refresh-request' && typeof data.id === 'string') {
        requests.set(data.id, data.at)
        if (activeLeader && activeLeader.expiresAt > now()) {
          channel.postMessage({ type: 'refresh-start', id: activeLeader.id, expiresAt: activeLeader.expiresAt, to: data.id })
        }
      } else if (data.type === 'refresh-start' && typeof data.id === 'string') {
        activeLeader = { id: data.id, expiresAt: data.expiresAt }
      } else if (data.type === 'refresh-complete' && typeof data.id === 'string') {
        completed.set(data.id, { token: data.token, at: now() })
        if (activeLeader?.id === data.id) activeLeader = null
        for (const waiter of waiters.get(data.id) ?? []) waiter.finish({ done: true, token: data.token })
      }
    })
    return channel
  }

  function readLease() {
    if (storageApi === undefined) {
      try { storageApi = globalThis.localStorage ?? null } catch { storageApi = null }
    }
    if (!storageApi) return null
    try {
      const value = storageApi.getItem(STORAGE_KEY)
      if (!value) return null
      const lease = JSON.parse(value)
      if (typeof lease.id !== 'string' || typeof lease.expiresAt !== 'number') return null
      if (lease.expiresAt <= now()) {
        storageApi.removeItem(STORAGE_KEY)
        return null
      }
      return lease
    } catch {
      storageApi = null
      return null
    }
  }

  function waitForCompletion(id, timeoutMs) {
    const prior = completed.get(id)
    if (prior && now() - prior.at <= LEASE_MS) return Promise.resolve({ done: true, token: prior.token })

    return new Promise((resolve) => {
      const entry = {
        finish(result) {
          clearTimeout(timer)
          const entries = waiters.get(id)
          entries?.delete(entry)
          if (entries?.size === 0) waiters.delete(id)
          resolve(result)
        },
      }
      const timer = setTimeout(() => entry.finish({ done: false, token: null }), timeoutMs)
      if (!waiters.has(id)) waiters.set(id, new Set())
      waiters.get(id).add(entry)
    })
  }

  async function waitForLeader(id, expiresAt) {
    let currentExpiry = expiresAt
    while (true) {
      const remaining = Math.max(0, currentExpiry - now())
      const result = await waitForCompletion(id, remaining + 1_000)
      if (result.done) return result.token

      const storedLease = readLease()
      const leader = storedLease?.id === id
        ? storedLease
        : activeLeader?.id === id ? activeLeader : null
      if (!leader || leader.expiresAt <= now()) return undefined
      currentExpiry = leader.expiresAt
    }
  }

  async function coordinateWithBroadcastChannel(operation) {
    const bus = initializeChannel()
    if (!bus) {
      throw new Error('This browser does not provide cross-tab refresh coordination')
    }

    const id = idFactory()
    const existingLease = readLease()
    if (existingLease) {
      const result = await waitForLeader(existingLease.id, existingLease.expiresAt)
      if (result !== undefined) return result
    }

    requests.set(id, now())
    bus.postMessage({ type: 'refresh-request', id, at: now() })
    await wait(ELECTION_WINDOW_MS)

    const currentLease = readLease()
    if (currentLease) {
      const result = await waitForLeader(currentLease.id, currentLease.expiresAt)
      if (result !== undefined) return result
    }
    if (activeLeader && activeLeader.id !== id && activeLeader.expiresAt > now()) {
      const result = await waitForLeader(activeLeader.id, activeLeader.expiresAt)
      if (result !== undefined) return result
    }

    const cutoff = now() - (ELECTION_WINDOW_MS * 2)
    for (const [requestId, at] of requests) {
      if (at < cutoff) requests.delete(requestId)
    }
    const electedId = [...requests.keys(), id].sort()[0]
    if (electedId !== id) {
      const result = await waitForLeader(electedId, now() + LEASE_MS)
      if (result !== undefined) return result
    }

    const lease = { id, expiresAt: now() + LEASE_MS }
    const persistentStorage = readLease() === null && storageApi !== null
    if (persistentStorage) {
      try {
        storageApi.setItem(STORAGE_KEY, JSON.stringify(lease))
      } catch {
        storageApi = null
      }
    }
    if (storageApi) {
      await wait(VERIFY_WINDOW_MS)
      const confirmedLease = readLease()
      if (!confirmedLease || confirmedLease.id !== id) {
        if (confirmedLease) {
          const result = await waitForLeader(confirmedLease.id, confirmedLease.expiresAt)
          if (result !== undefined) return result
        }
        throw new Error('Could not acquire the cross-tab refresh lease')
      }
    }

    activeLeader = lease
    bus.postMessage({ type: 'refresh-start', id, expiresAt: lease.expiresAt })
    const heartbeat = setInterval(() => {
      const renewedLease = { id, expiresAt: now() + LEASE_MS }
      if (storageApi) {
        const latestLease = readLease()
        if (latestLease?.id !== id) return
        try {
          storageApi.setItem(STORAGE_KEY, JSON.stringify(renewedLease))
        } catch {
          storageApi = null
        }
      }
      activeLeader = renewedLease
      bus.postMessage({ type: 'refresh-start', id, expiresAt: renewedLease.expiresAt })
    }, HEARTBEAT_INTERVAL_MS)
    let token = null
    try {
      token = await operation()
      return token
    } finally {
      clearInterval(heartbeat)
      const latestLease = readLease()
      if (latestLease?.id === id) storageApi.removeItem(STORAGE_KEY)
      if (activeLeader?.id === id) activeLeader = null
      bus.postMessage({ type: 'refresh-complete', id, token })
      completed.set(id, { token, at: now() })
    }
  }

  return function coordinateRefresh(operation) {
    if (inFlight) return inFlight
    const coordinatedOperation = locks?.request
      ? locks.request(LOCK_NAME, { mode: 'exclusive' }, operation)
      : coordinateWithBroadcastChannel(operation)
    inFlight = Promise.resolve(coordinatedOperation).finally(() => { inFlight = null })
    return inFlight
  }
}
