import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  DatabaseTable,
  EarningsEventStatus,
  PredictionSnapshotVersion,
  RuleVersion,
} from './constants.js'
import {
  loadEffectiveQualitativeExtraction,
  type EffectiveQualitativeExtraction,
} from './effective-qualitative-extraction.js'
import {
  selectPlannedPredictionSessions,
  type PlannedPredictionSessions,
} from './reference-price-session.js'
import {
  calculateTransparentEarningsScore,
  type FinancialScoringMetric,
  type TransparentEarningsScore,
} from './transparent-scoring.js'

interface PredictionEventRow {
  id: string
  company_id: string
  period_end: string
  status: string
  detected_at: string
  companies: {
    ticker: string
    legal_name: string
  } | Array<{
    ticker: string
    legal_name: string
  }>
}

export interface FinancialCalculationRow {
  id: string
  earnings_event_id: string
  calculation_version: string
  input_sha256: string
  input_manifest: unknown
  metric_count: number
  warnings: unknown
  output_sha256: string
  created_at: string
}

export interface FinancialDerivedMetricRow {
  id: string
  metric_code: string
  value_numeric: string | number
  unit: string
  calculation_expression: string
  calculation_version: string
  input_sha256: string
  input_metrics: unknown
  created_at: string
}

export interface QualitativeRunAuditRow {
  id: string
  earnings_event_id: string
  cutoff_at: string
  input_manifest: unknown
  input_sha256: string
  input_selection_version: string
  provider_name: string
  provider_request_id: string | null
  resolved_model_name: string | null
  started_at: string
  finished_at: string
  token_usage: unknown
  created_at: string
}

export interface AvailableDocumentRow {
  id: string
  filing_id: string | null
  accession_number: string | null
  document_type: string
  source_url: string
  storage_path: string
  published_at: string
  first_seen_at: string
  content_sha256: string
  content_size_bytes: number | null
}

export interface PredictionEventSnapshot {
  id: string
  companyId: string
  ticker: string
  legalName: string
  periodEnd: string
  status: string
  detectedAt: string
}

export interface FinancialPredictionInput {
  calculation: FinancialCalculationRow
  metrics: FinancialDerivedMetricRow[]
}

export interface PredictionSnapshot {
  schemaVersion: string
  cutoffAt: string
  earningsEvent: PredictionEventSnapshot
  availableEventDocuments: AvailableDocumentRow[]
  financial: FinancialPredictionInput
  qualitative: {
    run: QualitativeRunAuditRow
    effectiveExtraction: EffectiveQualitativeExtraction
  }
  score: TransparentEarningsScore
  plannedSessions: PlannedPredictionSessions
}

export interface PredictionSnapshotInput {
  cutoffAt: string
  earningsEvent: PredictionEventSnapshot
  availableEventDocuments: AvailableDocumentRow[]
  financial: FinancialPredictionInput
  effectiveQualitativeExtraction: EffectiveQualitativeExtraction
  qualitativeRun: QualitativeRunAuditRow
  plannedSessions: PlannedPredictionSessions
}

export interface PreparedPredictionSnapshot {
  snapshot: PredictionSnapshot
  fingerprint: string
  score: TransparentEarningsScore
}

export interface PredictionCreationSummary extends Record<string, unknown> {
  predictionId: string
  earningsEventId: string
  ticker: string
  score: number
  ruleVersion: string
  cutoffAt: string
  databaseRecordedAt: string
  plannedEntrySession: string
  plannedDay1Session: string
  plannedDay5Session: string
  plannedDay20Session: string
  snapshotFingerprint: string
}

export interface PredictionPreview extends Record<string, unknown> {
  writesDatabase: false
  earningsEventId: string
  ticker: string
  cutoffAt: string
  score: number
  financialScore: number
  qualitativeScore: number
  components: TransparentEarningsScore['components']
  plannedEntrySession: string
  plannedEntryOpensAt: string
  plannedDay1Session: string
  plannedDay5Session: string
  plannedDay20Session: string
  snapshotFingerprint: string
}

