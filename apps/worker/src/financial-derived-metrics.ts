import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateContentSha256 } from './content-hash.js'
import {
  DatabaseTable,
  FinancialCalculationExpression,
  FinancialDerivedMetricCode,
  FinancialDerivedMetricUnit,
  FinancialMetricCode,
  RuleVersion,
  XbrlFiscalPeriod,
} from './constants.js'
import { fetchAllPages } from './pagination.js'

interface RelatedDocumentRow {
  published_at: string
}

interface RelatedEarningsEventRow {
  company_id: string
}

interface FinancialMetricExtractionRow {
  earnings_event_id: string
  source_document_id: string
  source_content_sha256: string
  fiscal_year: number | null
  fiscal_period: string | null
  created_at: string
  documents: RelatedDocumentRow | RelatedDocumentRow[]
  earnings_events: RelatedEarningsEventRow | RelatedEarningsEventRow[]
}

interface FinancialMetricRow {
  id: string
  metric_code: string
  value_numeric: string | number
  unit: string
  period_start: string
  period_end: string
  source_document_id: string
  source_content_sha256: string
}

interface CompletedCalculationRow {
  earnings_event_id: string
  input_sha256: string
}

export interface SourceFinancialMetric {
  id: string
  metricCode: string
  valueNumeric: string
  unit: string
  periodStart: string
  periodEnd: string
}

export interface FinancialPeriod {
  earningsEventId: string
  companyId: string
  fiscalYear: number
  fiscalPeriod: string
  sourceDocumentId: string
  sourceContentSha256: string
  sourcePublishedAt: string
  metrics: SourceFinancialMetric[]
}

interface FinancialCalculationInputManifest {
  currentPeriod: ReturnType<typeof periodManifest>
  previousYearPeriod: ReturnType<typeof periodManifest> | null
}

interface DerivedMetric {
  metricCode: string
  valueNumeric: string
  unit: string
  calculationExpression: string
  inputMetrics: SourceFinancialMetric[]
}

interface DerivedMetricCalculation {
  earningsEventId: string
  inputSha256: string
  inputManifest: FinancialCalculationInputManifest
  metrics: DerivedMetric[]
  warnings: string[]
}

interface DerivedMetricRecord {
  earnings_event_id: string
  metric_code: string
  value_numeric: string | number
  unit: string
  calculation_expression: string
  calculation_version: string
  input_sha256: string
  input_metrics: SourceFinancialMetric[]
}

interface DerivedMetricCalculationRecord {
  earnings_event_id: string
  calculation_version: string
  input_sha256: string
  input_manifest: FinancialCalculationInputManifest
  metric_count: number
  warnings: string[]
  output_sha256: string
}

export interface FinancialDerivedMetricCalculationSummary {
  eligibleEvents: number
  pendingEvents: number
  calculatedMetrics: number
  warnings: number
  calculationVersion: string
}

export const financialDerivedMetricCalculationVersion = RuleVersion.financialDerivedMetrics

const comparableFiscalPeriods = new Set<string>([
  XbrlFiscalPeriod.firstQuarter,
  XbrlFiscalPeriod.secondQuarter,
  XbrlFiscalPeriod.thirdQuarter,
  XbrlFiscalPeriod.fullYear,
])

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256ForJson(value: unknown): string {
  return calculateContentSha256(new TextEncoder().encode(canonicalJson(value)))
}

function singleRelation<T>(relation: T | T[]): T | null {
  return Array.isArray(relation) ? relation[0] ?? null : relation
}

function extractionKey(sourceDocumentId: string, sourceContentSha256: string): string {
  return `${sourceDocumentId}:${sourceContentSha256}`
}

function comparablePeriodKey(companyId: string, fiscalYear: number, fiscalPeriod: string): string {
  return `${companyId}:${fiscalYear}:${fiscalPeriod}`
}

function completionKey(earningsEventId: string, inputSha256: string): string {
  return `${earningsEventId}:${inputSha256}`
}

