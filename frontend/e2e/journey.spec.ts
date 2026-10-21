import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('full journey with the retail sample: preview → quality → analyse → report → export', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /turn a spreadsheet/i })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('01-home.png'), fullPage: true })

  await page.getByRole('button', { name: 'Load sample: Retail sales (CSV)' }).click()

  // 1. Preview
  await expect(page.getByLabel('Data preview table')).toBeVisible()
  await expect(page.getByText('First 50 of 725 rows')).toBeVisible()

  // 2. Quality
  await page.getByRole('tab', { name: '2. Data quality' }).click()
  await expect(page.getByText(/5 row\(s\) are exact duplicates/)).toBeVisible()
  await expect(page.getByText(/'unit_price' has 3 value\(s\) that are not a valid number/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('02-quality.png'), fullPage: true })

  // 3. Analyse with the suggested defaults (sum of first measure + row count, by month)
  await page.getByRole('tab', { name: '3. Analyse' }).click()
  await page.getByLabel('Column 1').selectOption('revenue')
  await page.getByLabel('Group by').selectOption('region')
  await page.getByRole('button', { name: 'Run analysis' }).click()

  // Independently verified total (see backend/tests/test_samples.py): ₹16,45,592.43 in en-IN grouping.
  await expect(page.getByText('16,45,592.43').first()).toBeVisible()
  await expect(page.getByRole('img', { name: /bar chart of sum of revenue/i })).toBeVisible()
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.getByLabel('Grouped results table').first()).toBeVisible()
  await page.getByRole('button', { name: 'Bar', exact: true }).click()
  await page.screenshot({ path: testInfo.outputPath('03-dashboard.png'), fullPage: true })

  // AI is off by default and the dashboard still works
  await expect(page.getByText('AI commentary is turned off on this server.')).toBeVisible()

  // 4. Report & exports
  await page.getByRole('tab', { name: '4. Report & export' }).click()
  await expect(page.getByRole('heading', { name: 'Key figures' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('04-report.png'), fullPage: true })

  const resultsDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download results (CSV)' }).click()
  const results = await resultsDownload
  expect(results.suggestedFilename()).toBe('tabulavibe_results.csv')
  const resultsText = await readFile(await results.path(), 'utf-8')
  expect(resultsText.split('\r\n')[0]).toBe('﻿region,row_count,Sum of revenue,Number of rows')

  await page.getByLabel('Remove duplicate rows from cleaned data').check()
  const cleanedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download cleaned data (CSV)' }).click()
  const cleaned = await cleanedDownload
  const cleanedLines = (await readFile(await cleaned.path(), 'utf-8')).trim().split('\r\n')
  expect(cleanedLines).toHaveLength(721) // header + 725 rows - 5 duplicates
  await expect(page.getByText('Downloaded 720 rows; 5 duplicate row(s) removed.')).toBeVisible()
})

test('Excel sample groups by month and offers a line chart', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load sample: Salon bookings (Excel)' }).click()
  await page.getByRole('tab', { name: '3. Analyse' }).click()
  await page.getByRole('button', { name: 'Run analysis' }).click()
  await expect(page.getByRole('img', { name: /line chart of sum of amount \(inr\) over time/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Donut', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Why is the donut chart unavailable?' }).click()
  await expect(page.getByText('Pie charts are not used for time periods')).toBeVisible()
})

test('unsupported and invalid files show a clear error', async ({ page }) => {
  await page.goto('/')
  await page.locator('#file-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(page.getByRole('alert')).toContainText('not a supported file')

  await page.locator('#file-input').setInputFiles({ name: 'fake.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('a,b\n1,2\n') })
  await expect(page.getByRole('alert')).toContainText('does not contain a valid .xlsx workbook')

  await page.locator('#file-input').setInputFiles({ name: 'header-only.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b,c\n') })
  await expect(page.getByRole('alert')).toContainText('no data rows')
})
