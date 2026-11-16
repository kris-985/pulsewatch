import { unauthorized } from '../../shared/http-error.js'
import { findWorkspaceByOwner } from './workspace.repository.js'

export class WorkspaceService {
  constructor({ repository = { findWorkspaceByOwner } } = {}) {
    this.repository = repository
  }

  async getCurrent(userId) {
    const workspace = await this.repository.findWorkspaceByOwner(userId)
    if (!workspace) throw unauthorized('Workspace is unavailable')
    return {
      id: String(workspace._id ?? workspace.id),
      name: workspace.name,
      planCode: workspace.planCode,
    }
  }
}

export const workspaceService = new WorkspaceService()
