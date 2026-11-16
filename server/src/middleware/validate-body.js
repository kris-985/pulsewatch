import { badRequest } from '../shared/http-error.js'

export function validateBody(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body)
    if (!result.success) {
      return next(badRequest('Request body is invalid'))
    }
    req.validatedBody = result.data
    return next()
  }
}
