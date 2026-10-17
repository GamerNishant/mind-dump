import { expect, test, type Page } from '@playwright/test'

const PASSWORD = 'correct-horse-1'
let counter = 0

async function signUp(page: Page, name = 'Test User'): Promise<string> {
  const email = `user${Date.now()}${counter++}@example.com`
  await page.goto('/signup')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible()
  return email
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
}

async function signIn(page: Page, email: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Pending' })).toBeVisible()
}

async function addDump(page: Page, text: string) {
  await page.getByLabel('New dump').fill(text)
  await page.getByRole('button', { name: 'Dump', exact: true }).click()
  await expect(page.getByLabel('New dump')).toHaveValue('')
}

const tileTexts = (page: Page) =>
  page.$$eval('ul[aria-label="Pending dumps"] > li', (lis) => lis.map((li) => li.querySelector('p')?.textContent ?? ''))

const tile = (page: Page, text: string) => page.getByRole('button', { name: `Mark done: ${text}`, exact: true })

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test('redirects to login when signed out', async ({ page }) => {
  await page.goto('/history')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await noHorizontalOverflow(page)
})

test('validates the sign-up form', async ({ page }) => {
  await page.goto('/signup')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Tell us what to call you.')).toBeVisible()
  await expect(page.getByText('Enter a valid email address.')).toBeVisible()
  await expect(page.getByText('Use at least 8 characters.')).toBeVisible()
})

test('add, clear with undo, restore from history', async ({ page }) => {
  await signUp(page)
  await expect(page.getByText('Your mind is clear')).toBeVisible()

  await addDump(page, 'Buy milk')
  await expect(tile(page, 'Buy milk')).toBeVisible()
  await expect(page.locator('ul[aria-label="Pending dumps"]').getByText('Today')).toBeVisible()

  // Click → disappears, undo brings it back.
  await tile(page, 'Buy milk').click()
  await expect(tile(page, 'Buy milk')).toHaveCount(0)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(tile(page, 'Buy milk')).toBeVisible()

  // Clear again, then restore from the History screen.
  await tile(page, 'Buy milk').click()
  await expect(tile(page, 'Buy milk')).toHaveCount(0)
  await page.getByRole('link', { name: 'History' }).click()
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Today', level: 2 })).toBeVisible()
  await expect(page.getByRole('main').getByText('Buy milk')).toBeVisible()
  await page.getByRole('button', { name: 'Restore: Buy milk' }).click()
  await expect(page.getByText('Nothing cleared yet')).toBeVisible()
  await page.getByRole('link', { name: 'Back to board' }).click()
  await expect(tile(page, 'Buy milk')).toBeVisible()

  // Survives a reload (persisted).
  await page.reload()
  await expect(tile(page, 'Buy milk')).toBeVisible()
})

