import { expect, test } from '@playwright/test'

test('cloud: sign up, dump, clear, restore, sync, delete, sign out/in', async ({ page, context }) => {
  // Skip the before-noon landing on /today; this test starts on the board.
  await context.addInitScript(() => sessionStorage.setItem('minddump:landed', '1'))
  const email = `smoke-test-${Date.now()}@example.com`
  const password = 'smoke-test-password-1'
  const text = `Cloud smoke ${Date.now()}`

  await page.goto('signup')
  await expect(page.getByText('Device-only mode')).toHaveCount(0) // cloud backend active
  await page.getByLabel('Name').fill('Smoke Test')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible({ timeout: 20_000 })

  await page.getByLabel('New dump').fill(text)
  await page.getByRole('button', { name: 'Dump', exact: true }).click()
  const tile = page.getByRole('button', { name: `Mark done: ${text}`, exact: true })
  await expect(tile).toBeVisible()

  // Persisted server-side: visible from a second tab after load.
  const second = await context.newPage()
  await second.goto('./')
  await expect(second.getByRole('button', { name: `Mark done: ${text}`, exact: true })).toBeVisible({ timeout: 15_000 })
  await second.close()

  // Planner (planner_docs table): add the tile to Today, see it there after a reload.
  await page.getByRole('button', { name: `Add to Today: ${text}` }).click()
  await expect(page.getByText('Added to Today')).toBeVisible()
  await page.goto('today')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('one-time setup', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('list', { name: "Today's queue" }).getByText(text)).toBeVisible()
  await page.reload()
  await expect(page.getByRole('list', { name: "Today's queue" }).getByText(text)).toBeVisible({ timeout: 20_000 })
  await page.goto('./')
  await expect(tile).toBeVisible()

  await tile.click()
  await expect(tile).toHaveCount(0)
  await page.waitForTimeout(1500)
  await page.goto('./') // canonical /mind-dump/ (GitHub Pages redirects /mind-dump → /mind-dump/)
  await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible()
  await expect(tile).toHaveCount(0)

  await page.getByRole('link', { name: 'History' }).click()
  await page.getByRole('button', { name: `Restore: ${text}` }).click()
  await page.getByRole('link', { name: 'Back to board' }).click()
  await expect(tile).toBeVisible()

  // Deep link under the sub-path works after reload.
  await page.goto('history')
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible()
  await page.goto('./')

  // Clean up: delete the dump.
  await page.getByRole('button', { name: `Edit: ${text}` }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit dump' })
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete forever' }).click()
  await expect(page.getByText('Your mind is clear')).toBeVisible()

  await page.getByRole('button', { name: 'Account menu' }).click()
  await expect(page.getByText('Synced to the cloud')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Your mind is clear')).toBeVisible({ timeout: 20_000 })
})
