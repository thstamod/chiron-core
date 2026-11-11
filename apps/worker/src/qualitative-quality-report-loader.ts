import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parseVersionedQualitativeExtraction,
  type ComparableQualitativeExtraction,
} from '@chiron/shared'
import {
  DatabaseTable,
  QualitativeProviderStatus,
  QualitativeQualityReportConfig,
  QualitativeReviewDecision,
  type QualitativeExtractionPurposeValue,
} from './constants.js'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import { fetchAllPages } from './pagination.js'
import type { QualitativeProviderTokenUsage } from './qualitative-provider.js'
import type {
  QualitativeQualityReview,
  QualitativeQualityRun,
} from './qualitative-quality-report.js'

interface ParsedQualityRun extends QualitativeQualityRun {
  createdAt: string
}

interface ParsedQualityReview extends QualitativeQualityReview {
  id: string
  extractionRunId: string
  reviewedOutputFingerprint: string
  correctedSchemaVersion: string | null
  correctedOutputFingerprint: string | null
  createdAt: string
}

export interface LoadQualitativeQualityRunsOptions {
  extractionPurpose?: QualitativeExtractionPurposeValue
  promptVersion?: string
}

export function createQualitativeQualityReviewRunIdBatches(
  extractionRunIds: string[],
): string[][] {
  const uniqueRunIds = [...new Set(extractionRunIds)]
  const batches: string[][] = []
  for (
    let index = 0;
    index < uniqueRunIds.length;
    index += QualitativeQualityReportConfig.reviewRunIdBatchSize
  ) {
    batches.push(uniqueRunIds.slice(
      index,
      index + QualitativeQualityReportConfig.reviewRunIdBatchSize,
    ))
  }
  return batches
}

function requireObject(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${description} has an invalid database shape`)
  }
  return value as Record<string, unknown>
}

function requireString(
  record: Record<string, unknown>,
  fieldName: string,
  description: string,
): string {
  const value = record[fieldName]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${description} has an invalid ${fieldName}`)
  }
  return value
}

function nullableString(
  record: Record<string, unknown>,
  fieldName: string,
  description: string,
): string | null {
  const value = record[fieldName]
  if (value !== null && typeof value !== 'string') {
    throw new Error(`${description} has an invalid ${fieldName}`)
  }
  return value
}

function requireNonNegativeNumber(
  record: Record<string, unknown>,
  fieldName: string,
  description: string,
): number {
  const value = record[fieldName]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${description} has an invalid ${fieldName}`)
  }
  return value
}

function nullableNonNegativeInteger(
  record: Record<string, unknown>,
  fieldName: string,
  description: string,
): number | null {
  const value = record[fieldName]
  if (
    value !== null
    && (
      typeof value !== 'number'
      || !Number.isSafeInteger(value)
      || value < 0
    )
  ) {
    throw new Error(`${description} has an invalid ${fieldName}`)
  }
  return value
}

function requireTimestamp(
  record: Record<string, unknown>,
  fieldName: string,
  description: string,
): string {
  const value = requireString(record, fieldName, description)
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${description} has an invalid ${fieldName}`)
  }
  return value
}

function parseTokenUsage(value: unknown): QualitativeProviderTokenUsage {
  const description = 'Qualitative extraction token usage'
  const record = requireObject(value, description)
  return {
    inputTokens: nullableNonNegativeInteger(record, 'inputTokens', description),
    cachedInputTokens: nullableNonNegativeInteger(record, 'cachedInputTokens', description),
    cacheWriteTokens: nullableNonNegativeInteger(record, 'cacheWriteTokens', description),
    outputTokens: nullableNonNegativeInteger(record, 'outputTokens', description),
    reasoningTokens: nullableNonNegativeInteger(record, 'reasoningTokens', description),
    totalTokens: nullableNonNegativeInteger(record, 'totalTokens', description),
  }
}

