import assert from 'node:assert/strict'
import test from 'node:test'
import { SecForm } from './constants.js'
import {
  extractFinancialMetricsFromInlineXbrl,
  financialMetricExtractionVersion,
  normalizeXbrlNumericValue,
} from './xbrl.js'

const units = `
  <xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
  <xbrli:unit id="usdPerShare">
    <xbrli:divide>
      <xbrli:unitnumerator><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unitnumerator>
      <xbrli:unitdenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitdenominator>
    </xbrli:divide>
  </xbrli:unit>
`

function durationContext(
  id: string,
  startDate: string,
  endDate: string,
  dimension = '',
): string {
  return `
    <xbrli:context id="${id}">
      <xbrli:entity><xbrli:identifier scheme="test">company</xbrli:identifier>${dimension}</xbrli:entity>
      <xbrli:period>
        <xbrli:startdate>${startDate}</xbrli:startdate>
        <xbrli:enddate>${endDate}</xbrli:enddate>
      </xbrli:period>
    </xbrli:context>
  `
}

function numericFact(
  concept: string,
  contextReference: string,
  unitReference: string,
  value: string,
  scale = '0',
): string {
  return `<ix:nonfraction name="${concept}" contextref="${contextReference}" unitref="${unitReference}" scale="${scale}">${value}</ix:nonfraction>`
}

test('normalizes inline XBRL scale, decimals, and negative signs without floating-point math', () => {
  assert.equal(normalizeXbrlNumericValue('64,601', '6', undefined, undefined), '64601000000')
  assert.equal(normalizeXbrlNumericValue('0.05', '0', undefined, undefined), '0.05')
  assert.equal(normalizeXbrlNumericValue('12.5', '-2', '-', undefined), '-0.125')
  assert.equal(normalizeXbrlNumericValue('—', '0', undefined, 'ixt:zero-dash'), '0')
})

test('extracts the shortest consolidated period from a quarterly report', () => {
  const segment = '<xbrli:segment><xbrldi:explicitmember dimension="test:Segment">test:Cloud</xbrldi:explicitmember></xbrli:segment>'
  const html = `
    <html><body>
      ${durationContext('quarter', '2026-04-01', '2026-06-30')}
      ${durationContext('yearToDate', '2026-01-01', '2026-06-30')}
      ${durationContext('segment', '2026-04-01', '2026-06-30', segment)}
      ${units}
      <ix:nonnumeric name="dei:DocumentFiscalYearFocus">2026</ix:nonnumeric>
      <ix:nonnumeric name="dei:DocumentFiscalPeriodFocus">Q2</ix:nonnumeric>
      ${numericFact('us-gaap:Revenues', 'quarter', 'usd', '120', '6')}
      ${numericFact('us-gaap:Revenues', 'quarter', 'usd', '120', '6')}
      ${numericFact('us-gaap:Revenues', 'yearToDate', 'usd', '225', '6')}
      ${numericFact('us-gaap:Revenues', 'segment', 'usd', '80', '6')}
      ${numericFact('us-gaap:NetIncomeLoss', 'quarter', 'usd', '30', '6')}
      ${numericFact('us-gaap:EarningsPerShareBasic', 'quarter', 'usdPerShare', '2.10')}
      ${numericFact('us-gaap:EarningsPerShareDiluted', 'quarter', 'usdPerShare', '2.05')}
    </body></html>
  `

  const result = extractFinancialMetricsFromInlineXbrl(
    html,
    SecForm.quarterlyReport,
    '2026-06-30',
  )

  assert.equal(result.extractionVersion, financialMetricExtractionVersion)
  assert.equal(result.fiscalYear, 2026)
  assert.equal(result.fiscalPeriod, 'Q2')
  assert.equal(result.periodStart, '2026-04-01')
  assert.equal(result.metrics.length, 4)
  assert.equal(result.warnings.length, 0)
  assert.deepEqual(
    result.metrics.map(({ metricCode, valueNumeric, unit }) => ({
      metricCode,
      valueNumeric,
      unit,
    })),
    [
      { metricCode: 'revenue', valueNumeric: '120000000', unit: 'USD' },
      { metricCode: 'net_income', valueNumeric: '30000000', unit: 'USD' },
      { metricCode: 'earnings_per_share_basic', valueNumeric: '2.1', unit: 'USD/share' },
      { metricCode: 'earnings_per_share_diluted', valueNumeric: '2.05', unit: 'USD/share' },
    ],
  )
  assert.equal(result.metrics[0]?.sourceText, '120')
  assert.equal(result.metrics[0]?.sourceMetadata.dimensionCount, 0)
  assert.equal(typeof result.metrics[0]?.sourceMetadata.sourceIndex, 'number')
  assert.equal(result.metrics[0]?.sourceMetadata.isHidden, false)
})

test('extracts the longest current period from an annual report', () => {
  const html = `
    <html><body>
      ${durationContext('quarter', '2026-04-01', '2026-06-30')}
      ${durationContext('year', '2025-07-01', '2026-06-30')}
      ${units}
      <ix:nonnumeric name="dei:DocumentFiscalYearFocus">2026</ix:nonnumeric>
      <ix:nonnumeric name="dei:DocumentFiscalPeriodFocus">FY</ix:nonnumeric>
      ${numericFact('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'quarter', 'usd', '90', '6')}
      ${numericFact('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'year', 'usd', '330', '6')}
      ${numericFact('us-gaap:NetIncomeLoss', 'year', 'usd', '130', '6')}
      ${numericFact('us-gaap:EarningsPerShareBasic', 'year', 'usdPerShare', '18.00')}
      ${numericFact('us-gaap:EarningsPerShareDiluted', 'year', 'usdPerShare', '17.95')}
    </body></html>
  `

  const result = extractFinancialMetricsFromInlineXbrl(
    html,
    SecForm.annualReport,
    '2026-06-30',
  )

  assert.equal(result.periodStart, '2025-07-01')
  assert.equal(result.metrics[0]?.valueNumeric, '330000000')
})

test('rejects conflicting duplicate facts instead of choosing one silently', () => {
  const html = `
    <html><body>
      ${durationContext('quarter', '2026-04-01', '2026-06-30')}
      ${units}
      <ix:nonnumeric name="dei:DocumentFiscalYearFocus">2026</ix:nonnumeric>
      <ix:nonnumeric name="dei:DocumentFiscalPeriodFocus">Q2</ix:nonnumeric>
      ${numericFact('us-gaap:Revenues', 'quarter', 'usd', '120', '6')}
      ${numericFact('us-gaap:Revenues', 'quarter', 'usd', '121', '6')}
    </body></html>
  `

  assert.throws(
    () => extractFinancialMetricsFromInlineXbrl(html, SecForm.quarterlyReport, '2026-06-30'),
    /conflicting revenue facts/i,
  )
})
