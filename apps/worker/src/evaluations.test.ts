import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type EvaluationPreview,
  parseEvaluationHorizon,
  prepareEvaluationSnapshot,
} from './evaluations.js'

test('accepts only the supported evaluation horizons', () => {
  assert.equal(parseEvaluationHorizon('1'), 1)
  assert.equal(parseEvaluationHorizon('5'), 5)
  assert.equal(parseEvaluationHorizon('20'), 20)
})

test('rejects unsupported or malformed evaluation horizons', () => {
  for (const value of ['0', '2', 'five', '20.5', '']) {
    assert.throws(
      () => parseEvaluationHorizon(value),
      /must be 1, 5, or 20 trading days/,
    )
  }
})

function readyPreview(): EvaluationPreview {
  const stockInstrument = {
    id: 'instrument-amzn',
    symbol: 'AMZN',
    instrument_type: 'company_stock',
    provider_name: 'tiingo',
    provider_symbol: 'AMZN',
  }
  const marketInstrument = {
    id: 'instrument-spy',
    symbol: 'SPY',
    instrument_type: 'market_benchmark',
    provider_name: 'tiingo',
    provider_symbol: 'SPY',
  }
  const sectorInstrument = {
    id: 'instrument-xly',
    symbol: 'XLY',
    instrument_type: 'sector_benchmark',
    provider_name: 'tiingo',
    provider_symbol: 'XLY',
  }
  const observation = (
    id: string,
    instrumentId: string,
    adjustedOpenPrice: number,
    adjustedClosePrice: number,
  ) => ({
    id,
    price_instrument_id: instrumentId,
    trading_date: '2026-11-02',
    adjusted_open_price: adjustedOpenPrice,
    adjusted_close_price: adjustedClosePrice,
    observation_sha256: id.padEnd(64, '0'),
    fetched_at: '2026-11-03T02:15:00.000Z',
    created_at: '2026-11-03T02:15:01.000Z',
  })

  return {
    writesDatabase: false,
    status: 'ready',
    predictionId: 'prediction-amzn',
    predictionSnapshotFingerprint: 'a'.repeat(64),
    ticker: 'AMZN',
    horizonDays: 1,
    methodologyVersion: 'adjusted-open-to-adjusted-close-v1',
    calculatedAt: '2026-11-03T02:20:00.000Z',
    entrySession: '2026-11-02',
    exitSession: '2026-11-02',
    reasons: [],
    stock: {
      instrument: stockInstrument,
      entryObservation: observation('stock-entry', stockInstrument.id, 100, 105),
      exitObservation: observation('stock-exit', stockInstrument.id, 100, 105),
    },
    marketBenchmark: {
      assignment: {
        id: 'assignment-market',
        benchmark_instrument_id: marketInstrument.id,
        benchmark_role: 'market',
        mapping_version: 'benchmark-proxy-v1',
        applicable_from: '2026-10-29',
        created_at: '2026-10-29T12:00:00.000Z',
      },
      instrument: marketInstrument,
      entryObservation: observation('market-entry', marketInstrument.id, 200, 204),
      exitObservation: observation('market-exit', marketInstrument.id, 200, 204),
    },
    sectorBenchmark: {
      assignment: {
        id: 'assignment-sector',
        benchmark_instrument_id: sectorInstrument.id,
        benchmark_role: 'sector',
        mapping_version: 'benchmark-proxy-v1',
        applicable_from: '2026-10-29',
        created_at: '2026-10-29T12:00:00.000Z',
      },
      instrument: sectorInstrument,
      entryObservation: observation('sector-entry', sectorInstrument.id, 50, 50.5),
      exitObservation: observation('sector-exit', sectorInstrument.id, 50, 50.5),
    },
    returns: {
      stock: { entryPrice: 100, exitPrice: 105, returnFraction: 0.05 },
      marketBenchmark: { entryPrice: 200, exitPrice: 204, returnFraction: 0.02 },
      sectorBenchmark: { entryPrice: 50, exitPrice: 50.5, returnFraction: 0.01 },
      stockMinusMarketReturn: 0.03,
      stockMinusSectorReturn: 0.04,
    },
  }
}

test('creates a deterministic fingerprint from complete ready evaluation evidence', () => {
  const first = prepareEvaluationSnapshot(readyPreview())
  const repeated = prepareEvaluationSnapshot(readyPreview())

  assert.deepEqual(repeated, first)
  assert.equal(first.snapshot.schemaVersion, 'evaluation-snapshot-v1')
  assert.equal(first.fingerprint.length, 64)
})

test('changes the evaluation fingerprint when a frozen result changes', () => {
  const original = readyPreview()
  const changed = readyPreview()
  changed.returns = {
    ...changed.returns!,
    stockMinusMarketReturn: 0.031,
  }

  assert.notEqual(
    prepareEvaluationSnapshot(original).fingerprint,
    prepareEvaluationSnapshot(changed).fingerprint,
  )
})

test('refuses to prepare a snapshot from a not-ready evaluation', () => {
  const preview = readyPreview()
  preview.status = 'not_ready'
  preview.reasons = ['The exit price is missing']

  assert.throws(
    () => prepareEvaluationSnapshot(preview),
    /The exit price is missing/,
  )
})