function periodManifest(period: FinancialPeriod) {
  return {
    earningsEventId: period.earningsEventId,
    companyId: period.companyId,
    fiscalYear: period.fiscalYear,
    fiscalPeriod: period.fiscalPeriod,
    sourceDocumentId: period.sourceDocumentId,
    sourceContentSha256: period.sourceContentSha256,
    sourcePublishedAt: period.sourcePublishedAt,
    financialMetricExtractionVersion: RuleVersion.financialMetricExtraction,
    metrics: period.metrics,
  }
}

function numericMetric(
  period: FinancialPeriod,
  metricCode: string,
): { metric: SourceFinancialMetric; value: number } | null {
  const metric = period.metrics.find((candidate) => candidate.metricCode === metricCode)
  if (!metric) return null

  const value = Number(metric.valueNumeric)
  return Number.isFinite(value) ? { metric, value } : null
}

function roundedCalculationValue(value: number): string {
  const roundedValue = Number(value.toFixed(6))
  return Object.is(roundedValue, -0) ? '0' : String(roundedValue)
}

function calculateNetMargin(
  period: FinancialPeriod,
): { value: number; inputs: SourceFinancialMetric[] } | null {
  const revenue = numericMetric(period, FinancialMetricCode.revenue)
  const netIncome = numericMetric(period, FinancialMetricCode.netIncome)
  if (!revenue || !netIncome || revenue.value <= 0) return null

  return {
    value: (netIncome.value / revenue.value) * 100,
    inputs: [netIncome.metric, revenue.metric],
  }
}

export function calculateFinancialDerivedMetrics(
  currentPeriod: FinancialPeriod,
  previousYearPeriod: FinancialPeriod | null,
): DerivedMetricCalculation {
  const inputManifest: FinancialCalculationInputManifest = {
    currentPeriod: periodManifest(currentPeriod),
    previousYearPeriod: previousYearPeriod ? periodManifest(previousYearPeriod) : null,
  }
  const inputSha256 = sha256ForJson(inputManifest)
  const metrics: DerivedMetric[] = []
  const warnings: string[] = []

  const currentRevenue = numericMetric(currentPeriod, FinancialMetricCode.revenue)
  const currentNetMargin = calculateNetMargin(currentPeriod)
  if (currentNetMargin) {
    metrics.push({
      metricCode: FinancialDerivedMetricCode.netMarginPercent,
      valueNumeric: roundedCalculationValue(currentNetMargin.value),
      unit: FinancialDerivedMetricUnit.percent,
      calculationExpression: FinancialCalculationExpression.netMarginPercent,
      inputMetrics: currentNetMargin.inputs,
    })
  } else {
    warnings.push('Current-period revenue and net income are required to calculate net margin')
  }

  if (!previousYearPeriod) {
    warnings.push('No financial period from the same fiscal period one year earlier is available')
    return {
      earningsEventId: currentPeriod.earningsEventId,
      inputSha256,
      inputManifest,
      metrics,
      warnings,
    }
  }

  const previousRevenue = numericMetric(previousYearPeriod, FinancialMetricCode.revenue)
  if (currentRevenue && previousRevenue && previousRevenue.value > 0) {
    metrics.push({
      metricCode: FinancialDerivedMetricCode.revenueGrowthYearOverYearPercent,
      valueNumeric: roundedCalculationValue(
        ((currentRevenue.value - previousRevenue.value) / previousRevenue.value) * 100,
      ),
      unit: FinancialDerivedMetricUnit.percent,
      calculationExpression: FinancialCalculationExpression.revenueGrowthYearOverYearPercent,
      inputMetrics: [currentRevenue.metric, previousRevenue.metric],
    })
  } else {
    warnings.push('Current and previous-year positive revenue are required to calculate revenue growth')
  }

  const previousNetMargin = calculateNetMargin(previousYearPeriod)
  if (currentNetMargin && previousNetMargin) {
    metrics.push({
      metricCode: FinancialDerivedMetricCode.netMarginChangeYearOverYearPercentagePoints,
      valueNumeric: roundedCalculationValue(currentNetMargin.value - previousNetMargin.value),
      unit: FinancialDerivedMetricUnit.percentagePoints,
      calculationExpression:
        FinancialCalculationExpression.netMarginChangeYearOverYearPercentagePoints,
      inputMetrics: [...currentNetMargin.inputs, ...previousNetMargin.inputs],
    })
  } else {
    warnings.push(
      'Current and previous-year revenue and net income are required to calculate margin change',
    )
  }

  return {
    earningsEventId: currentPeriod.earningsEventId,
    inputSha256,
    inputManifest,
    metrics,
    warnings,
  }
}

