import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalJson } from './canonical-json.js'
import {
  DatabaseTable,
  HistoricalReconstructionMode,
  HistoricalReconstructionPlanVersion,
  QualitativeSourceAvailabilityMode,
  RuleVersion,
} from './constants.js'
import { calculateContentSha256 } from './content-hash.js'
import type {
  PreparedQualitativeExtractionInput,
  QualitativeExtractionInputManifest,
} from './qualitative-extraction.js'
import { loadPreparedQualitativeExtractionInput } from './qualitative-input-loader.js'

interface HistoricalReconstructionPlanRecord {
  earnings_event_id: string
  simulated_cutoff_at: string
  reconstruction_mode: string
  experiment_version: string
  source_availability_rule_version: string
  input_selection_version: string
  source_manifest: QualitativeExtractionInputManifest
  source_manifest_sha256: string
  qualitative_input_sha256: string
  snapshot_schema_version: string
}

export interface StoredHistoricalReconstructionPlan extends HistoricalReconstructionPlanRecord {
  id: string
  recorded_at: string
}

export interface PreparedHistoricalReconstructionInput {
  plan: StoredHistoricalReconstructionPlan
  qualitativeInput: PreparedQualitativeExtractionInput
}

export interface PreparedHistoricalReconstructionPlan {
  record: HistoricalReconstructionPlanRecord
  documentCount: number
}

export interface HistoricalReconstructionPlanPreview extends Record<string, unknown> {
  writesDatabase: false
  earningsEventId: string
  simulatedCutoffAt: string
  reconstructionMode: string
  experimentVersion: string
  sourceAvailabilityRuleVersion: string
  inputSelectionVersion: string
  sourceManifestFingerprint: string
  qualitativeInputFingerprint: string
  documents: QualitativeExtractionInputManifest['documents']
  warning: string
}

export interface HistoricalReconstructionPlanCreationSummary extends Record<string, unknown> {
  historicalReconstructionPlanId: string
  earningsEventId: string
  simulatedCutoffAt: string
  databaseRecordedAt: string
  experimentVersion: string
  sourceManifestFingerprint: string
  qualitativeInputFingerprint: string
  documentCount: number
}

function normalizedPastTimestamp(value: string, now: Date): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error('Historical reconstruction cutoff must be a valid timestamp')
  }
  if (timestamp.valueOf() >= now.valueOf()) {
    throw new Error('Historical reconstruction cutoff must be earlier than the current time')
  }
  return timestamp.toISOString()
}

function normalizedExperimentVersion(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 100) {
    throw new Error('Historical experiment version must contain 1 to 100 characters')
  }
  return normalized
}

function manifestFingerprint(manifest: QualitativeExtractionInputManifest): string {
  return calculateContentSha256(new TextEncoder().encode(canonicalJson(manifest)))
}

export function prepareHistoricalReconstructionPlan(
  manifest: QualitativeExtractionInputManifest,
  qualitativeInputFingerprint: string,
  experimentVersion: string,
): PreparedHistoricalReconstructionPlan {
  if (manifest.inputSelectionVersion !== RuleVersion.historicalQualitativeInputSelection) {
    throw new Error('Historical plan requires the historical qualitative input-selection rule')
  }
  if (manifest.sourceAvailabilityRuleVersion !== RuleVersion.historicalSourceAvailability) {
    throw new Error('Historical plan requires the historical source-availability rule')
  }
  if (!/^[0-9a-f]{64}$/.test(qualitativeInputFingerprint)) {
    throw new Error('Historical plan requires a valid qualitative input fingerprint')
  }

  const normalizedExperiment = normalizedExperimentVersion(experimentVersion)
  return {
    record: {
      earnings_event_id: manifest.earningsEventId,
      simulated_cutoff_at: manifest.cutoffAt,
      reconstruction_mode: HistoricalReconstructionMode.retrospective,
      experiment_version: normalizedExperiment,
      source_availability_rule_version: manifest.sourceAvailabilityRuleVersion,
      input_selection_version: manifest.inputSelectionVersion,
      source_manifest: manifest,
      source_manifest_sha256: manifestFingerprint(manifest),
      qualitative_input_sha256: qualitativeInputFingerprint,
      snapshot_schema_version: HistoricalReconstructionPlanVersion.initial,
    },
    documentCount: manifest.documents.length,
  }
}

async function preparePlanFromStoredDocuments(
  client: SupabaseClient,
  earningsEventId: string,
  simulatedCutoffAt: string,
  experimentVersion: string,
  now: () => Date,
): Promise<PreparedHistoricalReconstructionPlan> {
  const normalizedEventId = earningsEventId.trim()
  if (!normalizedEventId) throw new Error('Historical reconstruction requires an earnings event ID')
  const currentTime = now()
  if (Number.isNaN(currentTime.valueOf())) {
    throw new Error('Historical reconstruction clock returned an invalid time')
  }
  const normalizedCutoff = normalizedPastTimestamp(simulatedCutoffAt, currentTime)
  const preparedInput = await loadPreparedQualitativeExtractionInput(
    client,
    normalizedEventId,
    normalizedCutoff,
    {
      sourceAvailabilityMode: QualitativeSourceAvailabilityMode.historicalReconstruction,
    },
  )
  return prepareHistoricalReconstructionPlan(
    preparedInput.manifest,
    preparedInput.inputSha256,
    experimentVersion,
  )
}

