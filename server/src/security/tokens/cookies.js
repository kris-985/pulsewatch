export const REFRESH_COOKIE = 'pw_refresh'
export const CSRF_COOKIE = 'pw_csrf'
export const AUTH_COOKIE_PATH = '/api/v1/auth'

export function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=')
    if (separator < 0) return ['', '']
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    try {
      return [name, decodeURIComponent(value)]
    } catch {
      return [name, '']
    }
  }).filter(([name]) => name))
}
