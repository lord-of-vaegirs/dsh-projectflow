#!/usr/bin/env node
/**
 * Read-only GUI smoke test for a running DSH Web instance.
 *
 * Usage:
 *   node scripts/gui-smoke.mjs 'http://127.0.0.1:3080/?token=...'
 *
 * Override CHROME_PATH when Chrome is not at the macOS default. Exits non-zero
 * on a missing panel, a client error, or a failed Details query.
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const url = process.argv[2]
if (!url) {
  console.error('usage: node scripts/gui-smoke.mjs <DSH web URL with token>')
  process.exit(2)
}
const chromePath = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(chromePath)) {
  console.error(`Chrome not found at ${chromePath}; set CHROME_PATH`)
  process.exit(2)
}

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(String(error)))

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 })
  await page.waitForTimeout(2_200)
  const continueButton = page.getByRole('button', { name: '继续' })
  if (await continueButton.count()) {
    await continueButton.first().click()
    await page.waitForTimeout(700)
  }
  const entry = page.locator('button[title="项目工作区"]')
  if (await entry.count() !== 1) throw new Error('project workspace entry not found')
  await entry.first().click()
  await page.waitForTimeout(1_800)
  if (await page.getByRole('heading', { name: '项目工作区' }).count() !== 1) {
    throw new Error('project workspace panel heading not found')
  }
  const details = page.getByRole('button', { name: '详情' })
  if (await details.count() > 0) {
    await details.first().click()
    await page.waitForTimeout(1_500)
  }
  const body = await page.locator('body').innerText()
  if (!body.includes('新建项目')) throw new Error('create action missing')
  if (body.includes('操作失败')) throw new Error('panel reported an operation failure')
  if (errors.length > 0) throw new Error(`client errors: ${errors.slice(0, 3).join(' | ')}`)
  console.log('GUI smoke passed: project workspace entry, panel, and details rendered')
} finally {
  await browser.close()
}