function isLaterExtraction(
  candidate: FinancialMetricExtractionRow,
  selected: FinancialMetricExtractionRow,
): boolean {
  const candidateDocument = singleRelation(candidate.documents)
  const selectedDocument = singleRelation(selected.documents)
  if (!candidateDocument || !selectedDocument) return false
  if (candidateDocument.published_at !== selectedDocument.published_at) {
    return candidateDocument.published_at > selectedDocument.published_at
  }
  if (candidate.created_at !== selected.created_at) return candidate.created_at > selected.created_at
  return candidate.source_document_id > selected.source_document_id
}

async function loadFinancialPeriods(client: SupabaseClient): Promise<FinancialPeriod[]> {
  const [extractions, financialMetrics] = await Promise.all([
    fetchAllPages<FinancialMetricExtractionRow>(
      async (from, to) => {
        const { data, error } = await client
          .from(DatabaseTable.financialMetricExtractions)
          .select(`
            earnings_event_id,
            source_document_id,
            source_content_sha256,
            fiscal_year,
            fiscal_period,
            created_at,
            documents!inner(published_at),
            earnings_events!inner(company_id)
          `)
          .eq('extraction_version', RuleVersion.financialMetricExtraction)
          .order('earnings_event_id')
          .order('created_at')
          .range(from, to)

        return { data: data as unknown as FinancialMetricExtractionRow[] | null, error }
      },
      'Could not load financial metric extractions for derived calculations',
    ),
    fetchAllPages<FinancialMetricRow>(
      async (from, to) => {
        const { data, error } = await client
          .from(DatabaseTable.financialMetrics)
          .select(`
            id,
            metric_code,
            value_numeric,
            unit,
            period_start,
            period_end,
            source_document_id,
            source_content_sha256
          `)
          .eq('extraction_version', RuleVersion.financialMetricExtraction)
          .in('metric_code', [FinancialMetricCode.revenue, FinancialMetricCode.netIncome])
          .order('source_document_id')
          .order('metric_code')
          .range(from, to)

        return { data, error }
      },
      'Could not load source metrics for derived calculations',
    ),
  ])

  const latestExtractionByEvent = new Map<string, FinancialMetricExtractionRow>()
  for (const extraction of extractions) {
    if (
      extraction.fiscal_year === null
      || !extraction.fiscal_period
      || !comparableFiscalPeriods.has(extraction.fiscal_period)
    ) continue

    const selected = latestExtractionByEvent.get(extraction.earnings_event_id)
    if (!selected || isLaterExtraction(extraction, selected)) {
      latestExtractionByEvent.set(extraction.earnings_event_id, extraction)
    }
  }

  const metricsByExtraction = new Map<string, SourceFinancialMetric[]>()
  for (const metric of financialMetrics) {
    const key = extractionKey(metric.source_document_id, metric.source_content_sha256)
    const metrics = metricsByExtraction.get(key) ?? []
    metrics.push({
      id: metric.id,
      metricCode: metric.metric_code,
      valueNumeric: String(metric.value_numeric),
      unit: metric.unit,
      periodStart: metric.period_start,
      periodEnd: metric.period_end,
    })
    metricsByExtraction.set(key, metrics)
  }

  return [...latestExtractionByEvent.values()].flatMap((extraction) => {
    const document = singleRelation(extraction.documents)
    const event = singleRelation(extraction.earnings_events)
    if (!document || !event || extraction.fiscal_year === null || !extraction.fiscal_period) {
      return []
    }

    const key = extractionKey(extraction.source_document_id, extraction.source_content_sha256)
    const metrics = [...(metricsByExtraction.get(key) ?? [])]
      .sort((left, right) => left.metricCode.localeCompare(right.metricCode))

    return [{
      earningsEventId: extraction.earnings_event_id,
      companyId: event.company_id,
      fiscalYear: extraction.fiscal_year,
      fiscalPeriod: extraction.fiscal_period,
      sourceDocumentId: extraction.source_document_id,
      sourceContentSha256: extraction.source_content_sha256,
      sourcePublishedAt: document.published_at,
      metrics,
    }]
  })
}

