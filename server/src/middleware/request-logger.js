import { randomUUID } from 'node:crypto'
import { logger } from '../config/logger.js'

export function requestLogger(req, res, next) {
  const startedAt = Date.now()
  req.requestId = randomUUID()
  res.setHeader('X-Request-Id', req.requestId)
  res.on('finish', () => {
    logger.info('HTTP request', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    })
  })
  next()
}
