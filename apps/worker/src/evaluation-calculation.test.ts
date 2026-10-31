import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateEvaluationReturns } from './evaluation-calculation.js'

test('calculates adjusted open-to-close returns and benchmark differences', () => {
  const result = calculateEvaluationReturns({
    stock: {
      adjustedEntryOpenPrice: '100',
      adjustedExitClosePrice: '105',
    },
    marketBenchmark: {
      adjustedEntryOpenPrice: '200',
      adjustedExitClosePrice: '204',
    },
    sectorBenchmark: {
      adjustedEntryOpenPrice: '50',
      adjustedExitClosePrice: '50.5',
    },
  })

  assert.deepEqual(result, {
    stock: { entryPrice: 100, exitPrice: 105, returnFraction: 0.05 },
    marketBenchmark: { entryPrice: 200, exitPrice: 204, returnFraction: 0.02 },
    sectorBenchmark: { entryPrice: 50, exitPrice: 50.5, returnFraction: 0.01 },
    stockMinusMarketReturn: 0.03,
    stockMinusSectorReturn: 0.04,
  })
})

test('supports an unavailable sector benchmark without inventing a return', () => {
  const result = calculateEvaluationReturns({
    stock: {
      adjustedEntryOpenPrice: 100,
      adjustedExitClosePrice: 95,
    },
    marketBenchmark: {
      adjustedEntryOpenPrice: 100,
      adjustedExitClosePrice: 98,
    },
    sectorBenchmark: null,
  })

  assert.equal(result.stock.returnFraction, -0.05)
  assert.equal(result.marketBenchmark.returnFraction, -0.02)
  assert.equal(result.stockMinusMarketReturn, -0.03)
  assert.equal(result.sectorBenchmark, null)
  assert.equal(result.stockMinusSectorReturn, null)
})

test('rounds stored return fractions to the versioned precision', () => {
  const result = calculateEvaluationReturns({
    stock: {
      adjustedEntryOpenPrice: 3,
      adjustedExitClosePrice: 4,
    },
    marketBenchmark: {
      adjustedEntryOpenPrice: 7,
      adjustedExitClosePrice: 8,
    },
    sectorBenchmark: null,
  })

  assert.equal(result.stock.returnFraction, 0.333333333333)
  assert.equal(result.marketBenchmark.returnFraction, 0.142857142857)
  assert.equal(result.stockMinusMarketReturn, 0.190476190476)
})

test('rejects missing, non-numeric, zero, and negative prices', () => {
  const validBenchmark = {
    adjustedEntryOpenPrice: 100,
    adjustedExitClosePrice: 101,
  }

  for (const invalidPrice of ['', 'not-a-number', 0, -1]) {
    assert.throws(
      () => calculateEvaluationReturns({
        stock: {
          adjustedEntryOpenPrice: invalidPrice,
          adjustedExitClosePrice: 101,
        },
        marketBenchmark: validBenchmark,
        sectorBenchmark: null,
      }),
      /positive finite number/,
    )
  }
})