async function loadCompletedCalculationKeys(client: SupabaseClient): Promise<Set<string>> {
  const completedCalculations = await fetchAllPages<CompletedCalculationRow>(
    async (from, to) => {
      const { data, error } = await client
        .from(DatabaseTable.financialDerivedMetricCalculations)
        .select('earnings_event_id,input_sha256')
        .eq('calculation_version', financialDerivedMetricCalculationVersion)
        .order('earnings_event_id')
        .order('input_sha256')
        .range(from, to)

      return { data, error }
    },
    'Could not load completed financial derived metric calculations',
  )

  return new Set(
    completedCalculations.map(
      (calculation) => completionKey(calculation.earnings_event_id, calculation.input_sha256),
    ),
  )
}

function derivedMetricRecord(calculation: DerivedMetricCalculation, metric: DerivedMetric) {
  return {
    earnings_event_id: calculation.earningsEventId,
    metric_code: metric.metricCode,
    value_numeric: metric.valueNumeric,
    unit: metric.unit,
    calculation_expression: metric.calculationExpression,
    calculation_version: financialDerivedMetricCalculationVersion,
    input_sha256: calculation.inputSha256,
    input_metrics: metric.inputMetrics,
  }
}

function derivedMetricRecordsMatch(
  expected: DerivedMetricRecord,
  stored: DerivedMetricRecord,
): boolean {
  return expected.earnings_event_id === stored.earnings_event_id
    && expected.metric_code === stored.metric_code
    && Number(expected.value_numeric) === Number(stored.value_numeric)
    && expected.unit === stored.unit
    && expected.calculation_expression === stored.calculation_expression
    && expected.calculation_version === stored.calculation_version
    && expected.input_sha256 === stored.input_sha256
    && canonicalJson(expected.input_metrics) === canonicalJson(stored.input_metrics)
}

async function saveAndVerifyDerivedMetrics(
  client: SupabaseClient,
  calculation: DerivedMetricCalculation,
): Promise<void> {
  const expectedRecords = calculation.metrics.map(
    (metric) => derivedMetricRecord(calculation, metric),
  )
  if (expectedRecords.length > 0) {
    const { error } = await client
      .from(DatabaseTable.financialDerivedMetrics)
      .upsert(expectedRecords, {
        onConflict: 'earnings_event_id,calculation_version,input_sha256,metric_code',
        ignoreDuplicates: true,
      })
    if (error) {
      throw new Error(
        `Could not save derived metrics for event ${calculation.earningsEventId}: ${error.message}`,
      )
    }
  }

  const { data, error } = await client
    .from(DatabaseTable.financialDerivedMetrics)
    .select(`
      earnings_event_id,
      metric_code,
      value_numeric,
      unit,
      calculation_expression,
      calculation_version,
      input_sha256,
      input_metrics
    `)
    .eq('earnings_event_id', calculation.earningsEventId)
    .eq('calculation_version', financialDerivedMetricCalculationVersion)
    .eq('input_sha256', calculation.inputSha256)
    .order('metric_code')
  if (error) {
    throw new Error(
      `Could not verify derived metrics for event ${calculation.earningsEventId}: ${error.message}`,
    )
  }

  const storedRecords = (data ?? []) as DerivedMetricRecord[]
  const sortedExpectedRecords = [...expectedRecords]
    .sort((left, right) => left.metric_code.localeCompare(right.metric_code))
  if (
    storedRecords.length !== sortedExpectedRecords.length
    || sortedExpectedRecords.some(
      (expected, index) => !derivedMetricRecordsMatch(expected, storedRecords[index]!),
    )
  ) {
    throw new Error(`Stored derived metrics do not match event ${calculation.earningsEventId}`)
  }
}

function calculationRecordsMatch(
  expected: DerivedMetricCalculationRecord,
  stored: DerivedMetricCalculationRecord,
): boolean {
  return expected.earnings_event_id === stored.earnings_event_id
    && expected.calculation_version === stored.calculation_version
    && expected.input_sha256 === stored.input_sha256
    && canonicalJson(expected.input_manifest) === canonicalJson(stored.input_manifest)
    && expected.metric_count === Number(stored.metric_count)
    && canonicalJson(expected.warnings) === canonicalJson(stored.warnings)
    && expected.output_sha256 === stored.output_sha256
}

