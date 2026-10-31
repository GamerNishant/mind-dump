import { expect, test, type Page } from '@playwright/test'

/*
 * Compass: "What should I do right now?" and "Find your fire" through to a running 14-day Spark
 * experiment with a check-in. Device-only mode; every test signs up a fresh local user.
 */

test.describe.configure({ timeout: 120_000 })

const PASSWORD = 'correct-horse-1'
let counter = 0

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('minddump:landed', '1')
    } catch {
      // ignore
    }
  })
})

async function signUp(page: Page) {
  await page.goto('/signup')
  await page.getByLabel('Name').fill('Test User')
  await page.getByLabel('Email').fill(`compass${Date.now()}${counter++}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible()
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

async function openCompass(page: Page) {
  await nav(page).getByRole('link', { name: 'Compass' }).click()
  await expect(page.getByRole('heading', { name: 'Compass', level: 1 })).toBeVisible()
}

async function noHorizontalOverflow(page: Page) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(extra).toBeLessThanOrEqual(0)
}

/** Answer three prompts, skip the rest, name two options, score, duel, and commit via the coin test. */
async function findFire(page: Page, shot?: (name: string) => Promise<unknown>) {
  await page.getByRole('button', { name: /Find your fire/ }).click()
  await shot?.('intro')
  await page.getByRole('button', { name: 'Begin' }).click()
  const answer = page.getByRole('textbox', { name: 'Your answer' })
  await answer.fill('Editing videos, explaining history to friends')
  await shot?.('prompt')
  await page.getByRole('button', { name: 'Next' }).click()
  await answer.fill('People who teach online and get listened to')
  await page.getByRole('button', { name: 'Next' }).click()
  await answer.fill('Drawing maps')
  await page.getByRole('button', { name: 'Next' }).click()
  for (let i = 3; i < 8; i++) await page.getByRole('button', { name: 'Skip' }).click()

  await expect(page.getByRole('heading', { name: /Name 2–6 things/ })).toBeVisible()
  await page.getByRole('button', { name: '+ Editing videos' }).click()
  await page.getByRole('textbox', { name: 'New option' }).fill('Teach polity online')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Your options' }).getByRole('listitem')).toHaveCount(2)
  await shot?.('options')
  await page.getByRole('button', { name: 'Score them' }).click()

  for (const [title, n] of [['Editing videos', '5'], ['Teach polity online', '3']] as const) {
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    for (const dim of ['Pull', 'Curiosity', 'Regret', 'Meaning', 'Fit']) {
      await page.getByRole('group', { name: dim }).getByRole('button', { name: n, exact: true }).click()
    }
    if (title === 'Editing videos') await shot?.('score')
    await page.getByRole('button', { name: 'Next' }).click()
  }

  await expect(page.getByRole('heading', { name: /only do one/ })).toBeVisible()
  await shot?.('duel')
  await page.getByRole('button', { name: 'Editing videos' }).click()
  await expect(page.getByRole('heading', { name: '“Editing videos” comes out on top.' })).toBeVisible()
  await shot?.('ranking')
  await page.getByRole('button', { name: 'Coin test' }).click()
  await page.getByRole('button', { name: 'Flip the coin' }).click()
  await expect(page.getByRole('heading', { name: /The coin says/ })).toBeVisible({ timeout: 5000 })
  await shot?.('coin')
  // Whatever it landed on, "Relief" commits to the coin's pick, "oh no" to the other.
  const landed = (await page.getByRole('heading', { name: /The coin says/ }).textContent())!.replace('The coin says: ', '')
  if (landed === 'Editing videos') await page.getByRole('button', { name: /Relief/ }).click()
  else await page.getByRole('button', { name: /oh no/ }).click()

  await expect(page.getByRole('textbox', { name: 'What you’ll do' })).toHaveValue('Editing videos')
  await page.getByRole('textbox', { name: /Why it matters/ }).fill('I come alive when I explain things')
  await page.getByRole('textbox', { name: /this will exist/ }).fill('3 short history videos')
  await page.getByRole('textbox', { name: 'First physical action' }).fill('Open a doc and write the hook for video 1')
  await page.getByRole('textbox', { name: /When: after I/ }).fill('finish breakfast')
  await shot?.('commit')
  await page.getByRole('button', { name: 'Start the 14 days' }).click()
  await expect(page.getByRole('heading', { name: 'Editing videos', level: 2 })).toBeVisible()
}

test('Right now with nothing set up points to finding a direction', async ({ page }) => {
  await signUp(page)
  await openCompass(page)
  await page.getByRole('button', { name: /What should I do right now/ }).click()
  await page.getByRole('group', { name: 'Energy', exact: true }).getByRole('button', { name: 'Okay' }).click()
  await page.getByRole('group', { name: 'Time free' }).getByRole('button', { name: '1 hour' }).click()
  await page.getByRole('button', { name: 'Tell me' }).click()
  await expect(page.getByRole('heading', { name: 'Find your fire' })).toBeVisible()
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Fire isn’t found by thinking/ })).toBeVisible()
})

test('Right now: a blocker gets a reset first, then the next thing', async ({ page }) => {
  await signUp(page)
  await openCompass(page)
  await page.getByRole('button', { name: /What should I do right now/ }).click()
  await page.getByRole('button', { name: 'Hungry' }).click()
  await page.getByRole('group', { name: 'Energy', exact: true }).getByRole('button', { name: 'Low' }).click()
  await page.getByRole('group', { name: 'Time free' }).getByRole('button', { name: '15 min' }).click()
  await page.getByRole('button', { name: 'Tell me' }).click()
  await expect(page.getByRole('heading', { name: 'Eat something real' })).toBeVisible()
  await page.getByRole('button', { name: /Already fine/ }).click()
  await expect(page.getByRole('heading', { name: 'Find your fire' })).toBeVisible()
})

test('Find your fire → 14-day Spark: block in Today, check-in, right-now picks the fire', async ({ page }) => {
  await signUp(page)
  await openCompass(page)
  await findFire(page)

  await expect(page.getByText('Your fire · day 1 of 14')).toBeVisible()
  await expect(page.getByRole('meter', { name: 'Fire meter' })).toHaveAttribute('aria-valuenow', '0')

  // Right now (medium energy) picks the fire and starts its block after the countdown.
  await page.getByRole('button', { name: /What should I do right now/ }).click()
  await page.getByRole('group', { name: 'Energy', exact: true }).getByRole('button', { name: 'Okay' }).click()
  await page.getByRole('group', { name: 'Time free' }).getByRole('button', { name: '1 hour' }).click()
  await page.getByRole('button', { name: 'Tell me' }).click()
  await expect(page.getByRole('heading', { name: 'Editing videos' }).first()).toBeVisible()
  await expect(page.getByText('Open a doc and write the hook for video 1')).toBeVisible()
  await page.getByRole('button', { name: 'Start in 5' }).click()
  await expect(page).toHaveURL(/\/focus$/, { timeout: 10_000 })

  // The block is in Today.
  await page.goto('/today')
  await expect(page.getByText('Editing videos').first()).toBeVisible()

  // Check in.
  await openCompass(page)
  await page.getByRole('group', { name: 'Energy after the session' }).getByRole('button', { name: /Alive/ }).click()
  await page.getByRole('group', { name: 'Did time fly?' }).getByRole('button', { name: 'Yes' }).click()
  await page.getByRole('button', { name: 'Log the spark' }).click()
  await expect(page.getByText(/Today’s spark logged/)).toBeVisible()
  await expect(page.getByRole('meter', { name: 'Fire meter' })).toHaveAttribute('aria-valuenow', '100')

  // Survives a reload.
  await page.reload()
  await expect(page.getByText(/Today’s spark logged/)).toBeVisible()

  // Early review shows a verdict without ending anything.
  await page.getByRole('button', { name: 'Review early' }).click()
  await expect(page.getByText('Early read')).toBeVisible()
  await page.getByRole('button', { name: 'Keep going' }).click()
  await expect(page.getByText('Early read')).toBeHidden()
})

for (const theme of ['light', 'dark'] as const) {
  test(`compass visual tour (${theme})`, async ({ page }, info) => {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('minddump:theme', t)
      } catch {
        // ignore
      }
    }, theme)
    const shot = (name: string) => page.screenshot({ path: `test-results/compass-shots/${info.project.name}-${name}-${theme}.png`, fullPage: true })
    await signUp(page)
    await openCompass(page)
    await noHorizontalOverflow(page)
    await shot('home')
    await findFire(page, async (name) => {
      await noHorizontalOverflow(page)
      await shot(name)
    })
    await page.waitForTimeout(400)
    await noHorizontalOverflow(page)
    await shot('fire')
    await page.getByRole('button', { name: /What should I do right now/ }).click()
    await page.getByRole('group', { name: 'Energy', exact: true }).getByRole('button', { name: 'High' }).click()
    await page.getByRole('group', { name: 'Time free' }).getByRole('button', { name: '2+ hours' }).click()
    await shot('now-ask')
    await page.getByRole('button', { name: 'Tell me' }).click()
    await page.waitForTimeout(400)
    await noHorizontalOverflow(page)
    await shot('now-answer')
  })
}
