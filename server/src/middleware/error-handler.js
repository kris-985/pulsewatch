import { logger } from '../config/logger.js'

export function errorHandler(error, req, res, _next) {
  logger.error('Request failed', {
    requestId: req.requestId,
    name: error.name,
  })

  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500
  const message = status >= 500 ? 'Internal server error' : error.message
  res.status(status).json({ error: { code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message, requestId: req.requestId } })
}
