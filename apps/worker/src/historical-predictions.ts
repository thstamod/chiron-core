import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  DatabaseTable,
  EarningsEventStatus,
  HistoricalPredictionFeatureSet,
  HistoricalPredictionSnapshotVersion,
  QualitativeExtractionPurpose,
  RuleVersion,
} from './constants.js'
import {
  selectEffectiveQualitativeExtraction,
  type EffectiveQualitativeExtraction,
} from './effective-qualitative-extraction.js'
import {
  selectPlannedPredictionSessions,
  type PlannedPredictionSessions,
} from './reference-price-session.js'
import {
  calculateTransparentEarningsScore,
  type TransparentEarningsScore,
} from './transparent-scoring.js'

export interface HistoricalPlanRow {
  id: string
  earnings_event_id: string
  simulated_cutoff_at: string
  experiment_version: string
  source_availability_rule_version: string
  input_selection_version: string
  source_manifest: unknown
  source_manifest_sha256: string
  qualitative_input_sha256: string
  snapshot_schema_version: string
  recorded_at: string
}

interface HistoricalEventRow {
  id: string
  company_id: string
  period_end: string
  status: string
  detected_at: string
  companies: { ticker: string; legal_name: string } | Array<{
    ticker: string
    legal_name: string
  }>
}

export interface HistoricalPredictionEvent {
  id: string
  companyId: string
  ticker: string
  legalName: string
  periodEnd: string
  status: string
  actualDetectedAt: string
}

export interface HistoricalPredictionSnapshot {
  schemaVersion: string
  experimentVersion: string
  featureSetVersion: string
  promptVersion: string
  modelName: string
  simulatedCutoffAt: string
  historicalPlan: HistoricalPlanRow
  earningsEvent: HistoricalPredictionEvent
  financialInput: {
    status: 'excluded_by_feature_set'
    reason: string
  }
  qualitative: EffectiveQualitativeExtraction
  score: TransparentEarningsScore
  plannedSessions: PlannedPredictionSessions
}

interface PreparedHistoricalPrediction {
  snapshot: HistoricalPredictionSnapshot
  snapshotFingerprint: string
}

export interface HistoricalPredictionPreview extends Record<string, unknown> {
  writesDatabase: false
  historicalReconstructionPlanId: string
  ticker: string
  experimentVersion: string
  featureSetVersion: string
  promptVersion: string
  modelName: string
  simulatedCutoffAt: string
  score: number
  financialScore: number
  qualitativeScore: number
  components: TransparentEarningsScore['components']
  plannedEntrySession: string
  plannedDay1Session: string
  plannedDay5Session: string
  plannedDay20Session: string
  snapshotFingerprint: string
}

export interface HistoricalPredictionCreationSummary
  extends Omit<HistoricalPredictionPreview, 'writesDatabase'> {
  writesDatabase: true
  historicalPredictionId: string
  databaseRecordedAt: string
}

function singleCompany(
  company: HistoricalEventRow['companies'],
): { ticker: string; legal_name: string } {
  const selectedCompany = Array.isArray(company) ? company[0] : company
  if (!selectedCompany) throw new Error('Historical prediction event has no company')
  return selectedCompany
}

async function loadHistoricalPlan(
  client: SupabaseClient,
  historicalReconstructionPlanId: string,
): Promise<HistoricalPlanRow> {
  const { data, error } = await client
    .from(DatabaseTable.historicalReconstructionPlans)
    .select('*')
    .eq('id', historicalReconstructionPlanId)
    .single()
  if (error) throw new Error(`Could not load historical prediction plan: ${error.message}`)
  return data as unknown as HistoricalPlanRow
}

async function loadHistoricalEvent(
  client: SupabaseClient,
  earningsEventId: string,
): Promise<HistoricalPredictionEvent> {
  const { data, error } = await client
    .from(DatabaseTable.earningsEvents)
    .select('id,company_id,period_end,status,detected_at,companies!inner(ticker,legal_name)')
    .eq('id', earningsEventId)
    .single()
  if (error) throw new Error(`Could not load historical prediction event: ${error.message}`)
  const event = data as unknown as HistoricalEventRow
  if (!event.period_end) throw new Error('Historical prediction requires a confirmed period')
  if ([EarningsEventStatus.groupingPending, EarningsEventStatus.provisional].includes(
    event.status as typeof EarningsEventStatus.groupingPending,
  )) {
    throw new Error(`Historical prediction event is incomplete: ${event.status}`)
  }
  const company = singleCompany(event.companies)
  return {
    id: event.id,
    companyId: event.company_id,
    ticker: company.ticker,
    legalName: company.legal_name,
    periodEnd: event.period_end,
    status: event.status,
    actualDetectedAt: new Date(event.detected_at).toISOString(),
  }
}

