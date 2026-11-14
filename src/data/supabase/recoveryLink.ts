/**
 * Parses whatever the user pastes to finish a password reset without relying on the email link's
 * redirect working. Accepts:
 *  - the link from the email (`…/auth/v1/verify?token=<hash>&type=recovery&redirect_to=…`)
 *  - the page it redirected to, even a broken one like `http://localhost:3000/#access_token=…`
 *  - a link carrying `token_hash=` (custom email templates)
 *  - the numeric code (`{{ .Token }}`) if the email template shows one
 */
export type RecoveryInput =
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }

export function parseRecoveryInput(raw: string): RecoveryInput | null {
  const text = raw.trim()
  if (!text) return null
  if (/^\d{6,10}$/.test(text)) return { kind: 'code', code: text }

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  const query = url.searchParams
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const get = (k: string) => hash.get(k) ?? query.get(k)

  const err = get('error_description') ?? get('error')
  if (err) {
    return { kind: 'error', message: /expired|invalid/i.test(err) ? 'This reset link has expired or was already used. Send a new one.' : err }
  }
  const type = get('type')
  if (type && type !== 'recovery') return { kind: 'error', message: "That isn't a password reset link." }

  const accessToken = get('access_token')
  const refreshToken = get('refresh_token')
  if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken }

  const tokenHash = get('token_hash') ?? get('token')
  if (tokenHash) return { kind: 'token_hash', tokenHash }
  return null
}
