import { describe, expect, it } from 'vitest'
import { parseRecoveryInput } from './recoveryLink'

describe('parseRecoveryInput', () => {
  it('reads the token hash from the email verify link', () => {
    const link =
      'https://abc.supabase.co/auth/v1/verify?token=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15&type=recovery&redirect_to=https://x.github.io/app/reset-password'
    expect(parseRecoveryInput(link)).toEqual({ kind: 'token_hash', tokenHash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15' })
  })

  it('reads a session from the page the link redirected to, even localhost', () => {
    const link = 'http://localhost:3000/#access_token=aaa.bbb.ccc&expires_in=3600&refresh_token=r3fr&token_type=bearer&type=recovery'
    expect(parseRecoveryInput(`  ${link}\n`)).toEqual({ kind: 'session', accessToken: 'aaa.bbb.ccc', refreshToken: 'r3fr' })
  })

  it('accepts token_hash links and numeric codes', () => {
    expect(parseRecoveryInput('https://x.dev/reset?token_hash=abc123&type=recovery')).toEqual({ kind: 'token_hash', tokenHash: 'abc123' })
    expect(parseRecoveryInput('123456')).toEqual({ kind: 'code', code: '123456' })
  })

  it('explains expired links and rejects other link types', () => {
    expect(parseRecoveryInput('http://localhost:3000/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')).toMatchObject({
      kind: 'error',
      message: expect.stringMatching(/expired/),
    })
    expect(parseRecoveryInput('https://abc.supabase.co/auth/v1/verify?token=x&type=signup')).toMatchObject({ kind: 'error' })
  })

  it('returns null for junk', () => {
    expect(parseRecoveryInput('')).toBeNull()
    expect(parseRecoveryInput('hello there')).toBeNull()
    expect(parseRecoveryInput('https://example.com/nothing')).toBeNull()
  })
})