async function loadReviewedHistoricalExtraction(
  client: SupabaseClient,
  plan: HistoricalPlanRow,
): Promise<EffectiveQualitativeExtraction> {
  const { data: runs, error: runError } = await client
    .from(DatabaseTable.extractionRuns)
    .select(
      'id,earnings_event_id,cutoff_at,schema_version,prompt_version,model_name,'
      + 'provider_status,validation_status,output,output_sha256,located_evidence,created_at',
    )
    .eq('historical_reconstruction_plan_id', plan.id)
    .eq('extraction_purpose', QualitativeExtractionPurpose.historicalReconstruction)
    .order('created_at')
    .order('id')
  if (runError) throw new Error(`Could not load historical extraction runs: ${runError.message}`)
  if (!runs?.length) throw new Error('Historical prediction plan has no extraction run')

  const extractionRuns = runs as unknown as Array<{ id: string }>
  const runIds = extractionRuns.map((run) => run.id)
  const { data: reviews, error: reviewError } = await client
    .from(DatabaseTable.extractionReviews)
    .select(
      'id,extraction_run_id,decision,reviewed_output_sha256,corrected_output,'
      + 'corrected_schema_version,corrected_output_sha256,corrected_located_evidence,'
      + 'reviewer_label,notes,review_version,created_at',
    )
    .in('extraction_run_id', runIds)
    .order('created_at')
    .order('id')
  if (reviewError) throw new Error(`Could not load historical extraction reviews: ${reviewError.message}`)
  const effectiveExtraction = selectEffectiveQualitativeExtraction(
    extractionRuns,
    reviews ?? [],
  )
  if (!effectiveExtraction) throw new Error('Historical prediction requires a reviewed extraction')
  if (
    effectiveExtraction.earningsEventId !== plan.earnings_event_id
    || new Date(effectiveExtraction.cutoffAt).toISOString()
      !== new Date(plan.simulated_cutoff_at).toISOString()
  ) {
    throw new Error('Reviewed extraction does not match the historical plan')
  }
  return effectiveExtraction
}

export function prepareHistoricalPredictionSnapshot(input: {
  plan: HistoricalPlanRow
  event: HistoricalPredictionEvent
  effectiveExtraction: EffectiveQualitativeExtraction
  plannedSessions: PlannedPredictionSessions
}): PreparedHistoricalPrediction {
  const normalizedCutoffAt = new Date(input.plan.simulated_cutoff_at).toISOString()
  if (
    input.event.id !== input.plan.earnings_event_id
    || input.effectiveExtraction.earningsEventId !== input.plan.earnings_event_id
  ) {
    throw new Error('Historical prediction inputs belong to different earnings events')
  }
  if (new Date(input.effectiveExtraction.cutoffAt).toISOString() !== normalizedCutoffAt) {
    throw new Error('Historical prediction extraction cutoff does not match its plan')
  }
  if (new Date(input.plannedSessions.entry.opensAt) <= new Date(normalizedCutoffAt)) {
    throw new Error('Historical prediction entry must open after its simulated cutoff')
  }
  const score = calculateTransparentEarningsScore({
    financialMetrics: [],
    qualitativeExtraction: input.effectiveExtraction.effective.output,
  })
  const snapshot: HistoricalPredictionSnapshot = {
    schemaVersion: HistoricalPredictionSnapshotVersion.qualitativeOnly,
    experimentVersion: input.plan.experiment_version,
    featureSetVersion: HistoricalPredictionFeatureSet.qualitativeOnly,
    promptVersion: input.effectiveExtraction.promptVersion,
    modelName: input.effectiveExtraction.modelName,
    simulatedCutoffAt: normalizedCutoffAt,
    historicalPlan: input.plan,
    earningsEvent: input.event,
    financialInput: {
      status: 'excluded_by_feature_set',
      reason: 'The qualitative-only baseline excludes financial metrics for every event.',
    },
    qualitative: input.effectiveExtraction,
    score,
    plannedSessions: input.plannedSessions,
  }
  return {
    snapshot,
    snapshotFingerprint: calculateContentSha256(
      new TextEncoder().encode(canonicalJson(snapshot)),
    ),
  }
}