test('delete forever and clear all in history', async ({ page }) => {
  await signUp(page)
  for (const t of ['one', 'two', 'three']) await addDump(page, t)
  for (const t of ['one', 'two', 'three']) {
    await tile(page, t).click()
    await expect(tile(page, t)).toHaveCount(0)
  }
  await page.getByRole('link', { name: 'History' }).click()
  await page.getByRole('button', { name: 'Delete forever: two' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restore: two' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Restore: one' })).toBeVisible()

  await page.getByRole('button', { name: 'Clear all' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete all' }).click()
  await expect(page.getByText('Nothing cleared yet')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Nothing cleared yet')).toBeVisible()
})

test('sorting and search', async ({ page }) => {
  await signUp(page)
  for (const t of ['banana', 'Apple', 'cherry']) await addDump(page, t)
  // Newest dumps land on top in "My order".
  await expect.poll(() => tileTexts(page)).toEqual(['cherry', 'Apple', 'banana'])

  const sort = page.getByLabel('Sort dumps')
  await sort.selectOption('az')
  await expect.poll(() => tileTexts(page)).toEqual(['Apple', 'banana', 'cherry'])
  await sort.selectOption('za')
  await expect.poll(() => tileTexts(page)).toEqual(['cherry', 'banana', 'Apple'])
  await sort.selectOption('oldest')
  await expect.poll(() => tileTexts(page)).toEqual(['banana', 'Apple', 'cherry'])
  await sort.selectOption('longest')
  // banana/cherry tie on length → "My order" (cherry is newer, so on top) breaks the tie.
  await expect.poll(() => tileTexts(page)).toEqual(['cherry', 'banana', 'Apple'])

  // Preference persists across reloads.
  await page.reload()
  await expect(page.getByLabel('Sort dumps')).toHaveValue('longest')

  await page.getByLabel('Search dumps').fill('AN')
  await expect.poll(() => tileTexts(page)).toEqual(['banana'])
  await expect(page.getByText('Showing 1 of 3')).toBeVisible()
  await page.getByLabel('Search dumps').fill('zzz')
  await expect(page.getByText('No matches')).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).first().click()
  await expect.poll(() => tileTexts(page)).toHaveLength(3)
})

test('split a pasted list into several tiles', async ({ page }) => {
  await signUp(page)
  await page.getByLabel('New dump').fill('- call mom\n- pay rent\n- fix bike')
  await page.getByRole('button', { name: 'Split into 3' }).click()
  await expect.poll(() => tileTexts(page)).toEqual(['call mom', 'pay rent', 'fix bike'])
})

test('edit and delete a dump', async ({ page }) => {
  await signUp(page)
  await addDump(page, 'Draft email')
  await page.getByRole('button', { name: 'Edit: Draft email' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit dump' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Dump text').fill('Send the email to Priya')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(tile(page, 'Send the email to Priya')).toBeVisible()

  await page.getByRole('button', { name: 'Edit: Send the email to Priya' }).click()
  const editDialog = page.getByRole('dialog', { name: 'Edit dump' })
  await editDialog.getByRole('button', { name: 'Delete', exact: true }).click()
  // Two-step: nothing is deleted until confirmed.
  await editDialog.getByRole('button', { name: 'Keep' }).click()
  await editDialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await editDialog.getByRole('button', { name: 'Delete forever' }).click()
  await expect(page.getByText('Your mind is clear')).toBeVisible()
})

test('move to top / bottom from the edit dialog (no dragging needed)', async ({ page }) => {
  await signUp(page)
  for (const t of ['c', 'b', 'a']) await addDump(page, t)
  await page.getByRole('button', { name: 'Edit: c' }).click()
  await page.getByRole('dialog', { name: 'Edit dump' }).getByRole('button', { name: 'Move to top' }).click()
  await expect.poll(() => tileTexts(page)).toEqual(['c', 'a', 'b'])
  await page.getByRole('button', { name: 'Edit: a' }).click()
  await page.getByRole('dialog', { name: 'Edit dump' }).getByRole('button', { name: 'Move to bottom' }).click()
  await expect.poll(() => tileTexts(page)).toEqual(['c', 'b', 'a'])
  await page.reload()
  await expect.poll(() => tileTexts(page)).toEqual(['c', 'b', 'a'])
})

test('shows how many days each dump has been pending', async ({ page }) => {
  await signUp(page)
  await addDump(page, 'Old task')
  await addDump(page, 'New task')
  // Backdate "Old task" by 5 days directly in device storage.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('minddump:local:dumps:'))!
    const items = JSON.parse(localStorage.getItem(key)!)
    const old = items.find((d: { content: string }) => d.content === 'Old task')
    old.createdAt = new Date(Date.now() - 5 * 86_400_000).toISOString()
    localStorage.setItem(key, JSON.stringify(items))
  })
  await page.reload()
  const list = page.locator('ul[aria-label="Pending dumps"]')
  await expect(list.locator('li', { hasText: 'Old task' })).toContainText('5 days')
  await expect(list.locator('li', { hasText: 'New task' })).toContainText('Today')
  await page.getByLabel('Sort dumps').selectOption('oldest')
  await expect.poll(() => tileTexts(page)).toEqual(['Old task', 'New task'])
})

test('data is private to each user', async ({ page }) => {
  const alice = await signUp(page, 'Alice')
  await addDump(page, 'Alice secret')
  await signOut(page)

  await page.getByRole('link', { name: 'Create an account' }).click()
  await signUp(page, 'Bob')
  await expect(page.getByText('Your mind is clear')).toBeVisible()
  await expect(tile(page, 'Alice secret')).toHaveCount(0)
  await signOut(page)

  await signIn(page, alice)
  await expect(tile(page, 'Alice secret')).toBeVisible()
})

test('wrong password is rejected', async ({ page }) => {
  const email = await signUp(page)
  await signOut(page)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('nope-nope-nope')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Wrong email or password.')
})

test('no horizontal overflow on any screen', async ({ page }) => {
  await page.goto('/signup')
  await noHorizontalOverflow(page)
  await signUp(page)
  await addDump(page, 'A very long thought '.repeat(30))
  await addDump(page, 'Supercalifragilisticexpialidocious_without_any_spaces_at_all_to_test_wrapping')
  await noHorizontalOverflow(page)
  await tile(page, 'Supercalifragilisticexpialidocious_without_any_spaces_at_all_to_test_wrapping').click()
  await page.getByRole('link', { name: 'History' }).click()
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible()
  await noHorizontalOverflow(page)
})

