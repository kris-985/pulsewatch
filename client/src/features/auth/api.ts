import { API_BASE_URL } from '../../lib/config'
import { createRefreshCoordinator, REFRESH_HTTP_TIMEOUT_MS } from './refresh-coordinator.js'

export interface AuthIdentity {
  id: string
  name: string
  email: string
}

export interface WorkspaceSummary {
  id: string
  name: string
  planCode: string
}

export interface AuthResult {
  accessToken: string
  accessTokenTtlSeconds: number
  user: AuthIdentity
  workspace: WorkspaceSummary | null
}

export interface MeResult {
  user: AuthIdentity
  workspace: WorkspaceSummary
}

let currentAccessToken: string | null = null
let refreshInFlight: Promise<string | null> | null = null
const coordinateRefresh = createRefreshCoordinator()

export function setAccessToken(token: string | null) {
  currentAccessToken = token
}

function readCsrfCookie() {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith('pw_csrf='))
  return entry ? decodeURIComponent(entry.slice('pw_csrf='.length)) : null
}

async function apiRequest<T>(path: string, options: RequestInit = {}, retryAfterRefresh = true): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (currentAccessToken) headers.set('Authorization', `Bearer ${currentAccessToken}`)
  const csrfToken = readCsrfCookie()
  if (csrfToken && ['POST', 'PATCH', 'PUT', 'DELETE'].includes((options.method ?? 'GET').toUpperCase())) {
    headers.set('X-CSRF-Token', csrfToken)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })
  const canRefresh = !['/auth/refresh', '/auth/login', '/auth/register', '/auth/logout'].includes(path)
  if (response.status === 401 && retryAfterRefresh && canRefresh) {
    const refreshedToken = await refreshSession()
    if (refreshedToken) return apiRequest<T>(path, options, false)
  }
  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? 'The request could not be completed')
  }
  return payload as T
}

export async function register(input: { name: string; email: string; password: string }) {
  const result = await apiRequest<AuthResult>('/auth/register', { method: 'POST', body: JSON.stringify(input) })
  setAccessToken(result.accessToken)
  return result
}

export async function login(input: { email: string; password: string }) {
  const result = await apiRequest<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify(input) })
  setAccessToken(result.accessToken)
  return result
}

export async function refreshSession() {
  if (!readCsrfCookie()) return null
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = coordinateRefresh(async () => {
    const result = await apiRequest<Pick<AuthResult, 'accessToken' | 'accessTokenTtlSeconds'>>('/auth/refresh', {
      method: 'POST',
      body: '{}',
      signal: AbortSignal.timeout(REFRESH_HTTP_TIMEOUT_MS),
    }, false)
    return result.accessToken
  }).then((accessToken) => {
    setAccessToken(accessToken)
    return accessToken
  }).catch(() => {
    setAccessToken(null)
    return null
  }).finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

export function getMe() {
  return apiRequest<MeResult>('/auth/me')
}

export async function logout() {
  try {
    await apiRequest<void>('/auth/logout', { method: 'POST', body: '{}' })
  } finally {
    setAccessToken(null)
  }
}
