import assert from 'node:assert/strict'
import test from 'node:test'
import type { QualitativeExtraction } from '@chiron/shared'
import {
  FinancialDerivedMetricCode,
  RuleVersion,
  ScoringComponentCode,
} from './constants.js'
import { calculateTransparentEarningsScore } from './transparent-scoring.js'

function qualitativeExtraction(
  overrides: Partial<QualitativeExtraction> = {},
): QualitativeExtraction {
  return {
    guidance: {
      status: 'provided',
      items: [],
      summary: 'Guidance summary.',
      evidence: [{ passageId: 'current-p0001' }],
    },
    marginDirection: {
      direction: 'stable',
      summary: 'Margins were stable.',
      evidence: [{ passageId: 'current-p0002' }],
    },
    managementTone: {
      currentTone: 'neutral',
      changeFromPrevious: 'similar',
      summary: 'Tone was similar.',
      currentEvidence: [{ passageId: 'current-p0003' }],
      previousEvidence: [{ passageId: 'previous-p0001' }],
    },
    keyPositives: [],
    keyRisks: [],
    summary: 'Earnings summary.',
    sourceLimitations: [],
    ...overrides,
  }
}

test('caps a strongly positive combined score at plus five', () => {
  const result = calculateTransparentEarningsScore({
    financialMetrics: [
      {
        metricCode: FinancialDerivedMetricCode.revenueGrowthYearOverYearPercent,
        valueNumeric: '12.5',
      },
      {
        metricCode: FinancialDerivedMetricCode.netMarginChangeYearOverYearPercentagePoints,
        valueNumeric: '1.2',
      },
    ],
    qualitativeExtraction: qualitativeExtraction({
      guidance: {
        status: 'provided',
        items: [
          {
            metric: 'revenue',
            direction: 'raised',
            period: 'next quarter',
            summary: 'Revenue guidance increased.',
            evidence: [{ passageId: 'current-p0001' }],
          },
          {
            metric: 'operating_income',
            direction: 'raised',
            period: 'next quarter',
            summary: 'Operating-income guidance increased.',
            evidence: [{ passageId: 'current-p0002' }],
          },
        ],
        summary: 'Guidance increased.',
        evidence: [{ passageId: 'current-p0001' }],
      },
      marginDirection: {
        direction: 'improving',
        summary: 'Margins improved.',
        evidence: [{ passageId: 'current-p0003' }],
      },
      managementTone: {
        currentTone: 'positive',
        changeFromPrevious: 'more_positive',
        summary: 'Tone improved.',
        currentEvidence: [{ passageId: 'current-p0004' }],
        previousEvidence: [{ passageId: 'previous-p0001' }],
      },
      keyPositives: [{
        statement: 'Demand increased.',
        evidence: [{ passageId: 'current-p0005' }],
      }],
    }),
  })

  assert.equal(result.ruleVersion, RuleVersion.transparentEarningsScore)
  assert.equal(result.financialScore, 2)
  assert.equal(result.qualitativeScore, 5)
  assert.equal(result.uncappedCombinedScore, 7)
  assert.equal(result.score, 5)
})

test('caps a strongly negative combined score at minus five', () => {
  const result = calculateTransparentEarningsScore({
    financialMetrics: [
      {
        metricCode: FinancialDerivedMetricCode.revenueGrowthYearOverYearPercent,
        valueNumeric: -2,
      },
      {
        metricCode: FinancialDerivedMetricCode.netMarginChangeYearOverYearPercentagePoints,
        valueNumeric: -0.5,
      },
    ],
    qualitativeExtraction: qualitativeExtraction({
      guidance: {
        status: 'provided',
        items: [
          {
            metric: 'revenue',
            direction: 'lowered',
            period: 'next quarter',
            summary: 'Revenue guidance decreased.',
            evidence: [{ passageId: 'current-p0001' }],
          },
          {
            metric: 'operating_income',
            direction: 'withdrawn',
            period: 'next quarter',
            summary: 'Operating-income guidance was withdrawn.',
            evidence: [{ passageId: 'current-p0002' }],
          },
        ],
        summary: 'Guidance weakened.',
        evidence: [{ passageId: 'current-p0001' }],
      },
      marginDirection: {
        direction: 'declining',
        summary: 'Margins declined.',
        evidence: [{ passageId: 'current-p0003' }],
      },
      managementTone: {
        currentTone: 'negative',
        changeFromPrevious: 'more_negative',
        summary: 'Tone weakened.',
        currentEvidence: [{ passageId: 'current-p0004' }],
        previousEvidence: [{ passageId: 'previous-p0001' }],
      },
      keyRisks: [{
        statement: 'A material legal risk increased.',
        evidence: [{ passageId: 'current-p0005' }],
      }],
    }),
  })

  assert.equal(result.financialScore, -2)
  assert.equal(result.qualitativeScore, -5)
  assert.equal(result.uncappedCombinedScore, -7)
  assert.equal(result.score, -5)
})

test('does not infer a direction from ambiguous guidance metrics', () => {
  const result = calculateTransparentEarningsScore({
    financialMetrics: [],
    qualitativeExtraction: qualitativeExtraction({
      guidance: {
        status: 'provided',
        items: [
          {
            metric: 'capital_expenditures',
            direction: 'raised',
            period: 'full year',
            summary: 'Capital expenditures increased.',
            evidence: [{ passageId: 'current-p0001' }],
          },
          {
            metric: 'expenses',
            direction: 'lowered',
            period: 'next quarter',
            summary: 'Expense guidance decreased.',
            evidence: [{ passageId: 'current-p0002' }],
          },
          {
            metric: 'revenue',
            direction: 'introduced',
            period: 'next quarter',
            summary: 'Revenue guidance was introduced.',
            evidence: [{ passageId: 'current-p0003' }],
          },
        ],
        summary: 'Guidance was provided.',
        evidence: [{ passageId: 'current-p0001' }],
      },
    }),
  })

  const guidance = result.components.find(
    (component) => component.code === ScoringComponentCode.guidanceChange,
  )
  assert.equal(guidance?.points, 0)
  assert.deepEqual(
    (guidance?.input as { ignoredItems: unknown[] }).ignoredItems,
    [
      { metric: 'capital_expenditures', direction: 'raised' },
      { metric: 'expenses', direction: 'lowered' },
    ],
  )
})

test('uses zero points for unavailable financial comparisons', () => {
  const result = calculateTransparentEarningsScore({
    financialMetrics: [],
    qualitativeExtraction: qualitativeExtraction(),
  })

  assert.equal(result.financialScore, 0)
  assert.equal(result.score, 0)
})

test('rejects duplicate or non-numeric financial metrics', () => {
  assert.throws(
    () => calculateTransparentEarningsScore({
      financialMetrics: [
        {
          metricCode: FinancialDerivedMetricCode.revenueGrowthYearOverYearPercent,
          valueNumeric: 1,
        },
        {
          metricCode: FinancialDerivedMetricCode.revenueGrowthYearOverYearPercent,
          valueNumeric: 2,
        },
      ],
      qualitativeExtraction: qualitativeExtraction(),
    }),
    /duplicate revenue_growth_year_over_year_percent metrics/,
  )

  assert.throws(
    () => calculateTransparentEarningsScore({
      financialMetrics: [{
        metricCode: FinancialDerivedMetricCode.revenueGrowthYearOverYearPercent,
        valueNumeric: 'not-a-number',
      }],
      qualitativeExtraction: qualitativeExtraction(),
    }),
    /invalid revenue_growth_year_over_year_percent value/,
  )
})
