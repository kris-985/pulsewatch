export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export const badRequest = (message = 'Invalid request') => new HttpError(400, 'BAD_REQUEST', message)
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', message)
export const forbidden = (message = 'Request origin or CSRF token is invalid') => new HttpError(403, 'FORBIDDEN', message)
export const conflict = (code, message) => new HttpError(409, code, message)
export const serviceUnavailable = (message = 'A required service is unavailable') => new HttpError(503, 'SERVICE_UNAVAILABLE', message)