export async function loadPreparedHistoricalReconstructionInput(
  client: SupabaseClient,
  historicalReconstructionPlanId: string,
): Promise<PreparedHistoricalReconstructionInput> {
  const normalizedPlanId = historicalReconstructionPlanId.trim()
  if (!normalizedPlanId) throw new Error('Historical reconstruction plan ID is required')

  const { data, error } = await client
    .from(DatabaseTable.historicalReconstructionPlans)
    .select(`
      id,
      earnings_event_id,
      simulated_cutoff_at,
      reconstruction_mode,
      experiment_version,
      source_availability_rule_version,
      input_selection_version,
      source_manifest,
      source_manifest_sha256,
      qualitative_input_sha256,
      snapshot_schema_version,
      recorded_at
    `)
    .eq('id', normalizedPlanId)
    .single()
  if (error) throw new Error(`Could not load historical reconstruction plan: ${error.message}`)
  const plan = data as unknown as StoredHistoricalReconstructionPlan

  const qualitativeInput = await loadPreparedQualitativeExtractionInput(
    client,
    plan.earnings_event_id,
    plan.simulated_cutoff_at,
    {
      sourceAvailabilityMode: QualitativeSourceAvailabilityMode.historicalReconstruction,
    },
  )
  const preparedPlan = prepareHistoricalReconstructionPlan(
    qualitativeInput.manifest,
    qualitativeInput.inputSha256,
    plan.experiment_version,
  ).record
  if (
    plan.reconstruction_mode !== preparedPlan.reconstruction_mode
    || plan.source_availability_rule_version
      !== preparedPlan.source_availability_rule_version
    || plan.input_selection_version !== preparedPlan.input_selection_version
    || plan.snapshot_schema_version !== preparedPlan.snapshot_schema_version
    || plan.source_manifest_sha256 !== preparedPlan.source_manifest_sha256
    || plan.qualitative_input_sha256 !== preparedPlan.qualitative_input_sha256
    || canonicalJson(plan.source_manifest) !== canonicalJson(preparedPlan.source_manifest)
  ) {
    throw new Error('Stored historical reconstruction plan does not match the prepared input')
  }

  return { plan, qualitativeInput }
}

export async function previewHistoricalReconstructionPlan(
  client: SupabaseClient,
  earningsEventId: string,
  simulatedCutoffAt: string,
  experimentVersion: string,
  now: () => Date = () => new Date(),
): Promise<HistoricalReconstructionPlanPreview> {
  const prepared = await preparePlanFromStoredDocuments(
    client,
    earningsEventId,
    simulatedCutoffAt,
    experimentVersion,
    now,
  )
  const record = prepared.record
  return {
    writesDatabase: false,
    earningsEventId: record.earnings_event_id,
    simulatedCutoffAt: record.simulated_cutoff_at,
    reconstructionMode: record.reconstruction_mode,
    experimentVersion: record.experiment_version,
    sourceAvailabilityRuleVersion: record.source_availability_rule_version,
    inputSelectionVersion: record.input_selection_version,
    sourceManifestFingerprint: record.source_manifest_sha256,
    qualitativeInputFingerprint: record.qualitative_input_sha256,
    documents: record.source_manifest.documents,
    warning: 'Historical reconstruction only; this is not a forward prediction or an LLM request.',
  }
}

export async function createAndStoreHistoricalReconstructionPlan(
  client: SupabaseClient,
  earningsEventId: string,
  simulatedCutoffAt: string,
  experimentVersion: string,
  now: () => Date = () => new Date(),
): Promise<HistoricalReconstructionPlanCreationSummary> {
  const prepared = await preparePlanFromStoredDocuments(
    client,
    earningsEventId,
    simulatedCutoffAt,
    experimentVersion,
    now,
  )
  const record = prepared.record
  const { data, error } = await client
    .from(DatabaseTable.historicalReconstructionPlans)
    .insert(record)
    .select('id,recorded_at,source_manifest_sha256,qualitative_input_sha256')
    .single()
  if (error) throw new Error(`Could not save historical reconstruction plan: ${error.message}`)
  const stored = data as {
    id: string
    recorded_at: string
    source_manifest_sha256: string
    qualitative_input_sha256: string
  }
  if (
    stored.source_manifest_sha256 !== record.source_manifest_sha256
    || stored.qualitative_input_sha256 !== record.qualitative_input_sha256
  ) {
    throw new Error('Stored historical reconstruction plan does not match its fingerprints')
  }

  return {
    historicalReconstructionPlanId: stored.id,
    earningsEventId: record.earnings_event_id,
    simulatedCutoffAt: record.simulated_cutoff_at,
    databaseRecordedAt: stored.recorded_at,
    experimentVersion: record.experiment_version,
    sourceManifestFingerprint: record.source_manifest_sha256,
    qualitativeInputFingerprint: record.qualitative_input_sha256,
    documentCount: prepared.documentCount,
  }
}
