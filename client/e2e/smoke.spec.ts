import { test, expect } from '@playwright/test'

test.describe('auth flow', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/')
    // Ожидаем форму входа или редирект на /auth
    await expect(
      page.locator('input[type="password"], input[name="password"]')
    ).toBeVisible({ timeout: 10_000 })
  })

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/')
    // Вводим неверные данные
    const usernameInput = page
      .locator('input[type="text"], input[name="username"]')
      .first()
    const passwordInput = page.locator('input[type="password"]').first()
    await usernameInput.fill('nonexistent_user_xyz')
    await passwordInput.fill('wrongpassword123')
    await page.keyboard.press('Enter')
    // Ожидаем сообщение об ошибке
    await expect(
      page.locator('[class*="error"], [role="alert"]')
    ).toBeVisible({ timeout: 5_000 })
  })
})

test.describe('setup page', () => {
  test('/setup page is accessible', async ({ page }) => {
    await page.goto('/setup')
    await expect(page).toHaveURL(/setup/)
  })
})
