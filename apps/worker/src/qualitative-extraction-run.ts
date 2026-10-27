import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  DatabaseTable,
  QualitativeProviderStatus,
  QualitativeValidationStatus,
} from './constants.js'
import { buildBaselineQualitativeProviderRequest } from './baseline-qualitative-prompt.js'
import {
  validateAndLocateQualitativeEvidence,
  type PreparedQualitativeExtractionInput,
} from './qualitative-extraction.js'
import { loadPreparedQualitativeExtractionInput } from './qualitative-input-loader.js'
import type {
  QualitativeExtractionProvider,
  QualitativeProviderResult,
} from './qualitative-provider.js'

export interface QualitativeExtractionRunRecord {
  earnings_event_id: string
  cutoff_at: string
  schema_version: string
  prompt_version: string
  model_name: string
  input_manifest: PreparedQualitativeExtractionInput['manifest']
  input_sha256: string
  input_selection_version: string
  provider_name: string
  provider_request_id: string | null
  provider_status: string
  resolved_model_name: string | null
  failure_reason: string | null
  retryable: boolean
  started_at: string
  finished_at: string
  duration_milliseconds: number
  token_usage: QualitativeProviderResult['tokenUsage']
  output: unknown | null
  output_sha256: string | null
  validation_status: string | null
  located_evidence: unknown[] | null
  validation_errors: string[] | null
}

export interface QualitativeExtractionRunSummary extends Record<string, unknown> {
  extractionRunId: string
  earningsEventId: string
  inputFingerprint: string
  providerStatus: string
  validationStatus: string | null
  requestedModel: string
  resolvedModel: string | null
  tokenUsage: QualitativeProviderResult['tokenUsage']
}

function outputFingerprint(output: unknown): string {
  return calculateContentSha256(new TextEncoder().encode(canonicalJson(output)))
}

export function buildQualitativeExtractionRunRecord(
  preparedInput: PreparedQualitativeExtractionInput,
  promptVersion: string,
  providerResult: QualitativeProviderResult,
): QualitativeExtractionRunRecord {
  const sharedRecord = {
    earnings_event_id: preparedInput.manifest.earningsEventId,
    cutoff_at: preparedInput.manifest.cutoffAt,
    schema_version: preparedInput.manifest.schemaVersion,
    prompt_version: promptVersion,
    model_name: providerResult.requestedModel,
    input_manifest: preparedInput.manifest,
    input_sha256: preparedInput.inputSha256,
    input_selection_version: preparedInput.manifest.inputSelectionVersion,
    provider_name: providerResult.providerName,
    provider_request_id: providerResult.providerRequestId,
    provider_status: providerResult.status,
    resolved_model_name: providerResult.resolvedModel,
    started_at: providerResult.startedAt,
    finished_at: providerResult.finishedAt,
    duration_milliseconds: providerResult.durationMilliseconds,
    token_usage: providerResult.tokenUsage,
  }

  if (providerResult.status !== QualitativeProviderStatus.completed) {
    return {
      ...sharedRecord,
      failure_reason: providerResult.failureReason,
      retryable: providerResult.retryable,
      output: null,
      output_sha256: null,
      validation_status: null,
      located_evidence: null,
      validation_errors: null,
    }
  }

  const output = providerResult.extraction
  try {
    const validation = validateAndLocateQualitativeEvidence(
      output,
      preparedInput.documents,
    )
    return {
      ...sharedRecord,
      failure_reason: null,
      retryable: false,
      output,
      output_sha256: outputFingerprint(output),
      validation_status: QualitativeValidationStatus.valid,
      located_evidence: validation.locatedEvidence,
      validation_errors: null,
    }
  } catch (error: unknown) {
    return {
      ...sharedRecord,
      failure_reason: null,
      retryable: false,
      output,
      output_sha256: outputFingerprint(output),
      validation_status: QualitativeValidationStatus.invalid,
      located_evidence: null,
      validation_errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}

async function saveQualitativeExtractionRun(
  client: SupabaseClient,
  record: QualitativeExtractionRunRecord,
): Promise<string> {
  const { data, error } = await client
    .from(DatabaseTable.extractionRuns)
    .insert(record)
    .select('id')
    .single()
  if (error) throw new Error(`Could not save qualitative extraction run: ${error.message}`)
  return (data as { id: string }).id
}

export async function extractAndStoreQualitativeAnalysis(
  client: SupabaseClient,
  provider: QualitativeExtractionProvider,
  earningsEventId: string,
  analysisCutoffAt: string,
): Promise<QualitativeExtractionRunSummary> {
  const preparedInput = await loadPreparedQualitativeExtractionInput(
    client,
    earningsEventId,
    analysisCutoffAt,
  )
  const request = buildBaselineQualitativeProviderRequest(preparedInput)
  const providerResult = await provider.extract(request)
  const record = buildQualitativeExtractionRunRecord(
    preparedInput,
    request.prompt.version,
    providerResult,
  )
  const extractionRunId = await saveQualitativeExtractionRun(client, record)

  return {
    extractionRunId,
    earningsEventId,
    inputFingerprint: preparedInput.inputSha256,
    providerStatus: providerResult.status,
    validationStatus: record.validation_status,
    requestedModel: providerResult.requestedModel,
    resolvedModel: providerResult.resolvedModel,
    tokenUsage: providerResult.tokenUsage,
  }
}
