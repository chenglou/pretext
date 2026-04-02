import { expect, test } from '@playwright/test'

const FIRST_THOUGHT =
  "Men's public restrooms are laid out all wrong. It should be urinal, stall, urinal, stall, urinal instead of urinal, urinal, urinal, stall, stall."
const LAST_THOUGHT = 'ELI5: What exactly is "time blindness" and how is it an actual thing?'

test.beforeEach(async ({ request, context }) => {
  await request.post('/api/thoughts/reset')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
})

test.describe('masonry page', () => {
  test('serves the full SQLite-backed dataset through the API', async ({ request }) => {
    const response = await request.get('/api/thoughts')
    expect(response.ok()).toBeTruthy()

    const thoughts = await response.json()
    expect(thoughts).toHaveLength(1904)
    expect(thoughts[0].body).toBe(FIRST_THOUGHT)
    expect(thoughts.at(-1).body).toBe(LAST_THOUGHT)
    expect(thoughts[0].isFavorite).toBeFalsy()
    expect(thoughts[0].isHidden).toBeFalsy()
  })

  test('loads cards and removes the loading indicator', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('loading-indicator')).toBeVisible()
    await expect(page.getByTestId('masonry-card').first()).toContainText(FIRST_THOUGHT)
    await expect(page.getByTestId('loading-indicator')).toHaveCount(0)

    const root = page.getByTestId('masonry-root')
    await expect(root).toHaveAttribute('data-card-count', '1904')
    await expect(root).toHaveAttribute('data-column-count', /[2-9]/)
  })

  test('favorite action persists and the favorites filter works', async ({ page }) => {
    await page.goto('/')

    const firstCard = page.getByTestId('masonry-card').first()
    await expect(firstCard).toContainText(FIRST_THOUGHT)
    await firstCard.getByRole('button', { name: 'Add to favorites' }).click()

    await expect(page.getByTestId('status-message')).toContainText('Added to favorites')
    await expect(firstCard).toHaveAttribute('data-favorite', 'true')

    await page.reload()
    const reloadedCard = page.getByTestId('masonry-card').first()
    await expect(reloadedCard).toHaveAttribute('data-favorite', 'true')

    await page.getByTestId('filter-favorites').click()
    await expect(page.getByTestId('masonry-root')).toHaveAttribute('data-card-count', '1')
    await expect(page.getByTestId('masonry-card')).toHaveCount(1)
    await expect(page.getByTestId('masonry-card').first()).toContainText(FIRST_THOUGHT)
  })

  test('copy and permalink actions work on a card', async ({ page }) => {
    await page.goto('/')

    const firstCard = page.getByTestId('masonry-card').first()
    await firstCard.getByRole('button', { name: 'Copy thought' }).click()
    await expect(page.getByTestId('status-message')).toContainText('Thought copied')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(FIRST_THOUGHT)

    await firstCard.getByRole('button', { name: 'Copy permalink' }).click()
    await expect(page.getByTestId('status-message')).toContainText('Permalink copied')
    await expect(page).toHaveURL(/#thought-1$/)
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(`${page.url().replace(/#thought-1$/, '')}#thought-1`)
  })

  test('hide action removes a thought and reset hidden restores it', async ({ page }) => {
    await page.goto('/')

    const root = page.getByTestId('masonry-root')
    await expect(root).toHaveAttribute('data-card-count', '1904')

    const firstCard = page.getByTestId('masonry-card').first()
    await firstCard.getByRole('button', { name: 'Hide thought' }).click()

    await expect(page.getByTestId('status-message')).toContainText('Thought hidden')
    await expect(root).toHaveAttribute('data-card-count', '1903')
    await expect(page.getByTestId('reset-hidden')).not.toBeDisabled()
    await expect(page.locator('body')).not.toContainText(FIRST_THOUGHT)

    await page.getByTestId('reset-hidden').click()
    await expect(page.getByTestId('status-message')).toContainText('Hidden thoughts restored')
    await expect(root).toHaveAttribute('data-card-count', '1904')
    await expect(page.getByTestId('masonry-card').first()).toContainText(FIRST_THOUGHT)
  })

  test('uses a single column on narrow mobile widths', async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 })
    await page.goto('/')

    const root = page.getByTestId('masonry-root')
    await expect(page.getByTestId('masonry-card').first()).toBeVisible()
    await expect(root).toHaveAttribute('data-column-count', '1')

    const leftValues = await page.locator('[data-testid="masonry-card"]').evaluateAll(nodes =>
      nodes.slice(0, 6).map(node => window.getComputedStyle(node).left),
    )
    expect(new Set(leftValues).size).toBe(1)
  })

  test('spreads cards across multiple columns on desktop widths', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await page.goto('/')

    const root = page.getByTestId('masonry-root')
    await expect(page.getByTestId('masonry-card').first()).toBeVisible()
    await expect(root).toHaveAttribute('data-column-count', /[2-9]/)

    const leftValues = await page.locator('[data-testid="masonry-card"]').evaluateAll(nodes =>
      nodes.slice(0, 8).map(node => window.getComputedStyle(node).left),
    )
    expect(new Set(leftValues).size).toBeGreaterThan(1)
  })

  test('virtualizes offscreen cards while keeping later content reachable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1200 })
    await page.goto('/')

    await expect(page.getByTestId('masonry-card').first()).toBeVisible()

    const initialRenderedCount = await page.getByTestId('masonry-card').count()
    expect(initialRenderedCount).toBeLessThan(120)

    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })

    await page.waitForFunction(
      firstThought => !document.body.innerText.includes(firstThought),
      FIRST_THOUGHT,
    )
    await page.waitForFunction(lastThought => document.body.innerText.includes(lastThought), LAST_THOUGHT)

    const laterRenderedCount = await page.getByTestId('masonry-card').count()
    expect(laterRenderedCount).toBeLessThan(140)
  })
})
