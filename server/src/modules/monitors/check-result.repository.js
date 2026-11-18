import { CheckResult } from './check-result.model.js'

const RESULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

const createFields = [
  'workspaceId',
  'monitorId',
  'slotId',
  'slotSequence',
  'scheduledAt',
  'checkOutcome',
  'httpStatusCode',
  'responseTimeMs',
  'errorCode',
  'errorMessage',
  'checkedAt',
]

export async function createCheckResult(data, session) {
  const fields = Object.fromEntries(createFields
    .filter((field) => data[field] !== undefined)
    .map((field) => [field, data[field]]))
  const [result] = await CheckResult.create([{
    ...fields,
    status: 'pending',
    expiresAt: null,
  }], { session })
  return result
}

export function findCheckResultBySlot(monitorId, slotId, { session } = {}) {
  const query = CheckResult.findOne({ monitorId, slotId })
  if (session) query.session(session)
  return query
}

export function findPendingCheckResults(monitorId, { afterSequence = 0, limit = 100, session } = {}) {
  let query = CheckResult.find({
    monitorId,
    status: 'pending',
    slotSequence: { $gt: afterSequence },
  }).sort({ slotSequence: 1 }).limit(limit)
  if (session) query = query.session(session)
  return query
}

function markTerminal(monitorId, slotId, status, { session } = {}) {
  return CheckResult.findOneAndUpdate(
    { monitorId, slotId, status: 'pending' },
    {
      $set: {
        status,
        expiresAt: new Date(Date.now() + RESULT_RETENTION_MS),
      },
    },
    { new: true, runValidators: true, session },
  )
}

export function markCheckResultApplied(monitorId, slotId, options = {}) {
  return markTerminal(monitorId, slotId, 'applied', options)
}

export function markCheckResultSkipped(monitorId, slotId, options = {}) {
  return markTerminal(monitorId, slotId, 'skipped', options)
}
