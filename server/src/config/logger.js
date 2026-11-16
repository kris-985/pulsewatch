const sensitiveKeys = /authorization|cookie|password|secret|token|api[-_]?key/i

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKeys.test(key) ? '[REDACTED]' : sanitize(item)]))
}

export const logger = Object.freeze({
  info(message, context = {}) {
    console.info(JSON.stringify({ level: 'info', time: new Date().toISOString(), message, ...sanitize(context) }))
  },
  warn(message, context = {}) {
    console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), message, ...sanitize(context) }))
  },
  error(message, context = {}) {
    console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), message, ...sanitize(context) }))
  },
})
