import { expect, test, type Page } from '@playwright/test'

/*
 * End-to-end tests for habits, priority, named "Other" hours with the Week view, the daily quote
 * and the data backup. Device-only mode; every test signs up a fresh local user.
 */

// These flows are longer than app.spec's, and a full parallel run shares one dev server.
test.describe.configure({ timeout: 90_000 })

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

async function signUp(page: Page, name = 'Test User') {
  await page.goto('/signup')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(`features${Date.now()}${counter++}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible()
}

async function addDump(page: Page, text: string) {
  await page.getByLabel('New dump').fill(text)
  await page.getByRole('button', { name: 'Dump', exact: true }).click()
  await expect(page.getByLabel('New dump')).toHaveValue('')
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const tile = (page: Page, text: string) => page.getByRole('button', { name: `Mark done: ${text}`, exact: true })
const tileItem = (page: Page, text: string) => page.locator('ul[aria-label="Pending dumps"] > li').filter({ has: tile(page, text) })

async function openToday(page: Page) {
  await nav(page).getByRole('link', { name: 'Today' }).click()
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Add to Today' })).toBeVisible()
  const dismiss = page.getByRole('button', { name: 'Dismiss Morning Check' })
  if (await dismiss.isVisible()) await dismiss.click()
}

async function clearToasts(page: Page) {
  const closers = page.getByRole('button', { name: 'Close toast' })
  for (let i = await closers.count(); i > 0; i--) await closers.first().click({ timeout: 2000 }).catch(() => {})
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const extra = document.documentElement.scrollWidth - window.innerWidth
    if (extra <= 0) return null
    // Name the widest offender so a failure says what to fix.
    const wide = Array.from(document.querySelectorAll('body *')).filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
    const el = wide.at(-1)
    return `${extra}px: <${el?.tagName.toLowerCase()} class="${el?.getAttribute('class')?.slice(0, 120)}"> "${el?.textContent?.slice(0, 40)}"`
  })
  expect(overflow).toBeNull()
}

/** Select the first loggable hour cell and return its spoken hour ("4 AM"). */
async function selectFirstHour(page: Page) {
  const cell = page.getByRole('group', { name: 'Hours of the day' }).locator('button:not([disabled])').first()
  const hour = (await cell.getAttribute('aria-label'))!.split(':')[0]
  await cell.click()
  return hour
}

test('Habits: start one from Today, tap to log, streak on the Habits page, edit and delete with undo', async ({ page }) => {
  await signUp(page)
  await openToday(page)

  await page.getByRole('textbox', { name: 'Habit name' }).fill('Drink 2L water')
  await page.getByRole('button', { name: 'Add habit' }).click()
  const card = page.getByRole('region', { name: 'Habits' })
  const habit = card.getByRole('button', { name: /Drink 2L water/ })
  await expect(habit).toHaveAttribute('aria-pressed', 'false')
  await expect(card).toContainText('0 of 1 done')
  await expect(nav(page).getByRole('link', { name: /Habits/ })).toContainText('1')

  await habit.click()
  await expect(habit).toHaveAttribute('aria-pressed', 'true')
  await expect(card).toContainText('1 of 1 done')
  await expect(card).toContainText('All done today')
  await expect(page.getByRole('definition').filter({ hasText: '1/1' })).toBeVisible() // header stat

  // Undo is just another tap; then done again.
  await habit.click()
  await expect(habit).toHaveAttribute('aria-pressed', 'false')
  await habit.click()

  await card.getByRole('link', { name: 'Manage' }).click()
  await expect(page.getByRole('heading', { name: 'Habits', level: 1 })).toBeVisible()
  const article = page.getByRole('article').filter({ hasText: 'Drink 2L water' })
  await expect(article.getByText('Streak')).toBeVisible()
  await expect(article.getByRole('button', { name: 'Today: done' })).toHaveAttribute('aria-pressed', 'true')

  // Backfill yesterday: streak becomes 2.
  const cells = article.getByRole('list').first().getByRole('button')
  await cells.nth(5).click()
  await expect(cells.nth(5)).toHaveAttribute('aria-pressed', 'true')
  await expect(article.locator('dd').first()).toHaveText('2')

  // A second habit on weekdays only.
  await page.getByRole('textbox', { name: 'New habit' }).fill('Read 10 pages')
  await page.getByRole('group', { name: 'How often' }).getByRole('button', { name: 'Weekdays' }).click()
  await page.getByRole('button', { name: 'Add habit' }).click()
  await expect(page.getByRole('article').filter({ hasText: 'Read 10 pages' })).toContainText('Weekdays')

  // Rename, then delete with Undo.
  await article.getByRole('button', { name: 'Edit Drink 2L water' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit habit' })
  await dialog.getByLabel('Name').fill('Drink 3L water')
  await dialog.getByRole('button', { name: 'Save' }).click()
  const renamed = page.getByRole('article').filter({ hasText: 'Drink 3L water' })
  await expect(renamed).toBeVisible()
  await renamed.getByRole('button', { name: 'Edit Drink 3L water' }).click()
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await dialog.getByRole('button', { name: 'Delete' }).last().click()
  await expect(renamed).toHaveCount(0)
  await page.locator('[data-sonner-toast]').filter({ hasText: 'Habit deleted' }).getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('article').filter({ hasText: 'Drink 3L water' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('article')).toHaveCount(2)
})

test('A board tile becomes a habit from its edit dialog', async ({ page }) => {
  await signUp(page)
  await addDump(page, 'Meditate 5 minutes')
  await page.getByRole('button', { name: 'Edit: Meditate 5 minutes' }).click()
  await page.getByRole('dialog', { name: 'Edit dump' }).getByRole('button', { name: 'Make it a habit' }).click()
  await expect(tile(page, 'Meditate 5 minutes')).toHaveCount(0)
  await nav(page).getByRole('link', { name: /Habits/ }).click()
  await expect(page.getByRole('article').filter({ hasText: 'Meditate 5 minutes' })).toContainText('Daily')
})

test('Priority: set on a tile, shown as a chip, sorts first, shows in Today', async ({ page }) => {
  await signUp(page)
  for (const t of ['Low thing', 'Urgent thing', 'Plain thing']) await addDump(page, t)
  await page.getByRole('button', { name: 'Edit: Urgent thing' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit dump' })
  await edit.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'High' }).click()
  await edit.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Edit: Low thing' }).click()
  await edit.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'Low' }).click()
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(tileItem(page, 'Urgent thing')).toContainText('High')

  await page.getByRole('combobox', { name: 'Sort dumps' }).selectOption('priority')
  const order = await page.locator('ul[aria-label="Pending dumps"] > li').allInnerTexts()
  expect(order.map((t) => t.split('\n')[0])).toEqual(['Urgent thing', 'Low thing', 'Plain thing'])

  await page.getByRole('button', { name: 'Add to Today: Urgent thing' }).click()
  await openToday(page)
  await expect(page.getByRole('region', { name: 'Next' })).toContainText('High')
})

test('Hour log: name an "Other" hour, reuse it as a quick pick, see it in the Week view', async ({ page }) => {
  await signUp(page)
  await openToday(page)
  await page.getByRole('button', { name: /Where did the time go\?/ }).click()

  const hour = await selectFirstHour(page)
  await page.getByRole('button', { name: 'Other…' }).click()
  await page.getByRole('textbox', { name: 'What was it?' }).fill('Gym')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: `${hour}: Gym` })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Legend' })).toContainText('(Gym)')

  // "Gym" is now a one-tap pick; a name that matches a category becomes that category.
  await selectFirstHour(page)
  await expect(page.getByRole('group', { name: /Mark 1 hour as/ }).getByRole('button', { name: 'Gym' })).toBeVisible()
  await page.getByRole('button', { name: 'Other…' }).click()
  await page.getByRole('textbox', { name: 'What was it?' }).fill('sleep')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: `${hour}: Sleep` })).toBeVisible()

  await selectFirstHour(page)
  await page.getByRole('group', { name: /Mark 1 hour as/ }).getByRole('button', { name: 'Gym' }).click()

  await page.getByRole('tab', { name: 'Week' }).click()
  const table = page.getByRole('table')
  await expect(table.getByRole('rowheader', { name: 'Other' })).toBeVisible()
  await expect(table.getByRole('rowheader', { name: 'Gym' })).toBeVisible()
  await expect(page.getByText(/1h logged on 1 of 7 days/)).toBeVisible()
  await page.getByRole('button', { name: 'Previous week' }).click()
  await expect(page.getByText(/No hours logged that week/)).toBeVisible()
  // The tab choice is remembered.
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true')
})

test('Today shows a daily quote; the account menu downloads a backup', async ({ page }) => {
  await signUp(page)
  await addDump(page, 'Something to back up')
  await openToday(page)
  await expect(page.locator('figure blockquote')).not.toBeEmpty()
  await expect(page.locator('figure figcaption')).toContainText('—')

  await page.getByRole('button', { name: 'Account menu' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download my data' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^mind-dump-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const json = JSON.parse(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8')))
  expect(json.dumps.active[0].content).toBe('Something to back up')
})

test('no horizontal overflow on /habits and the Week view at phone width', async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 360, height: 780 })
  await signUp(page)
  await nav(page).getByRole('link', { name: /Habits/ }).click()
  await page.getByRole('textbox', { name: 'New habit' }).fill('A fairly long habit name that should wrap well on a phone screen')
  await page.getByRole('button', { name: 'Add habit' }).click()
  await page.getByRole('button', { name: /history/ }).click()
  await clearToasts(page)
  await noHorizontalOverflow(page)
  await openToday(page)
  await page.getByRole('button', { name: /Where did the time go\?/ }).click()
  await selectFirstHour(page)
  await page.getByRole('button', { name: 'Study', exact: true }).click()
  await page.getByRole('tab', { name: 'Week' }).click()
  await clearToasts(page)
  await noHorizontalOverflow(page)
})

for (const theme of ['light', 'dark'] as const) {
  test(`features visual tour (${theme})`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('minddump:theme', t)
      } catch {
        // ignore
      }
    }, theme)
    const shot = (name: string, fullPage = true) =>
      page.screenshot({ path: `test-results/feature-shots/${info.project.name}-${name}-${theme}.png`, fullPage })
    const settle = () => page.waitForTimeout(450)

    await signUp(page, 'Nishant')
    for (const t of ['Pay electricity bill', 'Renew passport before March', 'Call mom']) await addDump(page, t)
    await page.getByRole('button', { name: 'Edit: Pay electricity bill' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit dump' })
    await edit.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'High' }).click()
    await settle()
    await shot('edit-priority', false)
    await edit.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('button', { name: 'Edit: Call mom' }).click()
    await edit.getByRole('group', { name: 'Priority' }).getByRole('button', { name: 'Medium' }).click()
    await edit.getByRole('button', { name: 'Save' }).click()
    await clearToasts(page)
    await settle()
    await shot('board')

    await nav(page).getByRole('link', { name: /Habits/ }).click()
    for (const h of ['Drink 2L water', 'Read 10 pages', 'Walk 20 minutes']) {
      await page.getByRole('textbox', { name: 'New habit' }).fill(h)
      await page.getByRole('button', { name: 'Add habit' }).click()
      await expect(page.getByRole('article').filter({ hasText: h })).toBeVisible()
    }
    const first = page.getByRole('article').filter({ hasText: 'Drink 2L water' })
    for (const n of [3, 4, 5]) await first.getByRole('list').first().getByRole('button').nth(n).click()
    await first.getByRole('button', { name: /history/ }).click()
    await clearToasts(page)
    await settle()
    await shot('habits')

    await openToday(page)
    await page.getByRole('region', { name: 'Habits' }).getByRole('button', { name: /Read 10 pages/ }).click()
    await page.getByRole('button', { name: /Where did the time go\?/ }).click()
    await selectFirstHour(page)
    await page.getByRole('button', { name: 'Study', exact: true }).click()
    await selectFirstHour(page)
    await page.getByRole('button', { name: 'Other…' }).click()
    await settle()
    await shot('other-naming', false)
    await page.getByRole('textbox', { name: 'What was it?' }).fill('Gym')
    await page.getByRole('button', { name: 'Save' }).click()
    await clearToasts(page)
    await settle()
    await shot('today')
    await page.getByRole('tab', { name: 'Week' }).click()
    await settle()
    await page.getByRole('tab', { name: 'Week' }).scrollIntoViewIfNeeded()
    await shot('week', false)
  })
}