async function saveAndVerifyCalculation(
  client: SupabaseClient,
  calculation: DerivedMetricCalculation,
): Promise<void> {
  const output = { metrics: calculation.metrics, warnings: calculation.warnings }
  const expectedRecord: DerivedMetricCalculationRecord = {
    earnings_event_id: calculation.earningsEventId,
    calculation_version: financialDerivedMetricCalculationVersion,
    input_sha256: calculation.inputSha256,
    input_manifest: calculation.inputManifest,
    metric_count: calculation.metrics.length,
    warnings: calculation.warnings,
    output_sha256: sha256ForJson(output),
  }

  const { error } = await client
    .from(DatabaseTable.financialDerivedMetricCalculations)
    .upsert(expectedRecord, {
      onConflict: 'earnings_event_id,calculation_version,input_sha256',
      ignoreDuplicates: true,
    })
  if (error) {
    throw new Error(
      `Could not complete derived metric calculation for event `
      + `${calculation.earningsEventId}: ${error.message}`,
    )
  }

  const { data, error: verificationError } = await client
    .from(DatabaseTable.financialDerivedMetricCalculations)
    .select(`
      earnings_event_id,
      calculation_version,
      input_sha256,
      input_manifest,
      metric_count,
      warnings,
      output_sha256
    `)
    .eq('earnings_event_id', calculation.earningsEventId)
    .eq('calculation_version', financialDerivedMetricCalculationVersion)
    .eq('input_sha256', calculation.inputSha256)
    .single()
  if (verificationError) {
    throw new Error(
      `Could not verify derived metric calculation for event `
      + `${calculation.earningsEventId}: ${verificationError.message}`,
    )
  }
  if (!calculationRecordsMatch(expectedRecord, data as DerivedMetricCalculationRecord)) {
    throw new Error(
      `Stored derived metric calculation does not match event ${calculation.earningsEventId}`,
    )
  }
}

export async function calculateAndStoreFinancialDerivedMetrics(
  client: SupabaseClient,
): Promise<FinancialDerivedMetricCalculationSummary> {
  const [periods, completedCalculationKeys] = await Promise.all([
    loadFinancialPeriods(client),
    loadCompletedCalculationKeys(client),
  ])
  const periodsByComparableIdentity = new Map<string, FinancialPeriod>()
  for (const period of periods) {
    const identity = comparablePeriodKey(
      period.companyId,
      period.fiscalYear,
      period.fiscalPeriod,
    )
    const existingPeriod = periodsByComparableIdentity.get(identity)
    if (existingPeriod && existingPeriod.earningsEventId !== period.earningsEventId) {
      throw new Error(
        `Events ${existingPeriod.earningsEventId} and ${period.earningsEventId} `
        + `share financial period ${period.fiscalYear} ${period.fiscalPeriod}`,
      )
    }
    periodsByComparableIdentity.set(identity, period)
  }
  const calculations = periods.map((currentPeriod) => {
    const previousYearPeriod = periodsByComparableIdentity.get(
      comparablePeriodKey(
        currentPeriod.companyId,
        currentPeriod.fiscalYear - 1,
        currentPeriod.fiscalPeriod,
      ),
    ) ?? null
    return calculateFinancialDerivedMetrics(currentPeriod, previousYearPeriod)
  })
  const pendingCalculations = calculations.filter(
    (calculation) => !completedCalculationKeys.has(
      completionKey(calculation.earningsEventId, calculation.inputSha256),
    ),
  )

  let calculatedMetrics = 0
  let warningCount = 0
  for (const calculation of pendingCalculations) {
    await saveAndVerifyDerivedMetrics(client, calculation)
    await saveAndVerifyCalculation(client, calculation)
    calculatedMetrics += calculation.metrics.length
    warningCount += calculation.warnings.length
  }

  return {
    eligibleEvents: periods.length,
    pendingEvents: pendingCalculations.length,
    calculatedMetrics,
    warnings: warningCount,
    calculationVersion: financialDerivedMetricCalculationVersion,
  }
}
