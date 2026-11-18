import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { createMonitorController } from './monitor.controller.js'

export function createMonitorRouter({ service, workspaces, controller } = {}) {
  const router = Router()
  const handlers = controller ?? createMonitorController({ service, workspaces })

  router.use(authenticate)
  router.post('/', handlers.create)
  router.get('/', handlers.list)
  router.get('/:monitorId', handlers.getById)
  router.patch('/:monitorId', handlers.update)
  router.delete('/:monitorId', handlers.delete)

  return router
}
