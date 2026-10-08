import assert from 'node:assert/strict'
import test from 'node:test'
import type { TrackedCompany } from '@chiron/shared'
import {
  buildSecIndexUrl,
  buildSecPrimaryDocumentUrl,
  classifyEarningsFiling,
  parseRecentFilings,
} from './sec.js'

const company: TrackedCompany = {
  id: 'company-id',
  cik: '0000789019',
  legalName: 'Microsoft Corporation',
  ticker: 'MSFT',
  exchange: 'NASDAQ',
  sector: 'Technology',
  isActive: true,
}

test('builds an official SEC archive URL', () => {
  assert.equal(
    buildSecIndexUrl(company.cik, '0001193125-26-123456'),
    'https://www.sec.gov/Archives/edgar/data/789019/000119312526123456/0001193125-26-123456-index.html',
  )
})

test('builds an official SEC primary-document URL', () => {
  assert.equal(
    buildSecPrimaryDocumentUrl(company.cik, '0000789019-26-000001', 'msft-20260920.htm'),
    'https://www.sec.gov/Archives/edgar/data/789019/000078901926000001/msft-20260920.htm',
  )
})

test('classifies periodic reports and item 2.02 current reports as earnings-related', () => {
  const timestamp = '2026-10-04T12:00:00.000Z'

  assert.equal(classifyEarningsFiling('10-Q', [], timestamp).category, 'periodic_report')
  assert.equal(classifyEarningsFiling('8-K', ['2.02', '9.01'], timestamp).category, 'earnings_release')
  assert.equal(classifyEarningsFiling('8-K', ['5.02'], timestamp).isEarningsRelated, false)
})

test('keeps supported filings inside the lookback period', () => {
  const filings = parseRecentFilings(company, {
    filings: {
      recent: {
        accessionNumber: ['0000789019-26-000001', '0000789019-24-000002'],
        filingDate: ['2026-09-20', '2024-04-01'],
        reportDate: ['2026-09-19', '2024-03-31'],
        acceptanceDateTime: ['2026-09-20T20:10:00.000', '2024-04-01T10:00:00.000'],
        form: ['8-K', '4'],
        primaryDocument: ['msft-8k.htm', 'ownership.xml'],
        primaryDocDescription: ['Current report', 'Ownership report'],
        items: ['2.02,9.01', ''],
      },
    },
  }, '2025-09-29')

  assert.equal(filings.length, 1)
  assert.deepEqual(filings[0]?.items, ['2.02', '9.01'])
  assert.equal(filings[0]?.acceptedAt, '2026-09-20T20:10:00.000Z')
})
