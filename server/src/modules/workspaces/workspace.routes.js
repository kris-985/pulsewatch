import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { asyncHandler } from '../../shared/async-handler.js'
import { createWorkspaceController } from './workspace.controller.js'

export function createWorkspaceRouter({ service } = {}) {
  const router = Router()
  const controller = createWorkspaceController(service)
  router.get('/current', authenticate, asyncHandler(controller.getCurrent))
  return router
}
