import { monitorService } from './monitor.service.js'
import { workspaceService } from '../workspaces/workspace.service.js'
import { asyncHandler } from '../../shared/async-handler.js'

export function createMonitorController({ service = monitorService, workspaces = workspaceService } = {}) {
  async function getWorkspaceId(req) {
    const workspace = await workspaces.getCurrent(req.auth.userId)
    return workspace.id
  }

  return {
    create: asyncHandler(async (req, res) => {
      const workspaceId = await getWorkspaceId(req)
      const monitor = await service.create(workspaceId, req.validatedBody ?? req.body)
      res.status(201).json({ monitor })
    }),

    getById: asyncHandler(async (req, res) => {
      const workspaceId = await getWorkspaceId(req)
      const monitor = await service.getById(workspaceId, req.params.monitorId)
      res.status(200).json({ monitor })
    }),

    list: asyncHandler(async (req, res) => {
      const workspaceId = await getWorkspaceId(req)
      const monitors = await service.list(workspaceId, req.validatedQuery ?? req.query)
      res.status(200).json({ monitors })
    }),

    update: asyncHandler(async (req, res) => {
      const workspaceId = await getWorkspaceId(req)
      const monitor = await service.update(workspaceId, req.params.monitorId, req.validatedBody ?? req.body)
      res.status(200).json({ monitor })
    }),

    delete: asyncHandler(async (req, res) => {
      const workspaceId = await getWorkspaceId(req)
      await service.delete(workspaceId, req.params.monitorId)
      res.status(204).end()
    }),
  }
}