interface PreparedPredictionCreation {
  cutoffAt: string
  earningsEvent: PredictionEventSnapshot
  financial: FinancialPredictionInput
  effectiveQualitativeExtraction: EffectiveQualitativeExtraction
  plannedSessions: PlannedPredictionSessions
  preparedSnapshot: PreparedPredictionSnapshot
}

function validTimestamp(value: string, description: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`${description} is not a valid timestamp`)
  return timestamp
}

function requireAvailableByCutoff(
  value: string,
  cutoffTimestamp: number,
  description: string,
): void {
  if (validTimestamp(value, description) > cutoffTimestamp) {
    throw new Error(`${description} is later than the prediction cutoff`)
  }
}

function singleRelation<T>(relation: T | T[]): T {
  const selected = Array.isArray(relation) ? relation[0] : relation
  if (!selected) throw new Error('Prediction event has no related company')
  return selected
}

async function refuseExistingPrediction(
  client: SupabaseClient,
  earningsEventId: string,
): Promise<void> {
  const { data, error } = await client
    .from(DatabaseTable.predictions)
    .select('id')
    .eq('earnings_event_id', earningsEventId)
    .eq('rule_version', RuleVersion.transparentEarningsScore)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Could not check for an existing prediction: ${error.message}`)
  if (data) {
    throw new Error(
      `Earnings event ${earningsEventId} already has prediction ${data.id} `
      + `for ${RuleVersion.transparentEarningsScore}`,
    )
  }
}

async function loadPredictionEvent(
  client: SupabaseClient,
  earningsEventId: string,
  cutoffTimestamp: number,
): Promise<PredictionEventSnapshot> {
  const { data, error } = await client
    .from(DatabaseTable.earningsEvents)
    .select('id,company_id,period_end,status,detected_at,companies!inner(ticker,legal_name)')
    .eq('id', earningsEventId)
    .single()
  if (error) throw new Error(`Could not load prediction event: ${error.message}`)

  const event = data as unknown as PredictionEventRow
  if (!event.period_end) throw new Error('Prediction event requires a confirmed reporting period')
  if ([EarningsEventStatus.groupingPending, EarningsEventStatus.provisional].includes(
    event.status as typeof EarningsEventStatus.groupingPending,
  )) {
    throw new Error(`Prediction event is not complete: ${event.status}`)
  }
  requireAvailableByCutoff(event.detected_at, cutoffTimestamp, 'Event detection timestamp')
  const company = singleRelation(event.companies)
  return {
    id: event.id,
    companyId: event.company_id,
    ticker: company.ticker,
    legalName: company.legal_name,
    periodEnd: event.period_end,
    status: event.status,
    detectedAt: new Date(event.detected_at).toISOString(),
  }
}

async function loadAvailableEventDocuments(
  client: SupabaseClient,
  earningsEventId: string,
  cutoffAt: string,
): Promise<AvailableDocumentRow[]> {
  const { data, error } = await client
    .from(DatabaseTable.documents)
    .select(
      'id,filing_id,accession_number,document_type,source_url,storage_path,published_at,'
      + 'first_seen_at,content_sha256,content_size_bytes',
    )
    .eq('earnings_event_id', earningsEventId)
    .lte('published_at', cutoffAt)
    .lte('first_seen_at', cutoffAt)
    .order('published_at')
    .order('id')
  if (error) throw new Error(`Could not load available prediction documents: ${error.message}`)
  return (data ?? []) as unknown as AvailableDocumentRow[]
}

async function loadFinancialPredictionInput(
  client: SupabaseClient,
  earningsEventId: string,
  cutoffAt: string,
): Promise<FinancialPredictionInput> {
  const { data: calculationData, error: calculationError } = await client
    .from(DatabaseTable.financialDerivedMetricCalculations)
    .select(
      'id,earnings_event_id,calculation_version,input_sha256,input_manifest,metric_count,'
      + 'warnings,output_sha256,created_at',
    )
    .eq('earnings_event_id', earningsEventId)
    .eq('calculation_version', RuleVersion.financialDerivedMetrics)
    .lte('created_at', cutoffAt)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (calculationError) {
    throw new Error(`Could not load prediction financial calculation: ${calculationError.message}`)
  }
  if (!calculationData) {
    throw new Error(`Earnings event ${earningsEventId} has no financial calculation by the cutoff`)
  }
  const calculation = calculationData as unknown as FinancialCalculationRow

  const { data: metricData, error: metricError } = await client
    .from(DatabaseTable.financialDerivedMetrics)
    .select(
      'id,metric_code,value_numeric,unit,calculation_expression,calculation_version,'
      + 'input_sha256,input_metrics,created_at',
    )
    .eq('earnings_event_id', earningsEventId)
    .eq('calculation_version', calculation.calculation_version)
    .eq('input_sha256', calculation.input_sha256)
    .lte('created_at', cutoffAt)
    .order('metric_code')
    .order('id')
  if (metricError) {
    throw new Error(`Could not load prediction financial metrics: ${metricError.message}`)
  }
  const metrics = (metricData ?? []) as unknown as FinancialDerivedMetricRow[]
  if (metrics.length !== Number(calculation.metric_count)) {
    throw new Error('Prediction financial metrics do not match their calculation record')
  }
  return { calculation, metrics }
}

function requireManifestDocumentsAvailable(
  inputManifest: unknown,
  earningsEventId: string,
  cutoffTimestamp: number,
): void {
  if (!inputManifest || typeof inputManifest !== 'object' || Array.isArray(inputManifest)) {
    throw new Error('Qualitative prediction input manifest is not an object')
  }
  const manifest = inputManifest as Record<string, unknown>
  if (manifest.earningsEventId !== earningsEventId || !Array.isArray(manifest.documents)) {
    throw new Error('Qualitative prediction input manifest does not match the earnings event')
  }
  for (const value of manifest.documents) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Qualitative prediction input manifest has an invalid document')
    }
    const document = value as Record<string, unknown>
    if (typeof document.publishedAt !== 'string' || typeof document.firstSeenAt !== 'string') {
      throw new Error('Qualitative prediction document has invalid availability timestamps')
    }
    requireAvailableByCutoff(
      document.publishedAt,
      cutoffTimestamp,
      'Qualitative document publication timestamp',
    )
    requireAvailableByCutoff(
      document.firstSeenAt,
      cutoffTimestamp,
      'Qualitative document first-seen timestamp',
    )
  }
}

function requireFinancialManifestAvailable(
  inputManifest: unknown,
  earningsEventId: string,
  cutoffTimestamp: number,
): void {
  if (!inputManifest || typeof inputManifest !== 'object' || Array.isArray(inputManifest)) {
    throw new Error('Financial prediction input manifest is not an object')
  }
  const manifest = inputManifest as Record<string, unknown>
  const periods = [manifest.currentPeriod, manifest.previousYearPeriod]
    .filter((period): period is Record<string, unknown> => (
      Boolean(period) && typeof period === 'object' && !Array.isArray(period)
    ))
  const currentPeriod = periods[0]
  if (!currentPeriod || currentPeriod.earningsEventId !== earningsEventId) {
    throw new Error('Financial prediction input manifest does not match the earnings event')
  }
  for (const period of periods) {
    if (typeof period.sourcePublishedAt !== 'string') {
      throw new Error('Financial prediction period has an invalid publication timestamp')
    }
    requireAvailableByCutoff(
      period.sourcePublishedAt,
      cutoffTimestamp,
      'Financial source-document publication timestamp',
    )
  }
}

async function loadQualitativeRunAudit(
  client: SupabaseClient,
  effectiveExtraction: EffectiveQualitativeExtraction,
  cutoffTimestamp: number,
): Promise<QualitativeRunAuditRow> {
  const { data, error } = await client
    .from(DatabaseTable.extractionRuns)
    .select(
      'id,earnings_event_id,cutoff_at,input_manifest,input_sha256,input_selection_version,'
      + 'provider_name,provider_request_id,resolved_model_name,started_at,finished_at,'
      + 'token_usage,created_at',
    )
    .eq('id', effectiveExtraction.extractionRunId)
    .single()
  if (error) throw new Error(`Could not load qualitative prediction audit data: ${error.message}`)
  const run = data as unknown as QualitativeRunAuditRow
  if (run.earnings_event_id !== effectiveExtraction.earningsEventId) {
    throw new Error('Qualitative prediction run belongs to a different earnings event')
  }
  if (new Date(run.cutoff_at).toISOString() !== new Date(effectiveExtraction.cutoffAt).toISOString()) {
    throw new Error('Qualitative prediction run cutoff does not match the effective extraction')
  }
  requireAvailableByCutoff(run.cutoff_at, cutoffTimestamp, 'Qualitative extraction cutoff')
  requireAvailableByCutoff(run.finished_at, cutoffTimestamp, 'Qualitative extraction finish time')
  requireAvailableByCutoff(run.created_at, cutoffTimestamp, 'Qualitative extraction creation time')
  requireAvailableByCutoff(
    effectiveExtraction.review.createdAt,
    cutoffTimestamp,
    'Qualitative review creation time',
  )
  requireManifestDocumentsAvailable(
    run.input_manifest,
    effectiveExtraction.earningsEventId,
    cutoffTimestamp,
  )
  return run
}

function scoringMetrics(financialInput: FinancialPredictionInput): FinancialScoringMetric[] {
  return financialInput.metrics.map((metric) => ({
    metricCode: metric.metric_code,
    valueNumeric: metric.value_numeric,
  }))
}

function snapshotFingerprint(snapshot: PredictionSnapshot): string {
  return calculateContentSha256(
    new TextEncoder().encode(canonicalJson(snapshot)),
  )
}

export function preparePredictionSnapshot(
  input: PredictionSnapshotInput,
): PreparedPredictionSnapshot {
  const cutoffTimestamp = validTimestamp(input.cutoffAt, 'Prediction cutoff')
  if (input.earningsEvent.id !== input.financial.calculation.earnings_event_id) {
    throw new Error('Prediction financial calculation belongs to a different earnings event')
  }
  if (
    input.earningsEvent.id !== input.effectiveQualitativeExtraction.earningsEventId
    || input.earningsEvent.id !== input.qualitativeRun.earnings_event_id
  ) {
    throw new Error('Prediction qualitative extraction belongs to a different earnings event')
  }
  if (input.qualitativeRun.id !== input.effectiveQualitativeExtraction.extractionRunId) {
    throw new Error('Prediction qualitative audit data belongs to a different extraction run')
  }
  requireAvailableByCutoff(
    input.earningsEvent.detectedAt,
    cutoffTimestamp,
    'Event detection timestamp',
  )
  requireAvailableByCutoff(
    input.financial.calculation.created_at,
    cutoffTimestamp,
    'Financial calculation creation time',
  )
  requireAvailableByCutoff(
    input.effectiveQualitativeExtraction.review.createdAt,
    cutoffTimestamp,
    'Qualitative review creation time',
  )
  requireAvailableByCutoff(
    input.qualitativeRun.cutoff_at,
    cutoffTimestamp,
    'Qualitative extraction cutoff',
  )
  requireAvailableByCutoff(
    input.qualitativeRun.finished_at,
    cutoffTimestamp,
    'Qualitative extraction finish time',
  )
  requireAvailableByCutoff(
    input.qualitativeRun.created_at,
    cutoffTimestamp,
    'Qualitative extraction creation time',
  )
  requireManifestDocumentsAvailable(
    input.qualitativeRun.input_manifest,
    input.earningsEvent.id,
    cutoffTimestamp,
  )
  requireFinancialManifestAvailable(
    input.financial.calculation.input_manifest,
    input.earningsEvent.id,
    cutoffTimestamp,
  )
  if (input.financial.metrics.length !== Number(input.financial.calculation.metric_count)) {
    throw new Error('Prediction financial metrics do not match their calculation record')
  }
  for (const document of input.availableEventDocuments) {
    requireAvailableByCutoff(
      document.published_at,
      cutoffTimestamp,
      `Document ${document.id} publication timestamp`,
    )
    requireAvailableByCutoff(
      document.first_seen_at,
      cutoffTimestamp,
      `Document ${document.id} first-seen timestamp`,
    )
  }
  for (const metric of input.financial.metrics) {
    if (
      metric.calculation_version !== input.financial.calculation.calculation_version
      || metric.input_sha256 !== input.financial.calculation.input_sha256
    ) {
      throw new Error(`Financial metric ${metric.id} does not match its calculation`)
    }
    requireAvailableByCutoff(
      metric.created_at,
      cutoffTimestamp,
      `Financial metric ${metric.id} creation time`,
    )
  }
  if (validTimestamp(input.plannedSessions.entry.opensAt, 'Planned entry opening') <= cutoffTimestamp) {
    throw new Error('Planned entry session must open after the prediction cutoff')
  }
  if (
    input.plannedSessions.entry.sessionDate !== input.plannedSessions.day1SessionDate
    || input.plannedSessions.day1SessionDate >= input.plannedSessions.day5SessionDate
    || input.plannedSessions.day5SessionDate >= input.plannedSessions.day20SessionDate
  ) {
    throw new Error('Planned prediction sessions do not match the entry-inclusive horizon rule')
  }

  const score = calculateTransparentEarningsScore({
    financialMetrics: scoringMetrics(input.financial),
    qualitativeExtraction: input.effectiveQualitativeExtraction.effective.output,
  })
  const snapshot: PredictionSnapshot = {
    schemaVersion: PredictionSnapshotVersion.initial,
    cutoffAt: new Date(cutoffTimestamp).toISOString(),
    earningsEvent: input.earningsEvent,
    availableEventDocuments: input.availableEventDocuments,
    financial: input.financial,
    qualitative: {
      run: input.qualitativeRun,
      effectiveExtraction: input.effectiveQualitativeExtraction,
    },
    score,
    plannedSessions: input.plannedSessions,
  }
  return {
    snapshot,
    fingerprint: snapshotFingerprint(snapshot),
    score,
  }
}

async function preparePredictionCreation(
  client: SupabaseClient,
  earningsEventId: string,
  now: () => Date,
): Promise<PreparedPredictionCreation> {
  const normalizedEventId = earningsEventId.trim()
  if (!normalizedEventId) throw new Error('Prediction creation requires an earnings event ID')

  const cutoffDate = now()
  if (Number.isNaN(cutoffDate.valueOf())) throw new Error('Prediction clock returned an invalid date')
  const cutoffAt = cutoffDate.toISOString()
  const cutoffTimestamp = cutoffDate.valueOf()

  await refuseExistingPrediction(client, normalizedEventId)
  const [
    earningsEvent,
    availableEventDocuments,
    financial,
    effectiveQualitativeExtraction,
    plannedSessions,
  ] = await Promise.all([
    loadPredictionEvent(client, normalizedEventId, cutoffTimestamp),
    loadAvailableEventDocuments(client, normalizedEventId, cutoffAt),
    loadFinancialPredictionInput(client, normalizedEventId, cutoffAt),
    loadEffectiveQualitativeExtraction(client, normalizedEventId),
    selectPlannedPredictionSessions(client, cutoffAt),
  ])
  if (!effectiveQualitativeExtraction) {
    throw new Error(`Earnings event ${normalizedEventId} has no reviewed qualitative extraction`)
  }
  const qualitativeRun = await loadQualitativeRunAudit(
    client,
    effectiveQualitativeExtraction,
    cutoffTimestamp,
  )
  const preparedSnapshot = preparePredictionSnapshot({
    cutoffAt,
    earningsEvent,
    availableEventDocuments,
    financial,
    effectiveQualitativeExtraction,
    qualitativeRun,
    plannedSessions,
  })
  return {
    cutoffAt,
    earningsEvent,
    financial,
    effectiveQualitativeExtraction,
    plannedSessions,
    preparedSnapshot,
  }
}

export async function previewPrediction(
  client: SupabaseClient,
  earningsEventId: string,
  now: () => Date = () => new Date(),
): Promise<PredictionPreview> {
  const prepared = await preparePredictionCreation(client, earningsEventId, now)
  return {
    writesDatabase: false,
    earningsEventId: prepared.earningsEvent.id,
    ticker: prepared.earningsEvent.ticker,
    cutoffAt: prepared.cutoffAt,
    score: prepared.preparedSnapshot.score.score,
    financialScore: prepared.preparedSnapshot.score.financialScore,
    qualitativeScore: prepared.preparedSnapshot.score.qualitativeScore,
    components: prepared.preparedSnapshot.score.components,
    plannedEntrySession: prepared.plannedSessions.entry.sessionDate,
    plannedEntryOpensAt: prepared.plannedSessions.entry.opensAt,
    plannedDay1Session: prepared.plannedSessions.day1SessionDate,
    plannedDay5Session: prepared.plannedSessions.day5SessionDate,
    plannedDay20Session: prepared.plannedSessions.day20SessionDate,
    snapshotFingerprint: prepared.preparedSnapshot.fingerprint,
  }
}

export async function createAndStorePrediction(
  client: SupabaseClient,
  earningsEventId: string,
  now: () => Date = () => new Date(),
): Promise<PredictionCreationSummary> {
  const prepared = await preparePredictionCreation(client, earningsEventId, now)
  const {
    cutoffAt,
    earningsEvent,
    financial,
    effectiveQualitativeExtraction,
    plannedSessions,
    preparedSnapshot,
  } = prepared
  const { snapshot, fingerprint, score } = preparedSnapshot

  const { data, error } = await client
    .from(DatabaseTable.predictions)
    .insert({
      earnings_event_id: earningsEvent.id,
      extraction_run_id: effectiveQualitativeExtraction.extractionRunId,
      extraction_review_id: effectiveQualitativeExtraction.review.id,
      financial_calculation_id: financial.calculation.id,
      cutoff_at: cutoffAt,
      score: score.score,
      score_components: score.components,
      rule_version: score.ruleVersion,
      snapshot,
      snapshot_schema_version: snapshot.schemaVersion,
      evaluation_session_rule_version: plannedSessions.evaluationSessionRuleVersion,
      snapshot_sha256: fingerprint,
      planned_entry_session: plannedSessions.entry.sessionDate,
      planned_day_1_session: plannedSessions.day1SessionDate,
      planned_day_5_session: plannedSessions.day5SessionDate,
      planned_day_20_session: plannedSessions.day20SessionDate,
      entry_calendar_code: plannedSessions.entry.calendarCode,
      entry_calendar_version: plannedSessions.entry.calendarVersion,
      reference_price_rule_version: plannedSessions.entry.ruleVersion,
      created_at: cutoffAt,
    })
    .select('id,recorded_at')
    .single()
  if (error) throw new Error(`Could not save immutable prediction: ${error.message}`)
  const saved = data as { id: string; recorded_at: string }

  return {
    predictionId: saved.id,
    earningsEventId: earningsEvent.id,
    ticker: earningsEvent.ticker,
    score: score.score,
    ruleVersion: score.ruleVersion,
    cutoffAt,
    databaseRecordedAt: saved.recorded_at,
    plannedEntrySession: plannedSessions.entry.sessionDate,
    plannedDay1Session: plannedSessions.day1SessionDate,
    plannedDay5Session: plannedSessions.day5SessionDate,
    plannedDay20Session: plannedSessions.day20SessionDate,
    snapshotFingerprint: fingerprint,
  }
}