function parseOutput(
  value: unknown,
  schemaVersion: string,
  description: string,
): ComparableQualitativeExtraction | null {
  if (value === null) return null
  try {
    return parseVersionedQualitativeExtraction(schemaVersion, value)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${description} does not match ${schemaVersion}: ${message}`)
  }
}

function calculateOutputFingerprint(output: ComparableQualitativeExtraction): string {
  return calculateContentSha256(new TextEncoder().encode(canonicalJson(output)))
}

function parseQualityRun(value: unknown): ParsedQualityRun {
  const description = 'Qualitative extraction run'
  const record = requireObject(value, description)
  const providerStatus = requireString(record, 'provider_status', description)
  const schemaVersion = requireString(record, 'schema_version', description)
  const output = parseOutput(record.output ?? null, schemaVersion, `${description} output`)
  const outputFingerprint = nullableString(record, 'output_sha256', description)
  const validationStatus = nullableString(record, 'validation_status', description)

  if (
    providerStatus === QualitativeProviderStatus.completed
    && (output === null || outputFingerprint === null || validationStatus === null)
  ) {
    throw new Error(`${description} has incomplete completed-output data`)
  }
  if (
    providerStatus !== QualitativeProviderStatus.completed
    && (output !== null || outputFingerprint !== null || validationStatus !== null)
  ) {
    throw new Error(`${description} has output data for an unsuccessful provider result`)
  }
  if (output !== null && calculateOutputFingerprint(output) !== outputFingerprint) {
    throw new Error(`${description} output does not match its stored fingerprint`)
  }

  return {
    id: requireString(record, 'id', description),
    earningsEventId: requireString(record, 'earnings_event_id', description),
    inputFingerprint: requireString(record, 'input_sha256', description),
    schemaVersion,
    promptVersion: requireString(record, 'prompt_version', description),
    requestedModel: requireString(record, 'model_name', description),
    resolvedModel: nullableString(record, 'resolved_model_name', description),
    providerStatus,
    validationStatus,
    durationMilliseconds: requireNonNegativeNumber(
      record,
      'duration_milliseconds',
      description,
    ),
    tokenUsage: parseTokenUsage(record.token_usage),
    output,
    outputFingerprint,
    latestReview: null,
    createdAt: requireTimestamp(record, 'created_at', description),
  }
}

function parseReviewDecision(value: string, description: string): ParsedQualityReview['decision'] {
  if (
    value !== QualitativeReviewDecision.accepted
    && value !== QualitativeReviewDecision.corrected
    && value !== QualitativeReviewDecision.rejected
  ) {
    throw new Error(`${description} has an unsupported decision`)
  }
  return value
}

function parseQualityReview(value: unknown): ParsedQualityReview {
  const description = 'Qualitative extraction review'
  const record = requireObject(value, description)
  const decision = parseReviewDecision(
    requireString(record, 'decision', description),
    description,
  )
  const correctedSchemaVersion = nullableString(
    record,
    'corrected_schema_version',
    description,
  )
  const correctedOutput = parseOutput(
    record.corrected_output ?? null,
    correctedSchemaVersion ?? '',
    `${description} corrected output`,
  )
  const correctedOutputFingerprint = nullableString(
    record,
    'corrected_output_sha256',
    description,
  )
  if (
    (
      decision === QualitativeReviewDecision.corrected
      && (
        correctedSchemaVersion === null
        || correctedOutput === null
        || correctedOutputFingerprint === null
      )
    )
    || (
      decision !== QualitativeReviewDecision.corrected
      && (
        correctedSchemaVersion !== null
        || correctedOutput !== null
        || correctedOutputFingerprint !== null
      )
    )
  ) {
    throw new Error(`${description} has corrected output inconsistent with its decision`)
  }
  if (
    correctedOutput !== null
    && calculateOutputFingerprint(correctedOutput) !== correctedOutputFingerprint
  ) {
    throw new Error(`${description} corrected output does not match its stored fingerprint`)
  }

  return {
    id: requireString(record, 'id', description),
    extractionRunId: requireString(record, 'extraction_run_id', description),
    reviewedOutputFingerprint: requireString(
      record,
      'reviewed_output_sha256',
      description,
    ),
    correctedSchemaVersion,
    correctedOutputFingerprint,
    decision,
    correctedOutput,
    createdAt: requireTimestamp(record, 'created_at', description),
  }
}

function isNewerReview(candidate: ParsedQualityReview, selected: ParsedQualityReview): boolean {
  const timeDifference = Date.parse(candidate.createdAt) - Date.parse(selected.createdAt)
  if (timeDifference !== 0) return timeDifference > 0
  return candidate.id > selected.id
}

export function buildQualitativeQualityRuns(
  extractionRunRows: unknown[],
  extractionReviewRows: unknown[],
): QualitativeQualityRun[] {
  const runs = extractionRunRows.map(parseQualityRun)
  const runsById = new Map<string, ParsedQualityRun>()
  for (const run of runs) {
    if (runsById.has(run.id)) throw new Error(`Duplicate qualitative extraction run ${run.id}`)
    runsById.set(run.id, run)
  }

  const latestReviewsByRunId = new Map<string, ParsedQualityReview>()
  for (const value of extractionReviewRows) {
    const review = parseQualityReview(value)
    if (!runsById.has(review.extractionRunId)) continue
    const selected = latestReviewsByRunId.get(review.extractionRunId)
    if (!selected || isNewerReview(review, selected)) {
      latestReviewsByRunId.set(review.extractionRunId, review)
    }
  }

  return runs.map(({ createdAt: _createdAt, ...run }) => {
    const latestReview = latestReviewsByRunId.get(run.id)
    if (
      latestReview
      && latestReview.reviewedOutputFingerprint !== run.outputFingerprint
    ) {
      throw new Error(`Qualitative review ${latestReview.id} does not match extraction run ${run.id}`)
    }
    return {
      ...run,
      latestReview: latestReview
        ? {
          decision: latestReview.decision,
          correctedOutput: latestReview.correctedOutput,
        }
        : null,
    }
  })
}

export async function loadQualitativeQualityRuns(
  client: SupabaseClient,
  options: LoadQualitativeQualityRunsOptions = {},
): Promise<QualitativeQualityRun[]> {
  const extractionRunRows = await fetchAllPages<unknown>(
    (from, to) => {
      let query = client
        .from(DatabaseTable.extractionRuns)
        .select(
          'id,earnings_event_id,input_sha256,schema_version,prompt_version,model_name,'
          + 'resolved_model_name,provider_status,validation_status,duration_milliseconds,'
          + 'token_usage,output,output_sha256,created_at',
        )
      if (options.extractionPurpose) {
        query = query.eq('extraction_purpose', options.extractionPurpose)
      }
      if (options.promptVersion) {
        query = query.eq('prompt_version', options.promptVersion)
      }
      return query.order('created_at').order('id').range(from, to)
    },
    'Could not load qualitative extraction runs for quality reporting',
  )
  if (extractionRunRows.length === 0) return []

  const extractionRunIds = extractionRunRows.map((value) => requireString(
    requireObject(value, 'Qualitative extraction run'),
    'id',
    'Qualitative extraction run',
  ))
  const extractionReviewRows: unknown[] = []
  for (const runIdBatch of createQualitativeQualityReviewRunIdBatches(extractionRunIds)) {
    extractionReviewRows.push(...await fetchAllPages<unknown>(
      (from, to) => client
        .from(DatabaseTable.extractionReviews)
        .select(
          'id,extraction_run_id,decision,reviewed_output_sha256,corrected_output,'
          + 'corrected_schema_version,corrected_output_sha256,created_at',
        )
        .in('extraction_run_id', runIdBatch)
        .order('created_at')
        .order('id')
        .range(from, to),
      'Could not load qualitative extraction reviews for quality reporting',
    ))
  }

  return buildQualitativeQualityRuns(extractionRunRows, extractionReviewRows)
}
