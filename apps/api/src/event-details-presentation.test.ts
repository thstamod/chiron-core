import assert from 'node:assert/strict'
import test from 'node:test'
import {
  presentDerivedFinancialMetric,
  presentReportedFinancialMetric,
  presentSourceDocument,
} from './event-details-presentation.js'

test('presents audited source documents and exact financial decimal values', () => {
  const document = presentSourceDocument({
    id: 'document-id',
    document_type: 'sec-primary-document',
    source_url: 'https://www.sec.gov/Archives/edgar/data/1/report.htm',
    published_at: '2026-10-29T20:05:27.000Z',
    first_seen_at: '2026-10-29T21:49:05.510Z',
    content_sha256: 'a'.repeat(64),
    content_size_bytes: '12345',
  })
  const reportedMetric = presentReportedFinancialMetric({
    id: 'reported-metric-id',
    metric_code: 'revenue',
    value_numeric: '201944000000.00',
    unit: 'USD',
    accounting_basis: 'gaap',
    period_start: '2026-07-01',
    period_end: '2026-09-30',
    source_document_id: 'document-id',
    extraction_version: 'sec-xbrl-financial-metrics-v1',
    xbrl_concept: 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
    source_text: '201944',
    created_at: '2026-10-30T12:00:00.000Z',
  })
  const derivedMetric = presentDerivedFinancialMetric({
    id: 'derived-metric-id',
    metric_code: 'revenue_growth_year_over_year_percent',
    value_numeric: '12.078',
    unit: 'percent',
    calculation_expression: '((current_revenue - previous_year_revenue) / previous_year_revenue) * 100',
    calculation_version: 'financial-derived-metrics-v1',
    created_at: '2026-10-30T12:05:00.000Z',
  })

  assert.equal(document.contentSizeBytes, 12_345)
  assert.equal(document.sourceUrl, 'https://www.sec.gov/Archives/edgar/data/1/report.htm')
  assert.equal(reportedMetric.value, '201944000000.00')
  assert.equal(derivedMetric.value, '12.078')
})

test('rejects untrusted source links and malformed financial values', () => {
  assert.throws(
    () => presentSourceDocument({
      id: 'document-id',
      document_type: 'sec-primary-document',
      source_url: 'https://example.com/report.htm',
      published_at: '2026-10-29T20:05:27.000Z',
      first_seen_at: '2026-10-29T21:49:05.510Z',
      content_sha256: 'a'.repeat(64),
      content_size_bytes: 100,
    }),
    /not an approved SEC archive URL/,
  )
  assert.throws(
    () => presentDerivedFinancialMetric({
      id: 'derived-metric-id',
      metric_code: 'net_margin_percent',
      value_numeric: 'not-a-number',
      unit: 'percent',
      calculation_expression: 'current_net_income / current_revenue',
      calculation_version: 'financial-derived-metrics-v1',
      created_at: '2026-10-30T12:05:00.000Z',
    }),
    /invalid numeric value/,
  )
})