test.describe('desktop only', () => {
  test.skip(({ isMobile }) => isMobile, 'mouse and keyboard interactions')

  test('drag and drop reorders with the mouse', async ({ page }) => {
    await signUp(page)
    for (const t of ['d', 'c', 'b', 'a']) await addDump(page, t)
    await expect.poll(() => tileTexts(page)).toEqual(['a', 'b', 'c', 'd'])

    const from = (await tile(page, 'a').boundingBox())!
    const to = (await tile(page, 'c').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 5 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
    await page.mouse.up()

    await expect.poll(() => tileTexts(page)).toEqual(['b', 'c', 'a', 'd'])
    // The drop must not count as a click (nothing cleared).
    await expect(page.getByText('Cleared from your mind')).toHaveCount(0)
    await page.reload()
    await expect.poll(() => tileTexts(page)).toEqual(['b', 'c', 'a', 'd'])
  })

  test('dragging in a sorted view adopts it as "My order"', async ({ page }) => {
    await signUp(page)
    for (const t of ['b', 'c', 'a']) await addDump(page, t)
    await page.getByLabel('Sort dumps').selectOption('az')
    await expect.poll(() => tileTexts(page)).toEqual(['a', 'b', 'c'])

    const from = (await tile(page, 'c').boundingBox())!
    const to = (await tile(page, 'a').boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 - 10, from.y + from.height / 2, { steps: 5 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
    await page.mouse.up()

    await expect(page.getByLabel('Sort dumps')).toHaveValue('custom')
    await expect.poll(() => tileTexts(page)).toEqual(['c', 'a', 'b'])
  })

  test('keyboard: clearing a focused tile moves focus to the next one', async ({ page }) => {
    await signUp(page)
    for (const t of ['c', 'b', 'a']) await addDump(page, t)
    await tile(page, 'a').focus()
    await page.keyboard.press('Enter')
    await expect(tile(page, 'a')).toHaveCount(0)
    await expect(tile(page, 'b')).toBeFocused()
  })

  test('keyboard reordering via the handle', async ({ page }) => {
    await signUp(page)
    for (const t of ['c', 'b', 'a']) await addDump(page, t)
    await page.getByRole('button', { name: 'Reorder: a' }).focus()
    // Human-ish pacing: dnd-kit attaches its key listeners a tick after pick-up.
    await page.keyboard.press('Space')
    await page.waitForTimeout(150)
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
    await page.keyboard.press('Space')
    await expect.poll(() => tileTexts(page)).toEqual(['b', 'a', 'c'])
  })

  test('Enter adds, Shift+Enter makes a new line, "n" focuses the composer', async ({ page }) => {
    await signUp(page)
    const input = page.getByLabel('New dump')
    await input.fill('line one')
    await input.press('Shift+Enter')
    await input.pressSequentially('line two')
    await input.press('Enter')
    await expect.poll(() => tileTexts(page)).toEqual(['line one\nline two'])
    await input.blur()
    await page.keyboard.press('n')
    await expect(input).toBeFocused()
  })
})

test('visual tour (screenshots)', async ({ page }, info) => {
  await page.goto('/login')
  await page.screenshot({ path: `test-results/screens/${info.project.name}-login.png` })
  await signUp(page, 'Nishant Kumar')
  const thoughts = [
    'Book the dentist appointment',
    'Idea: build a habit tracker with streaks and a weekly review screen',
    'Reply to Sam about the weekend hike',
    'Renew passport before March',
    'Read chapter 4 of Deep Work',
    'Pay electricity bill',
    'Look into index funds vs. FDs for the emergency fund — compare returns, liquidity and tax',
    'Call mom',
  ]
  for (const t of [...thoughts].reverse()) await addDump(page, t)
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('minddump:local:dumps:'))!
    const items = JSON.parse(localStorage.getItem(key)!)
    const ages = [12, 0, 4, 21, 1, 8, 2, 0]
    const byContent = (c: string) => items.find((d: { content: string }) => d.content === c)
    const order = [
      'Book the dentist appointment',
      'Idea: build a habit tracker with streaks and a weekly review screen',
      'Reply to Sam about the weekend hike',
      'Renew passport before March',
      'Read chapter 4 of Deep Work',
      'Pay electricity bill',
      'Look into index funds vs. FDs for the emergency fund — compare returns, liquidity and tax',
      'Call mom',
    ]
    order.forEach((c, i) => (byContent(c).createdAt = new Date(Date.now() - ages[i] * 86_400_000).toISOString()))
    localStorage.setItem(key, JSON.stringify(items))
  })
  await page.reload()
  await expect(tile(page, 'Call mom')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `test-results/screens/${info.project.name}-board-light.png`, fullPage: true })

  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('button', { name: 'Dark' }).click()
  await page.screenshot({ path: `test-results/screens/${info.project.name}-menu-dark.png` })
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `test-results/screens/${info.project.name}-board-dark.png`, fullPage: true })

  await tile(page, 'Pay electricity bill').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `test-results/screens/${info.project.name}-toast-dark.png` })
  await tile(page, 'Call mom').click()
  await page.waitForTimeout(400)
  await page.getByRole('link', { name: 'History' }).click()
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `test-results/screens/${info.project.name}-history-dark.png`, fullPage: true })

  await page.getByRole('link', { name: 'Back to board' }).click()
  await page.getByRole('button', { name: 'Edit: Read chapter 4 of Deep Work' }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `test-results/screens/${info.project.name}-edit-dark.png` })
})
