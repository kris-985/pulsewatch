import { workspaceService } from './workspace.service.js'

export function createWorkspaceController(service = workspaceService) {
  return {
    async getCurrent(req, res) {
      res.status(200).json({ workspace: await service.getCurrent(req.auth.userId) })
    },
  }
}
