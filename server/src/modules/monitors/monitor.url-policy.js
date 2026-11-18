import { promises as dns } from 'node:dns'
import ipaddr from 'ipaddr.js'

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const ALLOWED_PORTS = new Set(['80', '443'])
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal']
const RESERVED_TLDS = new Set(['arpa', 'example', 'home', 'invalid', 'onion', 'test'])

export class MonitorUrlPolicyError extends Error {
  constructor() {
    super('Monitor URL is invalid or targets a non-public host')
    this.name = 'MonitorUrlPolicyError'
    this.code = 'MONITOR_URL_NOT_ALLOWED'
  }
}

function rejectUrl() {
  throw new MonitorUrlPolicyError()
}

function isLocalHostname(hostname) {
  if (!hostname || !hostname.includes('.')) return true
  if (LOCAL_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))) return true
  if (hostname === 'home.arpa' || hostname.endsWith('.home.arpa')) return true
  const tld = hostname.slice(hostname.lastIndexOf('.') + 1)
  return RESERVED_TLDS.has(tld)
}

export function isPublicIpAddress(address) {
  if (typeof address !== 'string' || address.includes('%') || !ipaddr.isValid(address)) return false

  let parsed = ipaddr.parse(address)
  if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address()
  }

  // ipaddr.js labels loopback, private, link-local, multicast, reserved,
  // unspecified, carrier-grade NAT and other special-use ranges separately.
  return parsed.range() === 'unicast'
}

function addressesFromAnswer(answer) {
  if (!Array.isArray(answer)) return []
  return answer.map((record) => typeof record === 'string' ? record : record?.address)
}

async function resolveAllAddresses(hostname, resolve4, resolve6) {
  const results = await Promise.allSettled([resolve4(hostname), resolve6(hostname)])
  const addresses = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      addresses.push(...addressesFromAnswer(result.value))
      continue
    }

    // A host may legitimately publish only A or only AAAA records.
    // Other resolver failures (including NXDOMAIN and temporary DNS errors) fail closed.
    if (result.reason?.code !== 'ENODATA') rejectUrl()
  }

  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) rejectUrl()
  return addresses
}

export async function normalizeAndValidateMonitorUrl(input, {
  resolve4 = dns.resolve4,
  resolve6 = dns.resolve6,
} = {}) {
  if (typeof input !== 'string') rejectUrl()
  const rawUrl = input.trim()
  if (rawUrl.length === 0 || rawUrl.length > 2_048) rejectUrl()

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    rejectUrl()
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) rejectUrl()

  const authority = rawUrl.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1]
  if (!authority || authority.includes('@') || url.username || url.password) rejectUrl()
  if (url.port && !ALLOWED_PORTS.has(url.port)) rejectUrl()

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (ipaddr.isValid(hostname)) {
    if (!isPublicIpAddress(hostname)) rejectUrl()
  } else {
    if (!hostname || isLocalHostname(hostname)) rejectUrl()
    await resolveAllAddresses(hostname, resolve4, resolve6)
  }

  // URL fragments are client-side only and are not sent in an HTTP request.
  url.hash = ''
  return url.toString()
}
