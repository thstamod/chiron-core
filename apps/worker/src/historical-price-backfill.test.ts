import assert from 'node:assert/strict'
import test from 'node:test'
import {
  historicalPriceBackfillRequestRange,
  selectMissingHistoricalPriceDates,
} from './historical-price-backfill.js'

test('backfills only closed frozen sessions without a post-close observation', () => {
  const result = selectMissingHistoricalPriceDates({
    checkedAt: '2026-11-07T12:00:00.000Z',
    sessions: [
      { session_date: '2026-11-05', closes_at: '2026-11-05T21:00:00.000Z' },
      { session_date: '2026-11-06', closes_at: '2026-11-06T21:00:00.000Z' },
      { session_date: '2026-11-09', closes_at: '2026-11-09T21:00:00.000Z' },
    ],
    observations: [{
      price_instrument_id: 'instrument',
      trading_date: '2026-11-06',
      fetched_at: '2026-11-07T02:00:00.000Z',
      created_at: '2026-11-07T02:00:01.000Z',
    }],
  })

  assert.deepEqual(result, {
    closedDates: ['2026-11-05', '2026-11-06'],
    futureDates: ['2026-11-09'],
    missingDates: ['2026-11-05'],
  })
})

test('expands one missing date because Tiingo rejects a single-day range', () => {
  assert.deepEqual(historicalPriceBackfillRequestRange(['2026-08-05'], '2026-11-07'), {
    startDate: '2026-08-05',
    endDate: '2026-08-06',
  })
  assert.deepEqual(
    historicalPriceBackfillRequestRange(['2026-08-05', '2026-08-11'], '2026-11-07'),
    { startDate: '2026-08-05', endDate: '2026-08-11' },
  )
  assert.deepEqual(historicalPriceBackfillRequestRange(['2026-11-07'], '2026-11-07'), {
    startDate: '2026-11-06',
    endDate: '2026-11-07',
  })
})
