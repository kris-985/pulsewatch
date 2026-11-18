import { jest } from '@jest/globals'
import {
  isPublicIpAddress,
  MonitorUrlPolicyError,
  normalizeAndValidateMonitorUrl,
} from '../src/modules/monitors/monitor.url-policy.js'

function resolver({ ipv4 = ['93.184.216.34'], ipv6 = [], ipv4Error, ipv6Error } = {}) {
  return {
    resolve4: async () => {
      if (ipv4Error) throw Object.assign(new Error('DNS resolver failed'), { code: ipv4Error })
      return ipv4
    },
    resolve6: async () => {
      if (ipv6Error) throw Object.assign(new Error('DNS resolver failed'), { code: ipv6Error })
      return ipv6
    },
  }
}

describe('Monitor URL policy', () => {
  it.each([
    ['http://status.example.com/health', 'http://status.example.com/health'],
    ['https://status.example.com', 'https://status.example.com/'],
    ['http://status.example.com:80/health', 'http://status.example.com/health'],
    ['https://status.example.com:443/health', 'https://status.example.com/health'],
  ])('normalizes and accepts public HTTP(S) URLs', async (input, expected) => {
    await expect(normalizeAndValidateMonitorUrl(input, resolver())).resolves.toBe(expected)
  })

  it('trims surrounding whitespace while normalizing the URL', async () => {
    await expect(normalizeAndValidateMonitorUrl('  https://status.example.com  ', resolver()))
      .resolves.toBe('https://status.example.com/')
  })

  it.each([
    'not a URL',
    '/health',
    'ftp://status.example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ])('rejects invalid URL or protocol %s', async (input) => {
    await expect(normalizeAndValidateMonitorUrl(input, resolver())).rejects.toBeInstanceOf(MonitorUrlPolicyError)
  })

  it.each(['8080', '3000', '65535'])('rejects non-approved port %s', async (port) => {
    await expect(normalizeAndValidateMonitorUrl(`https://status.example.com:${port}`, resolver())).rejects.toMatchObject({ code: 'MONITOR_URL_NOT_ALLOWED' })
  })

  it.each([
    'http://user:password@status.example.com',
    'http://@status.example.com',
    'https://user%40name@status.example.com',
  ])('rejects URL userinfo', async (input) => {
    await expect(normalizeAndValidateMonitorUrl(input, resolver())).rejects.toBeInstanceOf(MonitorUrlPolicyError)
  })

  it.each([
    'http://localhost',
    'http://api.localhost',
    'http://printer.local',
    'http://metadata.internal',
    'http://intranet',
    'http://router.home.arpa',
    'http://host.test',
  ])('rejects local or reserved hostname %s before DNS lookup', async (input) => {
    const resolve4 = async () => { throw new Error('Resolver should not be called') }
    await expect(normalizeAndValidateMonitorUrl(input, { resolve4, resolve6: resolve4 })).rejects.toBeInstanceOf(MonitorUrlPolicyError)
  })

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.51.100.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
  ])('classifies non-public IP %s as blocked', (address) => {
    expect(isPublicIpAddress(address)).toBe(false)
  })

  it.each(['8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('classifies public IP %s as public', (address) => {
    expect(isPublicIpAddress(address)).toBe(true)
  })

  it.each([
    'http://127.0.0.1',
    'http://127.1',
    'http://0177.0.0.1',
    'http://0x7f000001',
    'http://2130706433',
    'http://10.1.2.3',
    'http://[::1]',
    'https://[fc00::1]',
    'http://[::ffff:127.0.0.1]',
  ])('rejects non-public IP literal %s', async (input) => {
    await expect(normalizeAndValidateMonitorUrl(input)).rejects.toBeInstanceOf(MonitorUrlPolicyError)
  })

  it('accepts public IPv4 and IPv6 literals without DNS lookup', async () => {
    await expect(normalizeAndValidateMonitorUrl('http://8.8.8.8')).resolves.toBe('http://8.8.8.8/')
    await expect(normalizeAndValidateMonitorUrl('https://[2606:4700:4700::1111]')).resolves.toBe('https://[2606:4700:4700::1111]/')
  })

  it('queries both A and AAAA records and rejects the host if either answer is private', async () => {
    const resolve4 = jest.fn(async () => ['93.184.216.34'])
    const resolve6 = jest.fn(async () => ['fd00::1'])

    await expect(normalizeAndValidateMonitorUrl('https://status.example.com', { resolve4, resolve6 }))
      .rejects.toBeInstanceOf(MonitorUrlPolicyError)
    expect(resolve4).toHaveBeenCalledWith('status.example.com')
    expect(resolve6).toHaveBeenCalledWith('status.example.com')
  })

  it('fails closed on any DNS error other than a missing address family', async () => {
    await expect(normalizeAndValidateMonitorUrl('https://status.example.com', resolver({ ipv4Error: 'EAI_AGAIN' })))
      .rejects.toBeInstanceOf(MonitorUrlPolicyError)
    await expect(normalizeAndValidateMonitorUrl('https://status.example.com', resolver({ ipv4Error: 'ENOTFOUND' })))
      .rejects.toBeInstanceOf(MonitorUrlPolicyError)
  })

  it('accepts an IPv4-only or IPv6-only host when the other family returns ENODATA', async () => {
    await expect(normalizeAndValidateMonitorUrl('https://status.example.com', resolver({ ipv6Error: 'ENODATA' })))
      .resolves.toBe('https://status.example.com/')
    await expect(normalizeAndValidateMonitorUrl('https://status.example.com', resolver({ ipv4Error: 'ENODATA', ipv6: ['2606:4700:4700::1111'] })))
      .resolves.toBe('https://status.example.com/')
  })

  it('rejects DNS answers that contain no addresses or malformed records', async () => {
    await expect(normalizeAndValidateMonitorUrl('https://status.example.com', resolver({ ipv4Error: 'ENODATA', ipv6Error: 'ENODATA' })))
      .rejects.toBeInstanceOf(MonitorUrlPolicyError)
    await expect(normalizeAndValidateMonitorUrl('https://status.example.com', resolver({ ipv4: ['not-an-ip'] })))
      .rejects.toBeInstanceOf(MonitorUrlPolicyError)
  })
})
