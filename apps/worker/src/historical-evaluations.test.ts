import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type HistoricalEvaluationPreview,
  historicalEvaluationExitSession,
  prepareHistoricalEvaluationSnapshot,
} from './historical-evaluations.js'

const plannedSessions = {
  planned_day_1_session: '2026-10-01',
  planned_day_5_session: '2026-10-07',
  planned_day_20_session: '2026-10-28',
}

test('selects the frozen historical exit session for every supported horizon', () => {
  assert.equal(historicalEvaluationExitSession(plannedSessions, 1), '2026-10-01')
  assert.equal(historicalEvaluationExitSession(plannedSessions, 5), '2026-10-07')
  assert.equal(historicalEvaluationExitSession(plannedSessions, 20), '2026-10-28')
})

function readyHistoricalEvaluationPreview(): HistoricalEvaluationPreview {
  const observation = (id: string, instrumentId: string, open: number, close: number) => ({
    id,
    price_instrument_id: instrumentId,
    trading_date: '2026-10-01',
    adjusted_open_price: open,
    adjusted_close_price: close,
    observation_sha256: id.padEnd(64, '0'),
    fetched_at: '2026-10-02T02:00:00.000Z',
    created_at: '2026-10-02T02:00:01.000Z',
  })
  const stockInstrument = {
    id: 'stock', symbol: 'TEST', instrument_type: 'company_stock',
    provider_name: 'tiingo', provider_symbol: 'TEST',
  }
  const marketInstrument = {
    id: 'market', symbol: 'SPY', instrument_type: 'market_benchmark',
    provider_name: 'tiingo', provider_symbol: 'SPY',
  }
  const sectorInstrument = {
    id: 'sector', symbol: 'XLK', instrument_type: 'sector_benchmark',
    provider_name: 'tiingo', provider_symbol: 'XLK',
  }
  const assignment = (id: string, instrumentId: string, role: 'market' | 'sector') => ({
    id,
    benchmark_instrument_id: instrumentId,
    benchmark_role: role,
    mapping_version: 'benchmark-proxy-historical-2026-v1',
    applicable_from: '2026-01-01',
    created_at: '2026-11-07T18:05:14.000Z',
  })
  return {
    writesDatabase: false,
    status: 'ready',
    reconstructionMode: 'retrospective',
    historicalPredictionId: 'historical-prediction',
    historicalPredictionSnapshotFingerprint: 'a'.repeat(64),
    ticker: 'TEST',
    experimentVersion: 'historical-pilot-v1',
    featureSetVersion: 'qualitative-only-v1',
    simulatedCutoffAt: '2026-09-30T20:00:00.000Z',
    horizonDays: 1,
    methodologyVersion: 'adjusted-open-to-adjusted-close-v1',
    reconstructionRuleVersion: 'retrospective-price-and-benchmark-reconstruction-v1',
    calculatedAt: '2026-11-08T10:00:00.000Z',
    entrySession: '2026-10-01',
    exitSession: '2026-10-01',
    reasons: [],
    stock: {
      instrument: stockInstrument,
      entryObservation: observation('stock-entry', stockInstrument.id, 100, 105),
      exitObservation: observation('stock-exit', stockInstrument.id, 100, 105),
    },
    marketBenchmark: {
      assignment: assignment('market-assignment', marketInstrument.id, 'market'),
      instrument: marketInstrument,
      entryObservation: observation('market-entry', marketInstrument.id, 200, 202),
      exitObservation: observation('market-exit', marketInstrument.id, 200, 202),
    },
    sectorBenchmark: {
      assignment: assignment('sector-assignment', sectorInstrument.id, 'sector'),
      instrument: sectorInstrument,
      entryObservation: observation('sector-entry', sectorInstrument.id, 50, 51),
      exitObservation: observation('sector-exit', sectorInstrument.id, 50, 51),
    },
    returns: {
      stock: { entryPrice: 100, exitPrice: 105, returnFraction: 0.05 },
      marketBenchmark: { entryPrice: 200, exitPrice: 202, returnFraction: 0.01 },
      sectorBenchmark: { entryPrice: 50, exitPrice: 51, returnFraction: 0.02 },
      stockMinusMarketReturn: 0.04,
      stockMinusSectorReturn: 0.03,
    },
  }
}

test('prepares a deterministic historical evaluation snapshot', () => {
  const first = prepareHistoricalEvaluationSnapshot(readyHistoricalEvaluationPreview())
  const repeated = prepareHistoricalEvaluationSnapshot(readyHistoricalEvaluationPreview())

  assert.deepEqual(repeated, first)
  assert.equal(first.snapshot.schemaVersion, 'historical-evaluation-snapshot-v1')
  assert.equal(first.fingerprint.length, 64)
})

test('refuses to prepare an incomplete historical evaluation', () => {
  const preview = readyHistoricalEvaluationPreview()
  preview.status = 'not_ready'
  preview.reasons = ['The exit session has not closed']

  assert.throws(
    () => prepareHistoricalEvaluationSnapshot(preview),
    /exit session has not closed/,
  )
})
