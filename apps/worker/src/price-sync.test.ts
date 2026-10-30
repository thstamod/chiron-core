import assert from 'node:assert/strict'
import test from 'node:test'
import { PriceDataProvider } from './constants.js'
import type {
  DailyPriceObservation,
  PriceInstrument,
} from './price-observations.js'
import {
  dailyPriceRequestStartDate,
  subtractCalendarDays,
  syncTiingoDailyPrices,
} from './price-sync.js'
import type {
  TiingoDailyPrice,
  TiingoDailyPriceRequest,
} from './tiingo-price-client.js'

const instrument: PriceInstrument = {
  id: 'instrument-aapl',
  companyId: 'company-apple',
  symbol: 'AAPL',
  instrumentType: 'company_stock',
  providerName: PriceDataProvider.tiingo,
  providerSymbol: 'AAPL',
  currency: 'USD',
}

const price: TiingoDailyPrice = {
  tradingDate: '2026-10-29',
  openPrice: 270,
  highPrice: 275,
  lowPrice: 269,
  closePrice: 274,
  volume: 50_000_000,
  adjustedOpenPrice: 270,
  adjustedHighPrice: 275,
  adjustedLowPrice: 269,
  adjustedClosePrice: 274,
  adjustedVolume: 50_000_000,
  dividendCash: 0,
  splitFactor: 1,
}

test('subtracts calendar days across month boundaries in UTC', () => {
  assert.equal(subtractCalendarDays('2026-11-03', 7), '2026-10-27')
})

test('uses the bootstrap and overlap windows', () => {
  assert.equal(dailyPriceRequestStartDate(null, '2026-10-30'), '2026-08-01')
  assert.equal(
    dailyPriceRequestStartDate('2026-10-29', '2026-10-30'),
    '2026-10-22',
  )
})

test('runs one sequential provider request and saves validated observations', async () => {
  const requestedProviders: string[] = []
  const requests: TiingoDailyPriceRequest[] = []
  const saved: DailyPriceObservation[][] = []
  const completedSymbols: string[] = []

  const summary = await syncTiingoDailyPrices({
    loadActiveInstruments: async (providerName) => {
      requestedProviders.push(providerName)
      return [instrument]
    },
    loadLatestTradingDate: async () => '2026-10-29',
    fetchDailyPrices: async (request) => {
      requests.push(request)
      return [price]
    },
    saveChangedObservations: async (observations) => {
      saved.push(observations)
      return observations.length
    },
    now: () => new Date('2026-10-30T02:15:00.000Z'),
    onInstrumentCompleted: ({ symbol }) => completedSymbols.push(symbol),
  })

  assert.deepEqual(requestedProviders, [PriceDataProvider.tiingo])
  assert.deepEqual(requests, [{
    providerSymbol: 'AAPL',
    startDate: '2026-10-22',
    endDate: '2026-10-30',
  }])
  assert.equal(saved[0]?.[0]?.fetchedAt, '2026-10-30T02:15:00.000Z')
  assert.deepEqual(completedSymbols, ['AAPL'])
  assert.deepEqual(summary, {
    providerName: PriceDataProvider.tiingo,
    instrumentsChecked: 1,
    requestsMade: 1,
    initialBackfills: 0,
    pricesReceived: 1,
    observationsInserted: 1,
    endDate: '2026-10-30',
    overlapCalendarDays: 7,
    initialLookbackCalendarDays: 90,
  })
})

test('does not call persistence when the provider returns no trading days', async () => {
  let saveCalls = 0
  const summary = await syncTiingoDailyPrices({
    loadActiveInstruments: async () => [instrument],
    loadLatestTradingDate: async () => null,
    fetchDailyPrices: async () => [],
    saveChangedObservations: async () => {
      saveCalls += 1
      return 0
    },
    now: () => new Date('2026-11-01T02:15:00.000Z'),
  })

  assert.equal(saveCalls, 0)
  assert.equal(summary.initialBackfills, 1)
  assert.equal(summary.requestsMade, 1)
  assert.equal(summary.pricesReceived, 0)
})

test('rejects a latest stored trading date in the future', () => {
  assert.throws(
    () => dailyPriceRequestStartDate('2026-10-31', '2026-10-30'),
    /after sync end date/,
  )
})
