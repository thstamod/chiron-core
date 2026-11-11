import type { QualitativeQualityReport } from './qualitative-quality-report.js'

function formatRate(value: number | null): string {
  return value === null ? 'not enough data' : `${(value * 100).toFixed(1)}%`
}

function formatCountMap(counts: Record<string, number>): string[] {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  return entries.length > 0
    ? entries.map(([name, count]) => `- ${name}: ${count}`)
    : ['- none']
}

function formatAgreement(
  label: string,
  metric: { agreeingRuns: number; eligibleRuns: number; agreementRate: number | null },
): string {
  return `${label}: ${metric.agreeingRuns}/${metric.eligibleRuns} (${formatRate(metric.agreementRate)})`
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

export function formatQualitativeQualityReport(
  report: QualitativeQualityReport,
  scope: string,
): string {
  const fieldAgreement = report.humanReview.fieldAgreement
  const tokenTotals = report.efficiency.tokens.totalsFromCompleteRuns
  const cost = report.efficiency.estimatedCost
  const lines = [
    'Qualitative extraction quality report',
    '',
    `Scope: ${scope}`,
    `Extraction attempts: ${report.sample.totalRuns}`,
    '',
    'Provider outcomes:',
    ...formatCountMap(report.sample.providerStatusCounts),
    '',
    'Models:',
    ...formatCountMap(report.sample.modelCounts),
    '',
    'Prompt versions:',
    ...formatCountMap(report.sample.promptVersionCounts),
    '',
    'Schema versions:',
    ...formatCountMap(report.sample.schemaVersionCounts),
    '',
    'Technical quality:',
    `Schema-valid results: ${report.technicalQuality.schema.validRuns}`
      + `/${report.technicalQuality.schema.assessedRuns}`
      + ` (${formatRate(report.technicalQuality.schema.validityRate)})`,
    `Evidence-valid results: ${report.technicalQuality.evidence.validRuns}`
      + `/${report.technicalQuality.evidence.assessedRuns}`
      + ` (${formatRate(report.technicalQuality.evidence.validityRate)})`,
    '',
    'Latest human reviews:',
    `- accepted: ${report.sample.latestReviewCounts.accepted}`,
    `- corrected: ${report.sample.latestReviewCounts.corrected}`,
    `- rejected: ${report.sample.latestReviewCounts.rejected}`,
    `- unreviewed: ${report.sample.latestReviewCounts.unreviewed}`,
    'Correction frequency among accepted/corrected reviews: '
      + formatRate(report.humanReview.correctionFrequency),
    '',
    'Strict agreement with reviewed reference:',
    formatAgreement('Entire output', report.humanReview.exactOutputAgreement),
    formatAgreement('Guidance', fieldAgreement.guidance),
    formatAgreement('Margin direction', fieldAgreement.marginDirection),
    formatAgreement('Management tone', fieldAgreement.managementTone),
    formatAgreement('Key positives', fieldAgreement.keyPositives),
    formatAgreement('Key risks', fieldAgreement.keyRisks),
    '',
    'Repeated-run consistency:',
    `Exact-match groups: ${report.consistency.exactMatchGroups}`
      + `/${report.consistency.repeatedConfigurationGroups}`
      + ` (${formatRate(report.consistency.exactMatchRate)})`,
    '',
    'Efficiency:',
    `Average latency: ${report.efficiency.latency.averageMilliseconds === null
      ? 'not enough data'
      : `${report.efficiency.latency.averageMilliseconds.toFixed(0)} ms`}`,
    `Maximum latency: ${report.efficiency.latency.maximumMilliseconds === null
      ? 'not enough data'
      : `${report.efficiency.latency.maximumMilliseconds.toFixed(0)} ms`}`,
    `Complete token-usage rows: ${report.efficiency.tokens.runsWithCompleteUsage}`,
    `Incomplete token-usage rows: ${report.efficiency.tokens.runsWithIncompleteUsage}`,
    `Input tokens: ${formatInteger(tokenTotals.inputTokens)}`,
    `Cached input tokens: ${formatInteger(tokenTotals.cachedInputTokens)}`,
    `Cache-write tokens: ${formatInteger(tokenTotals.cacheWriteTokens)}`,
    `Output tokens: ${formatInteger(tokenTotals.outputTokens)}`,
    `Reasoning tokens included within output: ${formatInteger(tokenTotals.reasoningTokens)}`,
    `Provider-reported total tokens: ${formatInteger(tokenTotals.totalTokens)}`,
    '',
  ]

  if (cost.pricingProfile === null) {
    lines.push('Estimated cost: not calculated because no pricing profile was supplied')
  } else {
    lines.push(
      `Pricing profile: ${cost.pricingProfile.name} as of ${cost.pricingProfile.asOfDate}`,
      `Pricing source: ${cost.pricingProfile.sourceUrl}`,
      `Priced runs: ${cost.pricedRuns}`,
      `Unpriced runs: ${cost.unpricedRuns}`,
      `Estimated cost: ${cost.totalUsd === null ? 'not enough data' : `$${cost.totalUsd.toFixed(6)}`}`,
    )
  }

  lines.push(
    '',
    'This measurement report does not approve automated extraction or a paid historical backfill.',
  )
  return lines.join('\n')
}
