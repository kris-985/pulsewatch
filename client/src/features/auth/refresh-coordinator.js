const LOCK_NAME = 'pulsewatch-auth-refresh-v1'
const CHANNEL_NAME = 'pulsewatch-auth-refresh-v1'
const STORAGE_KEY = 'pulsewatch:auth-refresh-state:v1'
const ELECTION_WINDOW_MS = 60
const RESULT_WAIT_MS = 2_000
const RESULT_CACHE_MS = 30_000

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Cross-tab single-flight for a rotating refresh cookie. Access tokens travel
 * only in ephemeral BroadcastChannel messages, never through persistent storage.
 * If an outcome is uncertain or result sharing is unavailable, callers fail
 * closed instead of replaying a potentially consumed refresh token.
 */
export function createRefreshCoordinator({
  locks = typeof navigator === 'undefined' ? null : navigator.locks,
  createChannel = typeof BroadcastChannel === 'undefined' ? null : (name) => new BroadcastChannel(name),
  storage,
  now = Date.now,
  wait = delay,
  resultWaitMs = RESULT_WAIT_MS,
  idFactory = () => crypto.randomUUID(),
} = {}) {
  let inFlight = null
  let channelInitialized = false
  let channel = null
  let storageApi = storage
  let activeId = null
  let lastCompletion = null
  const requests = new Map()
  const completions = new Map()
  const waiters = new Map()

  function hasRecentRequest() {
    return [...requests.values()].some((at) => now() - at <= RESULT_CACHE_MS)
  }

  function prune() {
    const cutoff = now() - RESULT_CACHE_MS
    for (const [id, at] of requests) if (at < cutoff) requests.delete(id)
    for (const [id, result] of completions) if (result.at < cutoff) completions.delete(id)
    if (lastCompletion?.at < cutoff) lastCompletion = null
  }

  function complete(data) {
    const result = {
      id: data.id,
      token: typeof data.token === 'string' ? data.token : null,
      ok: data.ok === true,
      at: Number(data.at) || now(),
    }
    completions.set(result.id, result)
    lastCompletion = result
    prune()
    if (activeId === result.id) activeId = null
    const listeners = waiters.get(result.id)
    if (listeners) {
      for (const listener of [...listeners]) listener(result)
      waiters.delete(result.id)
    }
  }

  function initializeChannel() {
    if (channelInitialized) return channel
    channelInitialized = true
    try {
      channel = createChannel?.(CHANNEL_NAME) ?? null
      channel?.addEventListener('message', ({ data }) => {
        if (!data || typeof data !== 'object' || typeof data.id !== 'string' || data.id.length > 128) return
        if (data.type === 'refresh-request') {
          const at = Number(data.at)
          if (!Number.isFinite(at) || Math.abs(now() - at) > RESULT_CACHE_MS) return
          requests.set(data.id, at)
          prune()
          if (activeId) channel.postMessage({ type: 'refresh-start', id: activeId })
          else if (lastCompletion && now() - lastCompletion.at <= RESULT_CACHE_MS) {
            channel.postMessage({ type: 'refresh-complete', id: data.id, token: lastCompletion.token, ok: lastCompletion.ok, at: lastCompletion.at })
          }
        } else if (data.type === 'refresh-vote') {
          const at = Number(data.at)
          if (!Number.isFinite(at) || Math.abs(now() - at) > RESULT_CACHE_MS || !Array.isArray(data.ids)) return
          for (const candidate of data.ids) {
            if (typeof candidate === 'string' && candidate.length <= 128 && !requests.has(candidate)) requests.set(candidate, at)
          }
        } else if (data.type === 'refresh-start') {
          if (requests.has(data.id) || hasRecentRequest()) activeId = data.id
        } else if (data.type === 'refresh-complete') {
          if (requests.has(data.id) || waiters.has(data.id) || activeId === data.id || hasRecentRequest()) complete(data)
        }
      })
    } catch {
      channel = null
    }
    return channel
  }

  function getStorage() {
    if (storageApi === undefined) {
      try { storageApi = globalThis.localStorage ?? null } catch { storageApi = null }
    }
    return storageApi
  }

  function readMarker() {
    const store = getStorage()
    if (!store) return null
    try {
      const raw = store.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return typeof parsed.id === 'string' && typeof parsed.at === 'number' ? parsed : null
    } catch {
      storageApi = null
      return null
    }
  }

  function waitFor(id, timeoutMs = resultWaitMs) {
    if (completions.has(id)) return Promise.resolve(completions.get(id))
    return new Promise((resolve) => {
      let listeners = waiters.get(id)
      if (!listeners) {
        listeners = new Set()
        waiters.set(id, listeners)
      }
      const finish = (value) => {
        clearTimeout(timer)
        listeners.delete(finish)
        if (listeners.size === 0) waiters.delete(id)
        resolve(value)
      }
      listeners.add(finish)
      const timer = setTimeout(() => finish(null), timeoutMs)
    })
  }

  async function perform(operation, id, requestedAt, bus) {
    let token = null
    let ok = false
    try {
      token = await operation()
      ok = typeof token === 'string' && token.length > 0
      return ok ? token : null
    } catch {
      // The request may have rotated the server cookie even if the response
      // was lost. Never retry it from another tab; callers must fail closed.
      return null
    } finally {
      const result = { type: 'refresh-complete', id, token: ok ? token : null, ok, at: now() }
      complete(result)
      if (bus) bus.postMessage(result)
      else {
        const store = getStorage()
        if (store) {
          try { store.setItem(STORAGE_KEY, JSON.stringify({ id, at: result.at, pending: false })) } catch { storageApi = null }
        }
      }
    }
  }

  async function withWebLock(operation, id, requestedAt, bus) {
    return locks.request(LOCK_NAME, { mode: 'exclusive' }, async (lock) => {
      if (!lock) return null

      // Let same-turn peers announce their 401 before deciding whether this
      // lock holder is the refresh leader.
      await wait(ELECTION_WINDOW_MS)

      if (bus) {
        if (lastCompletion && now() - lastCompletion.at <= RESULT_CACHE_MS) {
          return lastCompletion.ok ? lastCompletion.token : null
        }
        if (activeId && activeId !== id) {
          const result = await waitFor(activeId)
          return result?.ok ? result.token : null
        }
        activeId = id
        bus.postMessage({ type: 'refresh-start', id })
        return perform(operation, id, requestedAt, bus)
      }

      // Web Locks alone cannot share the access token. Require durable metadata
      // to detect a predecessor; if storage is unavailable, do not send a request.
      const store = getStorage()
      if (!store) return null
      const marker = readMarker()
      if (marker && marker.at >= requestedAt) return null
      try { store.setItem(STORAGE_KEY, JSON.stringify({ id, at: requestedAt, pending: true })) } catch { storageApi = null; return null }
      return perform(operation, id, requestedAt, null)
    })
  }

  async function withoutWebLock(operation, id, requestedAt, bus) {
    if (!bus) return null
    if (lastCompletion && now() - lastCompletion.at <= RESULT_CACHE_MS) {
      return lastCompletion.ok ? lastCompletion.token : null
    }
    if (activeId && activeId !== id) {
      const result = await waitFor(activeId)
      return result?.ok ? result.token : null
    }

    requests.set(id, requestedAt)
    bus.postMessage({ type: 'refresh-request', id, at: requestedAt })
    await wait(ELECTION_WINDOW_MS)
    if (activeId && activeId !== id) {
      const result = await waitFor(activeId)
      return result?.ok ? result.token : null
    }

    const cutoff = requestedAt - ELECTION_WINDOW_MS
    for (const [requestId, at] of requests) if (at < cutoff) requests.delete(requestId)
    bus.postMessage({ type: 'refresh-vote', at: requestedAt, ids: [...requests.keys()] })
    await wait(ELECTION_WINDOW_MS)
    const candidates = [...requests.entries()].filter(([, at]) => at >= cutoff).map(([requestId]) => requestId)
    const winner = [...new Set([...candidates, id])].sort()[0]
    if (winner !== id) {
      const result = await waitFor(winner)
      return result?.ok ? result.token : null
    }

    activeId = id
    bus.postMessage({ type: 'refresh-start', id })
    return perform(operation, id, requestedAt, bus)
  }

  // Subscribe when the app initializes so tabs that later refresh together have
  // already joined the shared channel before any one of them starts a request.
  initializeChannel()

  return function coordinateRefresh(operation) {
    if (inFlight) return inFlight
    prune()
    const bus = initializeChannel()
    const id = idFactory()
    const requestedAt = now()
    if (bus) {
      requests.set(id, requestedAt)
      bus.postMessage({ type: 'refresh-request', id, at: requestedAt })
    }
    const task = locks?.request
      ? withWebLock(operation, id, requestedAt, bus)
      : withoutWebLock(operation, id, requestedAt, bus)
    inFlight = Promise.resolve(task).finally(() => { inFlight = null })
    return inFlight
  }
}