async function prepareHistoricalPrediction(
  client: SupabaseClient,
  historicalReconstructionPlanId: string,
): Promise<PreparedHistoricalPrediction> {
  const plan = await loadHistoricalPlan(client, historicalReconstructionPlanId.trim())
  const [event, effectiveExtraction, plannedSessions] = await Promise.all([
    loadHistoricalEvent(client, plan.earnings_event_id),
    loadReviewedHistoricalExtraction(client, plan),
    selectPlannedPredictionSessions(client, plan.simulated_cutoff_at),
  ])
  return prepareHistoricalPredictionSnapshot({ plan, event, effectiveExtraction, plannedSessions })
}

function historicalPredictionPreview(
  prepared: PreparedHistoricalPrediction,
): HistoricalPredictionPreview {
  const { snapshot, snapshotFingerprint } = prepared
  return {
    writesDatabase: false,
    historicalReconstructionPlanId: snapshot.historicalPlan.id,
    ticker: snapshot.earningsEvent.ticker,
    experimentVersion: snapshot.experimentVersion,
    featureSetVersion: snapshot.featureSetVersion,
    promptVersion: snapshot.qualitative.promptVersion,
    modelName: snapshot.qualitative.modelName,
    simulatedCutoffAt: snapshot.simulatedCutoffAt,
    score: snapshot.score.score,
    financialScore: snapshot.score.financialScore,
    qualitativeScore: snapshot.score.qualitativeScore,
    components: snapshot.score.components,
    plannedEntrySession: snapshot.plannedSessions.entry.sessionDate,
    plannedDay1Session: snapshot.plannedSessions.day1SessionDate,
    plannedDay5Session: snapshot.plannedSessions.day5SessionDate,
    plannedDay20Session: snapshot.plannedSessions.day20SessionDate,
    snapshotFingerprint,
  }
}

export async function previewHistoricalPrediction(
  client: SupabaseClient,
  historicalReconstructionPlanId: string,
): Promise<HistoricalPredictionPreview> {
  return historicalPredictionPreview(
    await prepareHistoricalPrediction(client, historicalReconstructionPlanId),
  )
}

export async function createAndStoreHistoricalPrediction(
  client: SupabaseClient,
  historicalReconstructionPlanId: string,
): Promise<HistoricalPredictionCreationSummary> {
  const prepared = await prepareHistoricalPrediction(client, historicalReconstructionPlanId)
  const { snapshot, snapshotFingerprint } = prepared
  const { data, error } = await client
    .from(DatabaseTable.historicalPredictions)
    .insert({
      historical_reconstruction_plan_id: snapshot.historicalPlan.id,
      earnings_event_id: snapshot.earningsEvent.id,
      extraction_run_id: snapshot.qualitative.extractionRunId,
      extraction_review_id: snapshot.qualitative.review.id,
      experiment_version: snapshot.experimentVersion,
      feature_set_version: snapshot.featureSetVersion,
      prompt_version: snapshot.qualitative.promptVersion,
      model_name: snapshot.qualitative.modelName,
      rule_version: RuleVersion.transparentEarningsScore,
      simulated_cutoff_at: snapshot.simulatedCutoffAt,
      score: snapshot.score.score,
      score_components: snapshot.score.components,
      snapshot,
      snapshot_schema_version: snapshot.schemaVersion,
      snapshot_sha256: snapshotFingerprint,
      evaluation_session_rule_version:
        snapshot.plannedSessions.evaluationSessionRuleVersion,
      planned_entry_session: snapshot.plannedSessions.entry.sessionDate,
      planned_day_1_session: snapshot.plannedSessions.day1SessionDate,
      planned_day_5_session: snapshot.plannedSessions.day5SessionDate,
      planned_day_20_session: snapshot.plannedSessions.day20SessionDate,
      entry_calendar_code: snapshot.plannedSessions.entry.calendarCode,
      entry_calendar_version: snapshot.plannedSessions.entry.calendarVersion,
      reference_price_rule_version: snapshot.plannedSessions.entry.ruleVersion,
    })
    .select('id,recorded_at')
    .single()
  if (error) throw new Error(`Could not save historical prediction: ${error.message}`)
  return {
    ...historicalPredictionPreview(prepared),
    writesDatabase: true,
    historicalPredictionId: data.id,
    databaseRecordedAt: data.recorded_at,
  }
}
