import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BenchmarkRole,
  PriceInstrumentType,
} from './constants.js'
import {
  formatWatchlistValidationReport,
  validateWatchlist,
  type WatchlistValidationInput,
} from './watchlist-validation.js'

function completeWatchlist(): WatchlistValidationInput {
  return {
    companies: [{
      id: 'company-amzn',
      cik: '0001018724',
      legalName: 'Amazon.com, Inc.',
      ticker: 'AMZN',
      exchange: 'NASDAQ',
      sector: 'Consumer',
    }],
    priceInstruments: [
      {
        id: 'stock-amzn',
        companyId: 'company-amzn',
        symbol: 'AMZN',
        instrumentType: PriceInstrumentType.companyStock,
        providerName: 'tiingo',
        providerSymbol: 'AMZN',
        currency: 'USD',
        isActive: true,
      },
      {
        id: 'benchmark-spy',
        companyId: null,
        symbol: 'SPY',
        instrumentType: PriceInstrumentType.marketBenchmark,
        providerName: 'tiingo',
        providerSymbol: 'SPY',
        currency: 'USD',
        isActive: true,
      },
      {
        id: 'benchmark-xly',
        companyId: null,
        symbol: 'XLY',
        instrumentType: PriceInstrumentType.sectorBenchmark,
        providerName: 'tiingo',
        providerSymbol: 'XLY',
        currency: 'USD',
        isActive: true,
      },
      {
        id: 'benchmark-old-sector',
        companyId: null,
        symbol: 'OLD',
        instrumentType: PriceInstrumentType.sectorBenchmark,
        providerName: 'tiingo',
        providerSymbol: 'OLD',
        currency: 'USD',
        isActive: false,
      },
    ],
    benchmarkAssignments: [
      {
        id: 'market-assignment',
        companyId: 'company-amzn',
        benchmarkInstrumentId: 'benchmark-spy',
        benchmarkRole: BenchmarkRole.market,
        mappingVersion: 'benchmark-proxy-v1',
        applicableFrom: '2026-10-29',
        rationale: 'SPY is the broad-market research proxy.',
        createdAt: '2026-10-29T10:00:00.000Z',
      },
      {
        id: 'old-sector-assignment',
        companyId: 'company-amzn',
        benchmarkInstrumentId: 'benchmark-old-sector',
        benchmarkRole: BenchmarkRole.sector,
        mappingVersion: 'benchmark-proxy-v0',
        applicableFrom: '2026-01-01',
        rationale: 'An older historical mapping.',
        createdAt: '2026-01-01T10:00:00.000Z',
      },
      {
        id: 'sector-assignment',
        companyId: 'company-amzn',
        benchmarkInstrumentId: 'benchmark-xly',
        benchmarkRole: BenchmarkRole.sector,
        mappingVersion: 'benchmark-proxy-v1',
        applicableFrom: '2026-10-29',
        rationale: 'XLY is the consumer-discretionary research proxy.',
        createdAt: '2026-10-29T10:00:00.000Z',
      },
    ],
  }
}

test('accepts one complete company and selects its latest applicable mappings', () => {
  const report = validateWatchlist(completeWatchlist(), '2026-11-01')

  assert.equal(report.passed, true)
  assert.equal(report.companyCount, 1)
  assert.equal(report.stockInstrumentCount, 1)
  assert.equal(report.marketAssignmentCount, 1)
  assert.equal(report.sectorAssignmentCount, 1)
  assert.equal(report.companies[0]?.marketBenchmarkSymbol, 'SPY')
  assert.equal(report.companies[0]?.sectorBenchmarkSymbol, 'XLY')
  assert.deepEqual(report.companies[0]?.errors, [])
})

test('reports incomplete company and benchmark configuration without changing input', () => {
  const input = completeWatchlist()
  input.companies[0] = {
    ...input.companies[0]!,
    cik: '1018724',
    exchange: null,
  }
  input.priceInstruments = []
  input.benchmarkAssignments = []

  const report = validateWatchlist(input, '2026-11-01')

  assert.equal(report.passed, false)
  assert.deepEqual(report.companies[0]?.errors, [
    'CIK must contain exactly 10 digits',
    'Exchange is missing',
    'Expected exactly one active stock instrument, found 0',
    'Missing applicable market benchmark assignment',
    'Missing applicable sector benchmark assignment',
  ])
})

test('reports active stock instruments that do not belong to the active watchlist', () => {
  const input = completeWatchlist()
  input.priceInstruments.push({
    id: 'stock-inactive-company',
    companyId: 'inactive-company',
    symbol: 'OLDCO',
    instrumentType: PriceInstrumentType.companyStock,
    providerName: 'tiingo',
    providerSymbol: 'OLDCO',
    currency: 'USD',
    isActive: true,
  })

  const report = validateWatchlist(input, '2026-11-01')

  assert.equal(report.passed, false)
  assert.deepEqual(report.configurationErrors, [
    'Active stock instrument OLDCO does not belong to an active company',
  ])
  assert.match(formatWatchlistValidationReport(report), /Watchlist validation failed/)
})
