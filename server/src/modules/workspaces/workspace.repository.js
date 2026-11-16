import { Workspace } from './workspace.model.js'

export const findWorkspaceByOwner = (ownerId) => Workspace.findOne({ ownerId })

export async function createWorkspace(data, session) {
  const [workspace] = await Workspace.create([data], { session })
  return workspace
}
