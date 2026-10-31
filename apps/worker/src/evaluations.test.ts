import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEvaluationHorizon } from './evaluations.js'

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
