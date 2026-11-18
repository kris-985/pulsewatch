import * as defaultRepository from './monitor.repository.js'
import {
  createMonitorSchema,
  listMonitorsQuerySchema,
  monitorIdParamsSchema,
  updateMonitorSchema,
} from './monitor.schemas.js'
import { MonitorUrlPolicyError, normalizeAndValidateMonitorUrl } from './monitor.url-policy.js'
import { badRequest, HttpError } from '../../shared/http-error.js'

const NOT_FOUND = () => new HttpError(404, 'MONITOR_NOT_FOUND', 'Monitor not found')

function parse(schema, value, message) {
  const result = schema.safeParse(value)
  if (!result.success) throw badRequest(message)
  return result.data
}

async function normalizeUrl(url, urlPolicy) {
  try {
    return await urlPolicy(url)
  } catch (error) {
    if (error instanceof MonitorUrlPolicyError || error?.code === 'MONITOR_URL_NOT_ALLOWED') {
      throw new HttpError(400, 'MONITOR_URL_NOT_ALLOWED', error.message)
    }
    throw error
  }
}

export class MonitorService {
  constructor({ repository = defaultRepository, urlPolicy = normalizeAndValidateMonitorUrl } = {}) {
    this.repository = repository
    this.urlPolicy = urlPolicy
  }

  async create(workspaceId, input) {
    const data = parse(createMonitorSchema, input, 'Monitor data is invalid')
    data.url = await normalizeUrl(data.url, this.urlPolicy)
    return this.repository.createMonitor(workspaceId, data)
  }

  async getById(workspaceId, monitorId) {
    const params = parse(monitorIdParamsSchema, { monitorId }, 'Monitor ID is invalid')
    const monitor = await this.repository.findMonitorById(workspaceId, params.monitorId)
    if (!monitor) throw NOT_FOUND()
    return monitor
  }

  async list(workspaceId, query = {}) {
    const options = parse(listMonitorsQuerySchema, query, 'Monitor query is invalid')
    return this.repository.findMonitorsByWorkspace(workspaceId, options)
  }

  async update(workspaceId, monitorId, input) {
    const params = parse(monitorIdParamsSchema, { monitorId }, 'Monitor ID is invalid')
    const updates = parse(updateMonitorSchema, input, 'Monitor update is invalid')
    if (updates.url !== undefined) updates.url = await normalizeUrl(updates.url, this.urlPolicy)
    const monitor = await this.repository.updateMonitor(workspaceId, params.monitorId, updates)
    if (!monitor) throw NOT_FOUND()
    return monitor
  }

  async delete(workspaceId, monitorId) {
    const params = parse(monitorIdParamsSchema, { monitorId }, 'Monitor ID is invalid')
    const monitor = await this.repository.softDeleteMonitor(workspaceId, params.monitorId)
    if (!monitor) throw NOT_FOUND()
    return monitor
  }
}

export const monitorService = new MonitorService()
