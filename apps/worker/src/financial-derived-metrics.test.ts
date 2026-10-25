import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FinancialDerivedMetricCode,
  FinancialMetricCode,
  FinancialUnit,
  XbrlFiscalPeriod,
} from './constants.js'
import {
  calculateFinancialDerivedMetrics,
  type FinancialPeriod,
  type SourceFinancialMetric,
} from './financial-derived-metrics.js'

function sourceMetric(
  id: string,
  metricCode: string,
  valueNumeric: string,
): SourceFinancialMetric {
  return {
    id,
    metricCode,
    valueNumeric,
    unit: FinancialUnit.unitedStatesDollar,
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
  }
}

function financialPeriod(
  earningsEventId: string,
  fiscalYear: number,
  revenue: string,
  netIncome: string,
): FinancialPeriod {
  return {
    earningsEventId,
    companyId: 'company-1',
    fiscalYear,
    fiscalPeriod: XbrlFiscalPeriod.firstQuarter,
    sourceDocumentId: `document-${fiscalYear}`,
    sourceContentSha256: `hash-${fiscalYear}`,
    sourcePublishedAt: `${fiscalYear}-04-20T20:00:00.000Z`,
    metrics: [
      sourceMetric(`revenue-${fiscalYear}`, FinancialMetricCode.revenue, revenue),
      sourceMetric(`net-income-${fiscalYear}`, FinancialMetricCode.netIncome, netIncome),
    ],
  }
}

test('calculates revenue growth, net margin, and margin change', () => {
  const currentPeriod = financialPeriod('event-2026', 2026, '120', '24')
  const previousYearPeriod = financialPeriod('event-2025', 2025, '100', '15')

  const result = calculateFinancialDerivedMetrics(currentPeriod, previousYearPeriod)
  const values = new Map(result.metrics.map((metric) => [metric.metricCode, metric.valueNumeric]))

  assert.equal(values.get(FinancialDerivedMetricCode.revenueGrowthYearOverYearPercent), '20')
  assert.equal(values.get(FinancialDerivedMetricCode.netMarginPercent), '20')
  assert.equal(
    values.get(FinancialDerivedMetricCode.netMarginChangeYearOverYearPercentagePoints),
    '5',
  )
  assert.deepEqual(result.warnings, [])
})

test('still calculates current net margin when the previous year is unavailable', () => {
  const currentPeriod = financialPeriod('event-2026', 2026, '120', '24')

  const result = calculateFinancialDerivedMetrics(currentPeriod, null)

  assert.equal(result.metrics.length, 1)
  assert.equal(result.metrics[0]?.metricCode, FinancialDerivedMetricCode.netMarginPercent)
  assert.equal(result.warnings.length, 1)
})
