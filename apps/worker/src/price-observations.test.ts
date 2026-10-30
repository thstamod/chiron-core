import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDailyPriceObservations,
  type PriceInstrument,
  selectChangedDailyPriceObservations,
} from './price-observations.js'
import type { TiingoDailyPrice } from './tiingo-price-client.js'

const instrument: PriceInstrument = {
  id: 'instrument-aapl',
  companyId: 'company-apple',
  symbol: 'AAPL',
  instrumentType: 'company_stock',
  providerName: 'tiingo',
  providerSymbol: 'AAPL',
  currency: 'USD',
}

const dailyPrice: TiingoDailyPrice = {
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

test('creates a stable fingerprint from the provider identity and complete price values', () => {
  const first = createDailyPriceObservations(
    instrument,
    [dailyPrice],
    '2026-10-30T02:00:00.000Z',
  )[0]!
  const repeated = createDailyPriceObservations(
    instrument,
    [{ ...dailyPrice }],
    '2026-10-30T03:00:00.000Z',
  )[0]!

  assert.equal(first.observationSha256, repeated.observationSha256)
  assert.notEqual(first.fetchedAt, repeated.fetchedAt)
})

test('changes the fingerprint when one provider value changes', () => {
  const original = createDailyPriceObservations(
    instrument,
    [dailyPrice],
    '2026-10-30T02:00:00.000Z',
  )[0]!
  const correction = createDailyPriceObservations(
    instrument,
    [{ ...dailyPrice, adjustedClosePrice: 273.99 }],
    '2026-10-30T03:00:00.000Z',
  )[0]!

  assert.notEqual(original.observationSha256, correction.observationSha256)
})

test('keeps the same fingerprint across databases with different internal IDs', () => {
  const first = createDailyPriceObservations(
    instrument,
    [dailyPrice],
    '2026-10-30T02:00:00.000Z',
  )[0]!
  const recreated = createDailyPriceObservations(
    { ...instrument, id: 'different-database-id' },
    [dailyPrice],
    '2026-10-30T02:00:00.000Z',
  )[0]!

  assert.equal(first.observationSha256, recreated.observationSha256)
})

test('skips unchanged data but preserves a value that returns to an earlier state', () => {
  const original = createDailyPriceObservations(
    instrument,
    [dailyPrice],
    '2026-10-30T02:00:00.000Z',
  )[0]!
  const correction = createDailyPriceObservations(
    instrument,
    [{ ...dailyPrice, closePrice: 273.99 }],
    '2026-10-30T03:00:00.000Z',
  )[0]!
  const returnedToOriginal = createDailyPriceObservations(
    instrument,
    [dailyPrice],
    '2026-10-30T04:00:00.000Z',
  )[0]!

  assert.deepEqual(
    selectChangedDailyPriceObservations(
      [original],
      new Map([[original.tradingDate, original.observationSha256]]),
    ),
    [],
  )
  assert.deepEqual(
    selectChangedDailyPriceObservations(
      [returnedToOriginal],
      new Map([[correction.tradingDate, correction.observationSha256]]),
    ),
    [returnedToOriginal],
  )
})

test('rejects duplicate trading dates in one provider response', () => {
  assert.throws(
    () => createDailyPriceObservations(
      instrument,
      [dailyPrice, { ...dailyPrice }],
      '2026-10-30T02:00:00.000Z',
    ),
    /duplicate prices/,
  )
})
