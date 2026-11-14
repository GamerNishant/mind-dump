import { expect, test } from '@playwright/test'

const SUPABASE_URL = 'https://bvizicbwmwuorzjgnecq.supabase.co'
const KEY = 'sb_publishable_Q2AScSOlIV_AjKXKz0fOMQ_lYQqDW-r'

async function auth(path: string, body: object) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: res.ok, json: (await res.json()) as { access_token?: string; refresh_token?: string } }
}

// A real reset email can't be read here, so this simulates the commonest failure: the email link
// redirected to a page that doesn't load (localhost) with the session in its hash. Pasting that
// address must still let the user set a new password.
test('cloud: reset password by pasting the redirected link', async ({ page, context }) => {
  await context.addInitScript(() => sessionStorage.setItem('minddump:landed', '1'))
  const email = `smoke-test-reset-${Date.now()}@example.com`
  const oldPassword = 'smoke-test-password-1'
  const newPassword = 'smoke-test-password-2'

  const signup = await auth('signup', { email, password: oldPassword })
  expect(signup.ok).toBe(true)
  const { access_token, refresh_token } = signup.json
  const broken = `http://localhost:3000/#access_token=${access_token}&expires_in=3600&refresh_token=${refresh_token}&token_type=bearer&type=recovery`

  await page.goto('forgot-password')
  await page.getByRole('button', { name: 'I already have a reset email' }).click()
  await page.getByLabel('Link from the email').fill(broken)
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password').fill(newPassword)
  await page.getByRole('button', { name: 'Set new password' }).click()
  await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible({ timeout: 20_000 })

  expect((await auth('token?grant_type=password', { email, password: oldPassword })).ok).toBe(false)
  expect((await auth('token?grant_type=password', { email, password: newPassword })).ok).toBe(true)
})
