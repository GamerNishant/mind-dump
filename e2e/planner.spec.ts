import { expect, test, type Page } from '@playwright/test'

/*
 * End-to-end tests for the planner: Today, Focus, Skip sheet, Repeat, Shutdown, Rules, hour log.
 * Runs in device-only mode (see playwright.config.ts); every test signs up a fresh local user.
 *
 * Time-of-day notes:
 * - MorningLanding: before noon the first "/" of a browser session redirects to /today. An init
 *   script marks the session as already landed, so tests start on the board like app.spec.ts.
 * - The Morning Check card shows on /today before 2 PM; dismissMorningCheck() closes it.
 * - Hour-log cells after the current hour are disabled; the test picks the first enabled cell.
 */

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

// ---- helpers (copied from app.spec.ts, plus planner helpers) ---------------------------------

async function signUp(page: Page, name = 'Test User'): Promise<string> {
  const email = `planner${Date.now()}${counter++}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible()
  return email
}

async function addDump(page: Page, text: string) {
  await page.getByLabel('New dump').fill(text)
  await page.getByRole('button', { name: 'Dump', exact: true }).click()
  await expect(page.getByLabel('New dump')).toHaveValue('')
}

const tile = (page: Page, text: string) => page.getByRole('button', { name: `Mark done: ${text}`, exact: true })
const tileItem = (page: Page, text: string) =>
  page.locator('ul[aria-label="Pending dumps"] > li').filter({ has: tile(page, text) })

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

async function openBoard(page: Page) {
  await nav(page).getByRole('link', { name: 'Dump', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible()
}

async function openToday(page: Page) {
  await nav(page).getByRole('link', { name: 'Today' }).click()
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await dismissMorningCheck(page)
}

/** The Morning Check card appears on /today before 2 PM; close it when it's there. */
async function dismissMorningCheck(page: Page) {
  // Let the planner settle so the card has had its chance to render.
  await expect(page.getByRole('textbox', { name: 'Add to Today' })).toBeVisible()
  const dismiss = page.getByRole('button', { name: 'Dismiss Morning Check' })
  if (await dismiss.isVisible()) {
    await dismiss.click()
    await expect(dismiss).toHaveCount(0)
  }
}

const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]').filter({ hasText: text }).first()

/** Close every visible toast (on a phone they can sit over the bottom of the page). */
async function clearToasts(page: Page) {
  const closers = page.getByRole('button', { name: 'Close toast' })
  for (let i = await closers.count(); i > 0; i--) {
    await closers.first().click({ timeout: 2000 }).catch(() => {})
  }
}

const queue = (page: Page) => page.getByRole('list', { name: "Today's queue" })
/** A queue row (the first row's text carries a screen-reader "Next: " prefix, so match loosely). */
const queueRow = (page: Page, text: string) => queue(page).locator('li').filter({ hasText: text })

/** Type an item into Today's add form. */
async function addTodayItem(page: Page, text: string, type: 'Task' | 'Block' = 'Task') {
  const input = page.getByRole('textbox', { name: 'Add to Today' })
  await input.fill(text)
  await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: type, exact: true }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
}

async function addTodayItemOk(page: Page, text: string, type: 'Task' | 'Block' = 'Task') {
  await addTodayItem(page, text, type)
  await expect(page.getByRole('textbox', { name: 'Add to Today' })).toHaveValue('')
  await expect(queueRow(page, text)).toBeVisible()
}

// ---- 1. "+ Today" on a tile ----------------------------------------------------------------

test('"+ Today" on a tile adds it to Today; the tile stays with an "In Today" chip', async ({ page }) => {
  await signUp(page)
  await addDump(page, 'Write the essay intro')

  await page.getByRole('button', { name: 'Add to Today: Write the essay intro' }).click()
  await expect(toast(page, 'Added to Today')).toBeVisible()
  await expect(tile(page, 'Write the essay intro')).toBeVisible()
  await expect(tileItem(page, 'Write the essay intro')).toContainText('In Today')

  // Second time: already there. The button is now aria-disabled (still clickable, explains why).
  const again = page.getByRole('button', { name: 'Add to Today: Write the essay intro' })
  await expect(again).toHaveAttribute('aria-disabled', 'true')
  await again.click({ force: true })
  await expect(toast(page, 'Already in Today')).toBeVisible()

  await openToday(page)
  await expect(queueRow(page, 'Write the essay intro')).toBeVisible()
  await expect(page.getByText('1 open')).toBeVisible()
})

// ---- 2. Add form → queue + board tile; Done; reopen -----------------------------------------

test('Today: typed item lands in the queue and on the board; Done and reopen', async ({ page }) => {
  await signUp(page)
  await openToday(page)
  await expect(page.getByText('Nothing queued.')).toBeVisible()

  await addTodayItemOk(page, 'Call the bank')
  await expect(toast(page, 'Added to Today')).toBeVisible()

  // It's also a tile on the board, marked In Today.
  await openBoard(page)
  await expect(tile(page, 'Call the bank')).toBeVisible()
  await expect(tileItem(page, 'Call the bank')).toContainText('In Today')

  await openToday(page)
  await page.getByRole('button', { name: 'Done: Call the bank' }).click()
  await expect(toast(page, 'Done')).toBeVisible()
  await expect(queue(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Queue clear' })).toBeVisible()

  await page.getByRole('button', { name: /Done & skipped \(1\)/ }).click()
  await page.getByRole('button', { name: 'Undo done: Call the bank' }).click()
  await expect(toast(page, 'Back in the queue')).toBeVisible()
  await expect(queueRow(page, 'Call the bank')).toBeVisible()
  await expect(page.getByRole('button', { name: /Done & skipped/ })).toHaveCount(0)

  // Persisted.
  await page.reload()
  await dismissMorningCheck(page)
  await expect(queueRow(page, 'Call the bank')).toBeVisible()
})

// ---- 3. Block → Focus → Park → End with Bookmark ------------------------------------------

test('Block: Start, focus countdown, park a thought, End with a Bookmark', async ({ page }) => {
  await signUp(page)
  await openToday(page)
  await addTodayItemOk(page, 'Read PSIR chapter 3')

  // Switch the task to a Block from its queue row.
  await page.getByRole('button', { name: 'Type: Task. Switch to Block' }).click()
  await expect(page.getByRole('button', { name: 'Type: Block. Switch to Task' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Next' })).toContainText('Block · 50 min')

  await page.getByRole('region', { name: 'Next' }).getByRole('button', { name: 'Start' }).click()
  await expect(page).toHaveURL(/\/focus$/)
  await expect(page.getByRole('heading', { name: 'Read PSIR chapter 3' })).toBeVisible()
  const timer = page.getByRole('timer')
  await expect(timer).toHaveAccessibleName(/^(50:00|49:\d\d) remaining$/)
  // It counts down.
  const first = await timer.textContent()
  await expect.poll(() => timer.textContent(), { timeout: 5000 }).not.toBe(first)

  // Park a thought → new dump tile.
  await page.getByLabel('Park a thought').fill('Buy printer ink')
  await page.getByLabel('Park a thought').press('Enter')
  await expect(toast(page, 'Parked in your dump')).toBeVisible()
  await expect(page.getByLabel('Park a thought')).toHaveValue('')

  // End: minimum met + where I stopped.
  await page.getByRole('button', { name: 'End', exact: true }).click()
  const end = page.getByRole('dialog', { name: 'End the block' })
  await expect(end).toBeVisible()
  await expect(end.getByRole('button', { name: 'Log block' })).toBeDisabled()
  await end.getByRole('radio', { name: 'Yes' }).click()
  await end.getByLabel('Where did you stop?').fill('p.42 heading 3')
  await end.getByRole('button', { name: 'Log block' }).click()

  await expect(page).toHaveURL(/\/today$/)
  await expect(toast(page, 'Block logged. Bookmark saved.')).toBeVisible()
  await dismissMorningCheck(page)
  await expect(page.getByRole('heading', { name: 'Queue clear' })).toBeVisible()
  await expect(page.locator('dl')).toContainText('Blocks1/2')
  await page.getByRole('button', { name: /Done & skipped \(1\)/ }).click()
  await expect(page.locator('#closed-items')).toContainText('Read PSIR chapter 3')

  // Board: the tile shows the Bookmark chip; the parked thought is a tile.
  await openBoard(page)
  await expect(tile(page, 'Buy printer ink')).toBeVisible()
  await expect(tileItem(page, 'Read PSIR chapter 3').locator('[title="Bookmark: p.42 heading 3"]')).toBeVisible()

  // The Bookmark is the tile's setting in the edit dialog.
  await page.getByRole('button', { name: 'Edit: Read PSIR chapter 3' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit dump' })
  await expect(edit.getByRole('textbox', { name: 'Bookmark' })).toHaveValue('p.42 heading 3')
  await edit.getByRole('button', { name: 'Cancel' }).click()

  // Next time the tile is queued (here: for tomorrow), the Bookmark is its first action.
  await page.goto('/shutdown')
  await expect(page.getByRole('heading', { name: 'Shutdown', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Add "Read PSIR chapter 3" to tomorrow' }).click()
  await expect(toast(page, 'Added to tomorrow')).toBeVisible()
  const tomorrow = page.getByRole('region', { name: "Tomorrow's queue" })
  await expect(tomorrow).toContainText('Resume: p.42 heading 3')
  // It's a Block (the tile remembers the type), so it is tomorrow's Block 1, prefilled from the Bookmark.
  await expect(page.getByLabel('First action (≤10 words)')).toHaveValue('Resume: p.42 heading 3')

  // And reopening today's item shows it as the first action too.
  await page.goto('/today')
  await dismissMorningCheck(page)
  await page.getByRole('button', { name: /Done & skipped \(1\)/ }).click()
  await page.getByRole('button', { name: 'Undo done: Read PSIR chapter 3' }).click()
  await expect(page.getByRole('region', { name: 'Next' }).getByRole('button', { name: 'First action: Resume: p.42 heading 3. Edit' })).toBeVisible()
})

// ---- 4. Skip sheet: Say with reason → Tomorrow ---------------------------------------------

test('Skip sheet: Say with a reason + Tomorrow takes it out of today', async ({ page }) => {
  await signUp(page)
  await openToday(page)
  await addTodayItemOk(page, 'Clean the garage')
  await addTodayItemOk(page, 'Email Priya')

  await page.getByRole('button', { name: 'Skip: Clean the garage' }).click()
  const sheet = page.getByRole('dialog', { name: 'Not feeling it?' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Do just 2 minutes' })).toBeVisible()
  // Tasks have no Shrink step.
  await expect(sheet.getByRole('button', { name: /Shrink to/ })).toHaveCount(0)
  const skip = sheet.getByRole('button', { name: 'Skip', exact: true })
  await expect(skip).toBeDisabled()

  await sheet.getByRole('radiogroup', { name: 'Why?' }).getByRole('radio', { name: 'Tired' }).click()
  // Seeded rules aren't created until /rules opens, so no IF-THEN tip yet; pick a destination.
  await sheet.getByRole('radiogroup', { name: 'Where does it go?' }).getByRole('radio', { name: 'Tomorrow' }).click()
  await expect(skip).toBeEnabled()
  await skip.click()

  await expect(sheet).toBeHidden()
  await expect(toast(page, 'Skipped: Tired → Tomorrow')).toBeVisible()
  await expect(queueRow(page, 'Clean the garage')).toHaveCount(0)
  await expect(queueRow(page, 'Email Priya')).toBeVisible()
  await expect(page.getByText('1 open')).toBeVisible()

  // It now sits in tomorrow's queue.
  await page.goto('/shutdown')
  await expect(page.getByRole('region', { name: "Tomorrow's queue" })).toContainText('Clean the garage')
})

// ---- 5. Repeat: Daily → Routine in Today ---------------------------------------------------

test('Repeat: Daily on a tile puts it in Today as a Routine', async ({ page }) => {
  await signUp(page)
  await addDump(page, 'Morning walk')
  await page.getByRole('button', { name: 'Edit: Morning walk' }).click()
  const edit = page.getByRole('dialog', { name: 'Edit dump' })
  const preset = edit.getByRole('group', { name: 'Repeat preset' })
  await expect(preset.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true')
  await preset.getByRole('button', { name: 'Daily' }).click()
  await expect(preset.getByRole('button', { name: 'Daily' })).toHaveAttribute('aria-pressed', 'true')
  await expect(edit.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit).toBeHidden()

  await expect(tileItem(page, 'Morning walk')).toContainText('Repeats:')
  await expect(tileItem(page, 'Morning walk')).toContainText('In Today')

  await openToday(page)
  const row = queueRow(page, 'Morning walk')
  await expect(row).toBeVisible()
  await expect(row).toContainText('Routine')
})

// ---- 6. Shutdown ---------------------------------------------------------------------------

test('Shutdown: resolve items, add a tile to tomorrow, complete', async ({ page }) => {
  await signUp(page)
  await addDump(page, 'Plan the week')
  await openToday(page)
  await addTodayItemOk(page, 'Pay rent')
  await addTodayItemOk(page, 'Fix the bike')

  await page.getByRole('link', { name: 'Shut down day' }).click()
  await expect(page).toHaveURL(/\/shutdown$/)
  await expect(page.getByRole('heading', { name: 'Shutdown', level: 1 })).toBeVisible()

  const resolve = page.getByRole('region', { name: 'Resolve today' })
  const close = page.getByRole('button', { name: /^Shutdown complete/ })
  await expect(close).toBeDisabled()
  await expect(page.getByText('Resolve the 2 open items above first')).toBeVisible()

  // Done.
  await resolve.locator('li').filter({ hasText: 'Pay rent' }).getByRole('button', { name: 'Done' }).click()
  await expect(resolve.locator('li').filter({ hasText: 'Pay rent' })).toHaveCount(0)
  // Skip with a reason → tomorrow.
  const bike = resolve.locator('li').filter({ hasText: 'Fix the bike' })
  await bike.getByRole('button', { name: 'Skip' }).click()
  await expect(bike.getByRole('button', { name: 'To tomorrow' })).toBeDisabled()
  await bike.getByRole('button', { name: 'Too big' }).click()
  await bike.getByRole('button', { name: 'To tomorrow' }).click()
  await expect(resolve).toContainText('All resolved ✓')

  // Add a board tile to tomorrow.
  const tomorrow = page.getByRole('region', { name: "Tomorrow's queue" })
  await expect(tomorrow).toContainText('Fix the bike')
  await page.getByRole('button', { name: 'Add "Plan the week" to tomorrow' }).click()
  await expect(toast(page, 'Added to tomorrow')).toBeVisible()
  await expect(tomorrow.locator('li').filter({ hasText: 'Plan the week' })).toBeVisible()
  await expect(tomorrow).toContainText('Tasks 2/5')

  await page.getByRole('checkbox', { name: 'Breakfast and lunch for tomorrow are sorted' }).check()
  await expect(close).toBeEnabled()
  await clearToasts(page)
  await close.click()

  await expect(page).toHaveURL(/\/today$/)
  await expect(toast(page, 'Shutdown complete')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Shutdown done' })).toBeVisible()
  await expect(page.getByText('Day closed. Rest well.')).toBeVisible()

  // Re-opening the shutdown page says it's already done.
  await page.getByRole('link', { name: 'Shutdown done' }).click()
  await expect(page.getByText(/Already shut down at/)).toBeVisible()
})

// ---- 7. Rules + settings + cap -------------------------------------------------------------

test('Rules: seeded rules, block cap stepper, third block refused', async ({ page }) => {
  await signUp(page)
  await openToday(page)
  await page.getByRole('link', { name: 'Rules' }).click()
  await expect(page.getByRole('heading', { name: 'Rules', level: 1 })).toBeVisible()
  await expect(page.getByText('I wake at 4 and reach for the phone')).toBeVisible()
  await expect(page.getByRole('switch')).toHaveCount(15)

  const cap = page.getByRole('group', { name: 'Block cap' })
  await expect(cap.locator('output')).toHaveText('2')
  await cap.getByRole('button', { name: 'More (Block cap)' }).click()
  await expect(cap.locator('output')).toHaveText('3')
  await page.reload()
  await expect(page.getByRole('group', { name: 'Block cap' }).locator('output')).toHaveText('3')
  // Seeding happens once: still 15 after a reload.
  await expect(page.getByRole('switch')).toHaveCount(15)

  await openToday(page)
  await expect(page.getByText('(max 3 · 5)')).toBeVisible()

  // Back to 2 and enforce it.
  await page.getByRole('link', { name: 'Rules' }).click()
  await page.getByRole('group', { name: 'Block cap' }).getByRole('button', { name: 'Fewer (Block cap)' }).click()
  await expect(page.getByRole('group', { name: 'Block cap' }).locator('output')).toHaveText('2')

  await openToday(page)
  await expect(page.getByText('(max 2 · 5)')).toBeVisible()
  await addTodayItemOk(page, 'Block one', 'Block')
  await addTodayItemOk(page, 'Block two', 'Block')
  await expect(page.getByText('Room left: 0 blocks')).toBeVisible()
  await clearToasts(page)
  await addTodayItem(page, 'Block three', 'Block')
  await expect(toast(page, 'Today is full: finish, skip or remove one first')).toBeVisible()
  await expect(queueRow(page, 'Block three')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Add to Today' })).toHaveValue('Block three')
  // Tasks still fit.
  await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'Task', exact: true }).click()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(queueRow(page, 'Block three')).toBeVisible()
  // Switching that task to a Block is refused too.
  await clearToasts(page)
  await queueRow(page, 'Block three').getByRole('button', { name: 'Type: Task. Switch to Block' }).click()
  await expect(toast(page, 'Today is full — the block cap is 2')).toBeVisible()
})

// ---- 8. Hour log ---------------------------------------------------------------------------

test('Hour log: select an hour, mark Study, summary shows it', async ({ page }) => {
  await signUp(page)
  await openToday(page)
  const toggle = page.getByRole('button', { name: /Where did the time go\?/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  const cells = page.getByRole('group', { name: 'Hours of the day' }).getByRole('button')
  await expect(cells).toHaveCount(24)
  // Hours after the current one are disabled; the first enabled cell is the day's first hour.
  const cell = page.getByRole('group', { name: 'Hours of the day' }).locator('button:not([disabled])').first()
  const label = (await cell.getAttribute('aria-label'))!
  expect(label).toMatch(/: not logged$/)
  const hourName = label.replace(/: not logged$/, '')
  await cell.click()
  await expect(cell).toHaveAttribute('aria-pressed', 'true')

  const bar = page.getByRole('group', { name: 'Mark 1 hour as' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Study', exact: true }).click()
  await expect(bar).toBeHidden()

  await expect(page.getByRole('button', { name: `${hourName}: Study` })).toBeVisible()
  await expect(page.getByText('Study 1h', { exact: true })).toBeVisible()

  // Collapsed, the header shows the summary; it persists across reloads.
  await toggle.click()
  await expect(toggle).toContainText('Study 1h')
  await page.reload()
  await expect(page.getByRole('button', { name: /Where did the time go\?/ })).toContainText('Study 1h')
})

// ---- 9. Overflow -------------------------------------------------------------------------

test('no horizontal overflow on /today, /focus, /shutdown, /rules at phone width', async ({ page, isMobile }) => {
  if (!isMobile) await page.setViewportSize({ width: 360, height: 780 })
  await signUp(page)
  const long = 'Supercalifragilisticexpialidocious_without_any_spaces_at_all_to_test_wrapping_in_the_queue'
  await addDump(page, 'A board tile with a fairly long sentence that should wrap nicely on a narrow screen')
  await openToday(page)
  await addTodayItemOk(page, long, 'Block')
  await addTodayItemOk(page, 'A very long task title '.repeat(8).trim())
  await clearToasts(page)
  await noHorizontalOverflow(page)

  // Hour log and closed list open, too.
  await page.getByRole('button', { name: /Where did the time go\?/ }).click()
  await noHorizontalOverflow(page)

  await page.getByRole('link', { name: 'Rules' }).click()
  await expect(page.getByText('I wake at 4 and reach for the phone')).toBeVisible()
  await noHorizontalOverflow(page)

  await page.goto('/shutdown')
  await expect(page.getByRole('region', { name: 'Resolve today' })).toBeVisible()
  await noHorizontalOverflow(page)
  await page.getByRole('region', { name: 'Resolve today' }).getByRole('button', { name: 'Skip' }).first().click()
  await noHorizontalOverflow(page)

  await page.goto('/today')
  await dismissMorningCheck(page)
  await page.getByRole('region', { name: 'Next' }).getByRole('button', { name: 'Start' }).click()
  await expect(page).toHaveURL(/\/focus$/)
  await expect(page.getByRole('timer')).toBeVisible()
  await noHorizontalOverflow(page)
  await page.getByRole('button', { name: 'End', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'End the block' })).toBeVisible()
  await noHorizontalOverflow(page)
})

// ---- 10. Visual tour -------------------------------------------------------------------------

for (const theme of ['light', 'dark'] as const) {
  test(`planner visual tour (${theme})`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('minddump:theme', t)
      } catch {
        // ignore
      }
    }, theme)
    const shot = (name: string, fullPage = false) =>
      page.screenshot({ path: `test-results/planner-shots/${info.project.name}-${name}-${theme}.png`, fullPage })
    const settle = () => page.waitForTimeout(450)

    await signUp(page, 'Nishant Kumar')
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark).*$/)
    for (const t of ['Pay electricity bill', 'Renew passport before March', 'Read chapter 4 of Deep Work', 'Lunch: dal + rice', 'Call mom']) {
      await addDump(page, t)
    }
    await page.getByRole('button', { name: 'Add to Today: Read chapter 4 of Deep Work' }).click()
    await page.getByRole('button', { name: 'Add to Today: Call mom' }).click()
    await expect(tileItem(page, 'Call mom')).toContainText('In Today')

    // Edit dialog with Repeat set.
    await page.getByRole('button', { name: 'Edit: Lunch: dal + rice' }).click()
    const edit = page.getByRole('dialog', { name: 'Edit dump' })
    await edit.getByRole('group', { name: 'Repeat preset' }).getByRole('button', { name: 'Daily' }).click()
    await edit.getByLabel('Light routine').check()
    await edit.getByLabel('Minimum').fill('Eat at the table')
    await clearToasts(page)
    await settle()
    await shot('edit-repeat')
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(edit).toBeHidden()
    await clearToasts(page)
    await settle()
    await shot('board', true)

    // Today with items.
    await openToday(page)
    await addTodayItemOk(page, 'PSIR: Locke and Hobbes notes', 'Block')
    await page.getByRole('region', { name: 'Next' }).getByRole('button', { name: 'Add first action' }).click()
    await page.getByRole('textbox', { name: 'First action' }).fill('Pen in hand, open p.14')
    await page.getByRole('textbox', { name: 'First action' }).press('Enter')
    await clearToasts(page)
    await settle()
    await shot('today', true)

    // Skip sheet.
    await page.getByRole('button', { name: 'Skip: Read chapter 4 of Deep Work' }).click()
    const sheet = page.getByRole('dialog', { name: 'Not feeling it?' })
    await sheet.getByRole('radio', { name: 'Tired' }).click()
    await sheet.getByRole('radio', { name: 'Later today' }).click()
    await settle()
    await shot('skip-sheet')
    await sheet.getByRole('button', { name: 'Cancel' }).click()
    await expect(sheet).toBeHidden()

    // Shutdown.
    await page.goto('/shutdown')
    await expect(page.getByRole('region', { name: 'Resolve today' })).toBeVisible()
    await settle()
    await shot('shutdown', true)

    // Rules.
    await page.goto('/rules')
    await expect(page.getByText('I wake at 4 and reach for the phone')).toBeVisible()
    await settle()
    await shot('rules', true)

    // Focus.
    await page.goto('/today')
    await dismissMorningCheck(page)
    await queueRow(page, 'PSIR: Locke and Hobbes notes').getByRole('button', { name: 'Start' }).click()
    await expect(page).toHaveURL(/\/focus$/)
    await expect(page.getByRole('timer')).toBeVisible()
    await clearToasts(page)
    await settle()
    await shot('focus')
  })
}
