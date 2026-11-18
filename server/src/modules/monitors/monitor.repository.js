import { Monitor } from './monitor.model.js'

const activeRecord = { deletedAt: null }
const NORMAL_SCHEDULER_STATES = ['idle', 'enqueued']

function schedulerAvailableCondition() {
  return {
    $or: [
      { schedulerEnqueueState: { $in: NORMAL_SCHEDULER_STATES } },
      { schedulerEnqueueState: { $exists: false } },
    ],
  }
}

function expiredRecoveryLeaseCondition(now) {
  return {
    $or: [
      { schedulerRecoveryUntil: null },
      { schedulerRecoveryUntil: { $exists: false } },
      { schedulerRecoveryUntil: { $lte: now } },
    ],
  }
}

function expiredClaimCondition(now) {
  return {
    $or: [
      { schedulerClaimUntil: { $lte: now } },
      { schedulerClaimUntil: null },
      { schedulerClaimUntil: { $exists: false } },
    ],
  }
}

export function findDueMonitors({ now = new Date(), limit = 100, session } = {}) {
  let query = Monitor.find({
    status: 'active',
    ...activeRecord,
    nextCheckAt: { $lte: now },
    ...schedulerAvailableCondition(),
  }).sort({ nextCheckAt: 1, _id: 1 }).limit(limit)
  if (session) query = query.session(session)
  return query
}

export function claimNextCheckSlot(monitorId, {
  expectedNextCheckAt,
  expectedIntervalSeconds,
  now = new Date(),
  claimToken,
  claimUntil,
  session,
} = {}) {
  const intervalMs = expectedIntervalSeconds * 1_000
  const elapsedIntervals = Math.floor((now.getTime() - expectedNextCheckAt.getTime()) / intervalMs)
  const nextCheckAt = new Date(expectedNextCheckAt.getTime() + (elapsedIntervals + 1) * intervalMs)

  return Monitor.findOneAndUpdate({
    _id: monitorId,
    status: 'active',
    ...activeRecord,
    nextCheckAt: { $eq: expectedNextCheckAt, $lte: now },
    intervalSeconds: expectedIntervalSeconds,
    ...schedulerAvailableCondition(),
  }, {
    $set: {
      claimedSlotAt: expectedNextCheckAt,
      schedulerEnqueueState: 'pending',
      schedulerClaimToken: claimToken,
      schedulerClaimUntil: claimUntil,
      schedulerRecoveryToken: null,
      schedulerRecoveryUntil: null,
      nextCheckAt,
    },
    $inc: { slotSequence: 1 },
  }, { new: true, runValidators: true, session })
}

export function findExpiredSchedulerClaims({ now = new Date(), limit = 100, session } = {}) {
  let query = Monitor.find({
    schedulerEnqueueState: 'pending',
    $and: [expiredClaimCondition(now), expiredRecoveryLeaseCondition(now)],
  }).sort({ schedulerClaimUntil: 1, _id: 1 }).limit(limit)
  if (session) query = query.session(session)
  return query
}

export function claimExpiredSchedulerClaim(monitorId, {
  now = new Date(),
  recoveryToken,
  recoveryUntil,
  session,
} = {}) {
  return Monitor.findOneAndUpdate({
    _id: monitorId,
    schedulerEnqueueState: 'pending',
    $and: [expiredClaimCondition(now), expiredRecoveryLeaseCondition(now)],
  }, {
    $set: { schedulerRecoveryToken: recoveryToken, schedulerRecoveryUntil: recoveryUntil },
  }, { new: true, runValidators: true, session })
}

export function confirmSchedulerEnqueue(monitorId, claimToken, {
  recoveryToken,
  now = new Date(),
  session,
} = {}) {
  const ownerCondition = recoveryToken
    ? { schedulerRecoveryToken: recoveryToken, schedulerRecoveryUntil: { $gt: now } }
    : {
        schedulerClaimUntil: { $gt: now },
        $or: [
          { schedulerRecoveryToken: null },
          { schedulerRecoveryToken: { $exists: false } },
        ],
      }

  return Monitor.findOneAndUpdate({
    _id: monitorId,
    schedulerEnqueueState: 'pending',
    schedulerClaimToken: claimToken,
    ...ownerCondition,
  }, {
    $set: {
      schedulerEnqueueState: 'enqueued',
      schedulerClaimToken: null,
      schedulerClaimUntil: null,
      schedulerRecoveryToken: null,
      schedulerRecoveryUntil: null,
    },
  }, { new: true, runValidators: true, session })
}

export function releaseSchedulerClaim(monitorId, claimToken, {
  recoveryToken,
  now = new Date(),
  retryAt = now,
  session,
} = {}) {
  const ownerCondition = recoveryToken
    ? { schedulerRecoveryToken: recoveryToken, schedulerRecoveryUntil: { $gt: now } }
    : {
        schedulerClaimUntil: { $gt: now },
        $or: [
          { schedulerRecoveryToken: null },
          { schedulerRecoveryToken: { $exists: false } },
        ],
      }

  return Monitor.findOneAndUpdate({
    _id: monitorId,
    schedulerEnqueueState: 'pending',
    schedulerClaimToken: claimToken,
    ...ownerCondition,
  }, {
    $set: {
      schedulerClaimUntil: retryAt,
      ...(recoveryToken ? { schedulerRecoveryToken: null, schedulerRecoveryUntil: null } : {}),
    },
  }, { new: true, runValidators: true, session })
}

export async function createMonitor(workspaceId, data, session) {
  const [monitor] = await Monitor.create([{ ...data, workspaceId }], { session })
  return monitor
}

export function findMonitorById(workspaceId, monitorId, { session } = {}) {
  const query = Monitor.findOne({ _id: monitorId, workspaceId, ...activeRecord })
  if (session) query.session(session)
  return query
}

export function findMonitorsByWorkspace(workspaceId, { limit = 20, cursor, session } = {}) {
  const filter = { workspaceId, ...activeRecord }
  if (cursor) filter._id = { $lt: cursor }
  let query = Monitor.find(filter).sort({ _id: -1 }).limit(limit)
  if (session) query = query.session(session)
  return query
}

export function updateMonitor(workspaceId, monitorId, updates, { session } = {}) {
  const allowedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([field]) => ['name', 'url', 'intervalSeconds', 'status'].includes(field)),
  )
  const query = Monitor.findOneAndUpdate(
    { _id: monitorId, workspaceId, ...activeRecord },
    { $set: allowedUpdates },
    { new: true, runValidators: true, session },
  )
  return query
}

export function softDeleteMonitor(workspaceId, monitorId, { session } = {}) {
  return Monitor.findOneAndUpdate(
    { _id: monitorId, workspaceId, ...activeRecord },
    { $set: { deletedAt: new Date() } },
    { new: true, runValidators: true, session },
  )
}
