import assert from 'node:assert/strict'
import test from 'node:test'
import type { SecFilingRecord } from '@chiron/shared'
import {
  buildEarningsEventGroups,
  eventGroupingRuleVersion,
  persistEarningsEventGroup,
  type EventGroupPersistenceActions,
} from './events.js'

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
  assert.equal(groups[0]?.eventStatus, 'detected')
  assert.equal(groups[0]?.originFilingId, 'earnings-release')
  assert.equal(groups[0]?.matchingStatus, 'matched')
  assert.equal(groups[0]?.matchingGapHours, 24)
  assert.deepEqual(groups[0]?.filingIds, ['earnings-release', 'quarterly-report'])
  assert.equal(groups[0]?.ruleVersion, eventGroupingRuleVersion)
})

test('creates a provisional event when an earnings release has no periodic report', () => {
  const earningsRelease = filing({
    id: 'earnings-release',
    accessionNumber: '8k-accession',
    items: ['2.02', '9.01'],
  })

  const groups = buildEarningsEventGroups([earningsRelease])

  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.periodEnd, null)
  assert.equal(groups[0]?.eventStatus, 'provisional')
  assert.equal(groups[0]?.originFilingId, 'earnings-release')
  assert.equal(groups[0]?.matchingStatus, 'unmatched')
  assert.deepEqual(groups[0]?.filingIds, ['earnings-release'])
})

test('does not match a periodic report published more than 24 hours later', () => {
  const earningsRelease = filing({
    id: 'earnings-release',
    accessionNumber: '8k-accession',
    items: ['2.02', '9.01'],
    acceptedAt: '2026-07-29T20:00:00.000Z',
  })
  const lateQuarterlyReport = filing({
    id: 'quarterly-report',
    accessionNumber: '10q-accession',
    formType: '10-Q',
    reportDate: '2026-06-30',
    acceptedAt: '2026-07-30T20:00:01.000Z',
  })

  const groups = buildEarningsEventGroups([earningsRelease, lateQuarterlyReport])

  assert.equal(groups.length, 2)
  assert.equal(groups.find((group) => group.periodEnd === null)?.matchingStatus, 'unmatched')
  assert.equal(
    groups.find((group) => group.periodEnd === '2026-06-30')?.matchingStatus,
    'periodic_only',
  )
})

test('flags an earnings release with multiple possible periodic reports as ambiguous', () => {
  const earningsRelease = filing({
    id: 'earnings-release',
    accessionNumber: '8k-accession',
    items: ['2.02', '9.01'],
    acceptedAt: '2026-07-29T20:00:00.000Z',
  })
  const firstReport = filing({
    id: 'first-report',
    accessionNumber: 'first-10q-accession',
    formType: '10-Q',
    reportDate: '2026-06-30',
    acceptedAt: '2026-07-29T22:00:00.000Z',
  })
  const secondReport = filing({
    id: 'second-report',
    accessionNumber: 'second-10k-accession',
    formType: '10-K',
    reportDate: '2026-07-01',
    acceptedAt: '2026-07-29T23:00:00.000Z',
  })

  const groups = buildEarningsEventGroups([earningsRelease, firstReport, secondReport])
  const provisionalGroup = groups.find((group) => group.periodEnd === null)

  assert.equal(groups.length, 3)
  assert.equal(provisionalGroup?.matchingStatus, 'ambiguous')
  assert.deepEqual(provisionalGroup?.matchingCandidateAccessionNumbers, [
    'first-10q-accession',
    'second-10k-accession',
  ])
})

function persistenceActions(
  completedSteps: string[],
  failingStep?: string,
): EventGroupPersistenceActions {
  const runStep = async (step: string): Promise<void> => {
    completedSteps.push(step)
    if (step === failingStep) throw new Error(`${step} failed`)
  }

  return {
    unlinkRemovedRelationships: () => runStep('unlink removed relationships'),
    linkCurrentFilings: () => runStep('link current filings'),
    linkCurrentDocuments: () => runStep('link current documents'),
    completeEarningsEvent: () => runStep('complete earnings event'),
  }
}

test('saves completed grouping metadata after every relationship update', async () => {
  const completedSteps: string[] = []

  await persistEarningsEventGroup(persistenceActions(completedSteps))

  assert.deepEqual(completedSteps, [
    'unlink removed relationships',
    'link current filings',
    'link current documents',
    'complete earnings event',
  ])
})

test('does not mark grouping complete after a relationship update fails', async () => {
  const relationshipSteps = [
    'unlink removed relationships',
    'link current filings',
    'link current documents',
  ]

  for (const failingStep of relationshipSteps) {
    const completedSteps: string[] = []

    await assert.rejects(
      persistEarningsEventGroup(persistenceActions(completedSteps, failingStep)),
      new RegExp(`${failingStep} failed`),
    )
    assert.equal(completedSteps.includes('complete earnings event'), false)
  }
})
