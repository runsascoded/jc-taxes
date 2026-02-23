import { test, expect, type Page } from '@playwright/test'

/** Wait for the app to finish loading data. */
async function waitForLoad(page: Page) {
  await page.locator('[data-loaded]').waitFor({ timeout: 15000 })
}

test.describe('Loading & data', () => {
  test('default page loads and shows parcel count', async ({ page }) => {
    await page.goto('/')
    await waitForLoad(page)
    await expect(page.getByText(/\d+ parcels/)).toBeVisible()
  })
})

test.describe('Aggregation modes', () => {
  for (const agg of ['lot', 'block', 'ward'] as const) {
    test(`loads with agg=${agg}`, async ({ page }) => {
      await page.goto(`/?agg=${agg}`)
      await waitForLoad(page)
      await expect(page.getByText(/\d+ parcels/)).toBeVisible()
    })
  }
})

test.describe('URL params round-trip', () => {
  test('retains agg and year params after load', async ({ page }) => {
    await page.goto('/?agg=lot&y=2020')
    await waitForLoad(page)
    const url = new URL(page.url())
    expect(url.searchParams.get('agg')).toBe('lot')
    expect(url.searchParams.get('y')).toBe('2020')
  })

  test('year select updates URL', async ({ page }) => {
    await page.goto('/')
    await waitForLoad(page)
    await page.getByLabel('Tax Year:').selectOption('2020')
    await expect(page).toHaveURL(/[?&]y=2020/)
  })
})

test.describe('Keyboard shortcuts', () => {
  test('l → agg=lot, w → agg=ward, b → agg=block', async ({ page }) => {
    await page.goto('/')
    await waitForLoad(page)

    await page.keyboard.press('l')
    await expect(page).toHaveURL(/[?&]agg=lot/)

    await page.keyboard.press('w')
    await expect(page).toHaveURL(/[?&]agg=ward/)

    await page.keyboard.press('b')
    // block is the default agg, so the param is omitted from URL
    await expect(page).not.toHaveURL(/[?&]agg=/)
  })

  test('] increments year, [ decrements year', async ({ page }) => {
    await page.goto('/?y=2022')
    await waitForLoad(page)

    await page.keyboard.press(']')
    await expect(page).toHaveURL(/[?&]y=2023/)

    await page.keyboard.press('[')
    await expect(page).toHaveURL(/[?&]y=2022/)
  })
})

test.describe('Omnibar', () => {
  test('Cmd+K opens omnibar, Escape closes it', async ({ page }) => {
    await page.goto('/')
    await waitForLoad(page)

    // use-kbd binds to Meta; Playwright synthesizes metaKey on any OS
    await page.keyboard.press('Meta+k')

    // Omnibar should have an input
    const input = page.locator('input[type="text"]').first()
    await expect(input).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(input).not.toBeVisible()
  })
})

test.describe('Settings panel', () => {
  test('s toggles settings panel', async ({ page }) => {
    await page.goto('/')
    await waitForLoad(page)

    const taxYearLabel = page.getByText('Tax Year:')
    // Settings may be open by default on desktop; determine initial state
    const initiallyVisible = await taxYearLabel.isVisible()

    // First press toggles
    await page.keyboard.press('s')
    if (initiallyVisible) {
      await expect(taxYearLabel).not.toBeVisible()
    } else {
      await expect(taxYearLabel).toBeVisible()
    }

    // Second press toggles back
    await page.keyboard.press('s')
    if (initiallyVisible) {
      await expect(taxYearLabel).toBeVisible()
    } else {
      await expect(taxYearLabel).not.toBeVisible()
    }
  })
})
