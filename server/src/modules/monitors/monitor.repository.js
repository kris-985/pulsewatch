import { Monitor } from './monitor.model.js'

const activeRecord = { deletedAt: null }

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
