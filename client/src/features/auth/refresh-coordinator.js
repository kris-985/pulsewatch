const LOCK_NAME = 'pulsewatch-auth-refresh-v1'
const CHANNEL_NAME = 'pulsewatch-auth-refresh-v1'
const ELECTION_WINDOW_MS = 60
const RESULT_WAIT_MS = 2_000
const RESULT_TTL_MS = 10_000

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/**
 * Coordinates rotating-cookie refreshes between same-origin tabs. A result is
 * retained only for request IDs explicitly included in that operation's group.
 * Tokens are never persisted; BroadcastChannel carries access tokens in memory.
 */
export function createRefreshCoordinator({
  locks = typeof navigator === 'undefined' ? null : navigator.locks,
  createChannel = typeof BroadcastChannel === 'undefined' ? null : (name) => new BroadcastChannel(name),
  now = Date.now,
  wait = delay,
  resultWaitMs = RESULT_WAIT_MS,
  idFactory = () => crypto.randomUUID(),
} = {}) {
  let inFlight = null
  let channel = null
  let activeGroup = null
  const requests = new Map()
  const completed = new Map()
  const waiters = new Map()
  const votes = new Map()

  function prune() {
    const cutoff = now() - RESULT_TTL_MS
    for (const [id, request] of requests) if (request.at < cutoff) requests.delete(id)
    for (const [id, result] of completed) {
      if (result.completedAt < cutoff) {
        clearTimeout(result.timer)
        completed.delete(id)
      }
    }
    for (const [id, vote] of votes) if (vote.at < cutoff) votes.delete(id)
  }

  function resolveWaiters(message, skipRequestId = null) {
    for (const requestId of message.requestIds) {
      requests.delete(requestId)
      votes.delete(requestId)
      if (requestId === skipRequestId && !waiters.has(requestId)) continue
      const result = { ok: message.ok === true, token: typeof message.token === 'string' ? message.token : null, completedAt: now() }
      const callbacks = waiters.get(requestId)
      if (callbacks) {
        for (const callback of [...callbacks]) callback(result)
        waiters.delete(requestId)
      } else {
        result.timer = setTimeout(() => {
          if (completed.get(requestId) === result) completed.delete(requestId)
        }, RESULT_TTL_MS)
        result.timer?.unref?.()
        completed.set(requestId, result)
      }
    }
    prune()
  }

  function addGroupMember(requestId) {
    if (activeGroup && requestId !== activeGroup.operationId) activeGroup.requestIds.add(requestId)
  }

  function initializeChannel() {
    try {
      channel = createChannel?.(CHANNEL_NAME) ?? null
      channel?.addEventListener('message', ({ data }) => {
        if (!data || typeof data !== 'object' || typeof data.type !== 'string') return
        if (data.type === 'refresh-request') {
          if (typeof data.id !== 'string' || data.id.length > 128 || !Number.isFinite(data.at)) return
          requests.set(data.id, { at: data.at })
          addGroupMember(data.id)
          prune()
        } else if (data.type === 'refresh-start') {
          if (typeof data.operationId !== 'string' || !Array.isArray(data.requestIds)) return
          activeGroup = { operationId: data.operationId, requestIds: new Set(data.requestIds.filter((id) => typeof id === 'string')) }
        } else if (data.type === 'refresh-complete') {
          if (typeof data.operationId !== 'string' || !Array.isArray(data.requestIds)) return
          const requestIds = data.requestIds.filter((id) => typeof id === 'string' && id.length <= 128)
          if (!requestIds.length) return
          resolveWaiters({ ...data, requestIds })
          if (activeGroup?.operationId === data.operationId) activeGroup = null
        } else if (data.type === 'refresh-vote') {
          if (typeof data.voterId !== 'string' || data.voterId.length > 128 || !Array.isArray(data.requestIds)) return
          const at = Number(data.at)
          if (!Number.isFinite(at)) return
          const requestIds = data.requestIds.filter((id) => typeof id === 'string' && id.length <= 128).sort()
          votes.set(data.voterId, { at, requestIds })
        }
      })
    } catch {
      channel = null
    }
  }

  function waitFor(requestId) {
    const prior = completed.get(requestId)
    if (prior) {
      clearTimeout(prior.timer)
      completed.delete(requestId)
      return Promise.resolve(prior)
    }
    return new Promise((resolve) => {
      let callbacks = waiters.get(requestId)
      if (!callbacks) {
        callbacks = new Set()
        waiters.set(requestId, callbacks)
      }
      const finish = (result) => {
        clearTimeout(timer)
        callbacks.delete(finish)
        if (callbacks.size === 0) waiters.delete(requestId)
        resolve(result)
      }
      callbacks.add(finish)
      const timer = setTimeout(() => finish(null), resultWaitMs)
    })
  }

  function eligibleRequests(requestId, requestedAt) {
    const minimumTime = requestedAt - ELECTION_WINDOW_MS
    for (const [id, request] of requests) if (request.at < minimumTime) requests.delete(id)
    return [...new Set([requestId, ...[...requests.entries()]
      .filter(([, request]) => request.at >= minimumTime && request.at <= requestedAt + ELECTION_WINDOW_MS)
      .map(([id]) => id)])].sort()
  }

  async function perform(operation, operationId, requestIds) {
    let token = null
    let ok = false
    try {
      token = await operation()
      ok = typeof token === 'string' && token.length > 0
      return ok ? token : null
    } catch {
      // A lost response can follow a committed rotation. Never retry it here.
      return null
    } finally {
      const group = activeGroup?.operationId === operationId
        ? [...activeGroup.requestIds]
        : [...requestIds]
      const completedMessage = { type: 'refresh-complete', operationId, requestIds: group, ok, token: ok ? token : null }
      resolveWaiters(completedMessage, operationId)
      channel?.postMessage(completedMessage)
      activeGroup = null
    }
  }

  async function withWebLock(operation, operationId, requestedAt) {
    return locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        // A busy lock means another tab owns this attempt. Without a channel,
        // fail closed. With one, wait only for this request's group result.
        return channel ? (await waitFor(operationId))?.token ?? null : null
      }

      await wait(ELECTION_WINDOW_MS)
      const priorResult = completed.get(operationId)
      if (priorResult) return priorResult.ok ? priorResult.token : null
      const requestIds = eligibleRequests(operationId, requestedAt)
      activeGroup = { operationId, requestIds: new Set(requestIds) }
      channel?.postMessage({ type: 'refresh-start', operationId, requestIds })
      return perform(operation, operationId, requestIds)
    })
  }

  async function withoutWebLock(operation, operationId, requestedAt) {
    // BroadcastChannel cannot atomically claim a lock. Require every candidate
    // in the observed group to publish the same membership view before electing.
    if (!channel) return null
    await wait(ELECTION_WINDOW_MS)
    const priorResult = completed.get(operationId)
    if (priorResult) return priorResult.ok ? priorResult.token : null
    if (activeGroup && activeGroup.operationId !== operationId) {
      return (await waitFor(operationId))?.token ?? null
    }

    const requestIds = eligibleRequests(operationId, requestedAt)
    votes.set(operationId, { at: requestedAt, requestIds })
    channel.postMessage({ type: 'refresh-vote', voterId: operationId, at: requestedAt, requestIds })
    await wait(ELECTION_WINDOW_MS)
    const afterElectionResult = completed.get(operationId)
    if (afterElectionResult) return afterElectionResult.ok ? afterElectionResult.token : null
    if (activeGroup && activeGroup.operationId !== operationId) return (await waitFor(operationId))?.token ?? null
    const candidates = eligibleRequests(operationId, requestedAt)
    const candidateSet = new Set(candidates)
    const candidateVotes = candidates.map((candidate) => votes.get(candidate))
    if (candidateVotes.some((vote) => !vote || Math.abs(vote.at - requestedAt) > ELECTION_WINDOW_MS)) return null
    if (candidateVotes.some((vote) => vote.requestIds.length !== candidateSet.size || vote.requestIds.some((id) => !candidateSet.has(id)))) return null
    const leaderId = candidates[0]
    if (leaderId !== operationId) return (await waitFor(operationId))?.token ?? null

    activeGroup = { operationId, requestIds: new Set(candidates) }
    channel.postMessage({ type: 'refresh-start', operationId, requestIds: candidates })
    return perform(operation, operationId, candidates)
  }

  // Subscribe during application initialization so tabs already share a channel
  // before a concurrent 401 group begins.
  initializeChannel()

  return function coordinateRefresh(operation) {
    if (inFlight) return inFlight
    prune()
    const operationId = idFactory()
    const requestedAt = now()
    requests.set(operationId, { at: requestedAt })
    channel?.postMessage({ type: 'refresh-request', id: operationId, at: requestedAt })

    const task = locks?.request
      ? withWebLock(operation, operationId, requestedAt)
      : withoutWebLock(operation, operationId, requestedAt)
    inFlight = Promise.resolve(task).finally(() => { inFlight = null })
    return inFlight
  }
}
