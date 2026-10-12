import assert from 'node:assert/strict'
import test from 'node:test'
import type { SecFilingRecord } from '@chiron/shared'
import { buildEarningsEventGroups, eventGroupingRuleVersion } from './events.js'

function filing(overrides: Partial<SecFilingRecord>): SecFilingRecord {
  return {
    id: 'filing-id',
    companyId: 'company-id',
    cik: '0000789019',
    ticker: 'MSFT',
    accessionNumber: 'accession',
    formType: '8-K',
    filingDate: '2026-07-29',
    acceptedAt: '2026-07-29T20:00:00.000Z',
    firstSeenAt: '2026-07-29T20:05:00.000Z',
    reportDate: '2026-07-29',
    primaryDocument: 'filing.htm',
    items: [],
    secIndexUrl: 'https://www.sec.gov/filing-index.htm',
    earningsClassification: null,
    exhibitDiscoveryVersion: null,
    earningsEventId: null,
    ...overrides,
  }
}

test('groups a nearby item 2.02 filing with its periodic report', () => {
  const quarterlyReport = filing({
    id: 'quarterly-report',
    accessionNumber: '10q-accession',
    formType: '10-Q',
    reportDate: '2026-06-30',
    acceptedAt: '2026-07-30T20:00:00.000Z',
  })
  const earningsRelease = filing({
    id: 'earnings-release',
    accessionNumber: '8k-accession',
    items: ['2.02', '9.01'],
  })
  const unrelatedCurrentReport = filing({
    id: 'unrelated',
    accessionNumber: 'unrelated-accession',
    items: ['5.02'],
  })

  const groups = buildEarningsEventGroups([
    quarterlyReport,
    earningsRelease,
    unrelatedCurrentReport,
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.periodEnd, '2026-06-30')
  assert.deepEqual(groups[0]?.filingIds, ['earnings-release', 'quarterly-report'])
  assert.equal(groups[0]?.ruleVersion, eventGroupingRuleVersion)
})
