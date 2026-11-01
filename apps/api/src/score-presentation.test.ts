import assert from 'node:assert/strict'
import test from 'node:test'
import { presentScoreBreakdown } from './score-presentation.js'

test('presents approved score fields and calculates category totals', () => {
  const breakdown = presentScoreBreakdown([
    {
      code: 'revenue_growth',
      category: 'financial',
      points: 1,
      explanation: 'Revenue growth was positive.',
      input: { privateInternalValue: 12 },
    },
    {
      code: 'key_risks',
      category: 'qualitative',
      points: -1,
      explanation: 'A material risk was identified.',
      input: { claimCount: 1 },
    },
  ])

  assert.deepEqual(breakdown, {
    financialScore: 1,
    qualitativeScore: -1,
    uncappedCombinedScore: 0,
    scoreComponents: [
      {
        code: 'revenue_growth',
        category: 'financial',
        points: 1,
        explanation: 'Revenue growth was positive.',
      },
      {
        code: 'key_risks',
        category: 'qualitative',
        points: -1,
        explanation: 'A material risk was identified.',
      },
    ],
  })
})

test('rejects malformed score components instead of returning misleading details', () => {
  assert.throws(
    () => presentScoreBreakdown([{ code: 'revenue_growth', points: 1 }]),
    /invalid category/,
  )
})
