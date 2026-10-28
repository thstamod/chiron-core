import type { SupabaseClient } from '@supabase/supabase-js'
import {
  qualitativeExtractionSchema,
  qualitativeExtractionSchemaVersion,
  type QualitativeExtraction,
} from '@chiron/shared'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  DatabaseTable,
  QualitativeEffectiveOutputSource,
  QualitativeProviderStatus,
  QualitativeReviewDecision,
  QualitativeValidationStatus,
  type QualitativeEffectiveOutputSourceValue,
} from './constants.js'
import { fetchAllPages } from './pagination.js'

interface EffectiveExtractionRunRow {
  id: string
  earnings_event_id: string
  cutoff_at: string
  schema_version: string
  prompt_version: string
  model_name: string
  provider_status: string
  validation_status: string | null
  output: unknown | null
  output_sha256: string | null
  located_evidence: unknown[] | null
  created_at: string
}

interface EffectiveExtractionReviewRow {
  id: string
  extraction_run_id: string
  decision: string
  reviewed_output_sha256: string
  corrected_output: unknown | null
  corrected_schema_version: string | null
  corrected_output_sha256: string | null
  corrected_located_evidence: unknown[] | null
  reviewer_label: string
  notes: string
  review_version: string
  created_at: string
}

export interface EffectiveQualitativeExtraction {
  earningsEventId: string
  extractionRunId: string
  cutoffAt: string
  promptVersion: string
  modelName: string
  original: {
    schemaVersion: string
    validationStatus: string
    output: QualitativeExtraction
    outputFingerprint: string
    locatedEvidence: unknown[] | null
  }
  review: {
    id: string
    decision:
      | typeof QualitativeReviewDecision.accepted
      | typeof QualitativeReviewDecision.corrected
    reviewerLabel: string
    notes: string
    version: string
    createdAt: string
  }
  effective: {
    source: QualitativeEffectiveOutputSourceValue
    schemaVersion: string
    output: QualitativeExtraction
    outputFingerprint: string
    locatedEvidence: unknown[]
  }
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

function optionalString(
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

function optionalArray(
  record: Record<string, unknown>,
  fieldName: string,
  description: string,
): unknown[] | null {
  const value = record[fieldName]
  if (value !== null && !Array.isArray(value)) {
    throw new Error(`${description} has an invalid ${fieldName}`)
  }
  return value as unknown[] | null
}

function extractionRunRow(value: unknown): EffectiveExtractionRunRow {
  const description = 'Qualitative extraction run'
  const record = requireObject(value, description)
  const cutoffAt = requireString(record, 'cutoff_at', description)
  const createdAt = requireString(record, 'created_at', description)
  validTimestamp(cutoffAt, 'cutoff_at', description)
  validTimestamp(createdAt, 'created_at', description)
  return {
    id: requireString(record, 'id', description),
    earnings_event_id: requireString(record, 'earnings_event_id', description),
    cutoff_at: cutoffAt,
    schema_version: requireString(record, 'schema_version', description),
    prompt_version: requireString(record, 'prompt_version', description),
    model_name: requireString(record, 'model_name', description),
    provider_status: requireString(record, 'provider_status', description),
    validation_status: optionalString(record, 'validation_status', description),
    output: record.output ?? null,
    output_sha256: optionalString(record, 'output_sha256', description),
    located_evidence: optionalArray(record, 'located_evidence', description),
    created_at: createdAt,
  }
}

function extractionReviewRow(value: unknown): EffectiveExtractionReviewRow {
  const description = 'Qualitative extraction review'
  const record = requireObject(value, description)
  const createdAt = requireString(record, 'created_at', description)
  validTimestamp(createdAt, 'created_at', description)
  return {
    id: requireString(record, 'id', description),
    extraction_run_id: requireString(record, 'extraction_run_id', description),
    decision: requireString(record, 'decision', description),
    reviewed_output_sha256: requireString(record, 'reviewed_output_sha256', description),
    corrected_output: record.corrected_output ?? null,
    corrected_schema_version: optionalString(record, 'corrected_schema_version', description),
    corrected_output_sha256: optionalString(record, 'corrected_output_sha256', description),
    corrected_located_evidence: optionalArray(
      record,
      'corrected_located_evidence',
      description,
    ),
    reviewer_label: requireString(record, 'reviewer_label', description),
    notes: requireString(record, 'notes', description),
    review_version: requireString(record, 'review_version', description),
    created_at: createdAt,
  }
}

function validTimestamp(value: string, fieldName: string, description: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`${description} has an invalid ${fieldName}`)
  return parsed
}

function compareNewestReview(
  left: EffectiveExtractionReviewRow,
  right: EffectiveExtractionReviewRow,
): number {
  const timeDifference = validTimestamp(
    right.created_at,
    'created_at',
    'Qualitative extraction review',
  ) - validTimestamp(left.created_at, 'created_at', 'Qualitative extraction review')
  return timeDifference || right.id.localeCompare(left.id)
}

function fingerprint(output: unknown): string {
  return calculateContentSha256(new TextEncoder().encode(canonicalJson(output)))
}

function parsedOutput(output: unknown, schemaVersion: string): QualitativeExtraction {
  if (schemaVersion !== qualitativeExtractionSchemaVersion) {
    throw new Error(`Unsupported qualitative extraction schema version: ${schemaVersion}`)
  }
  const result = qualitativeExtractionSchema.safeParse(output)
  if (!result.success) throw new Error('Effective qualitative output does not match its schema')
  return result.data
}

function effectiveCandidate(
  run: EffectiveExtractionRunRow,
  review: EffectiveExtractionReviewRow,
): EffectiveQualitativeExtraction | null {
  if (
    run.provider_status !== QualitativeProviderStatus.completed
    || run.output === null
    || run.output_sha256 === null
  ) {
    throw new Error(`Reviewed extraction run ${run.id} has no completed output`)
  }
  if (run.validation_status === null) {
    throw new Error(`Reviewed extraction run ${run.id} has no validation status`)
  }
  const originalFingerprint = fingerprint(run.output)
  if (
    originalFingerprint !== run.output_sha256
    || review.reviewed_output_sha256 !== run.output_sha256
  ) {
    throw new Error(`Reviewed extraction run ${run.id} does not match its output fingerprint`)
  }
  const originalOutput = parsedOutput(run.output, run.schema_version)

  if (review.decision === QualitativeReviewDecision.rejected) return null

  let effectiveOutput: QualitativeExtraction
  let effectiveFingerprint: string
  let effectiveSchemaVersion: string
  let effectiveLocatedEvidence: unknown[]
  let effectiveSource: EffectiveQualitativeExtraction['effective']['source']

  if (review.decision === QualitativeReviewDecision.accepted) {
    if (
      run.validation_status !== QualitativeValidationStatus.valid
      || run.located_evidence === null
    ) {
      throw new Error(`Accepted extraction run ${run.id} is not locally valid`)
    }
    effectiveOutput = originalOutput
    effectiveFingerprint = originalFingerprint
    effectiveSchemaVersion = run.schema_version
    effectiveLocatedEvidence = run.located_evidence
    effectiveSource = QualitativeEffectiveOutputSource.original
  } else if (review.decision === QualitativeReviewDecision.corrected) {
    if (
      review.corrected_output === null
      || review.corrected_schema_version === null
      || review.corrected_output_sha256 === null
      || review.corrected_located_evidence === null
    ) {
      throw new Error(`Corrected review ${review.id} has incomplete corrected output`)
    }
    effectiveOutput = parsedOutput(
      review.corrected_output,
      review.corrected_schema_version,
    )
    effectiveFingerprint = fingerprint(effectiveOutput)
    if (effectiveFingerprint !== review.corrected_output_sha256) {
      throw new Error(`Corrected review ${review.id} does not match its output fingerprint`)
    }
    effectiveSchemaVersion = review.corrected_schema_version
    effectiveLocatedEvidence = review.corrected_located_evidence
    effectiveSource = QualitativeEffectiveOutputSource.correctedReview
  } else {
    throw new Error(`Unsupported qualitative review decision: ${review.decision}`)
  }

  return {
    earningsEventId: run.earnings_event_id,
    extractionRunId: run.id,
    cutoffAt: run.cutoff_at,
    promptVersion: run.prompt_version,
    modelName: run.model_name,
    original: {
      schemaVersion: run.schema_version,
      validationStatus: run.validation_status,
      output: originalOutput,
      outputFingerprint: originalFingerprint,
      locatedEvidence: run.located_evidence,
    },
    review: {
      id: review.id,
      decision: review.decision,
      reviewerLabel: review.reviewer_label,
      notes: review.notes,
      version: review.review_version,
      createdAt: review.created_at,
    },
    effective: {
      source: effectiveSource,
      schemaVersion: effectiveSchemaVersion,
      output: effectiveOutput,
      outputFingerprint: effectiveFingerprint,
      locatedEvidence: effectiveLocatedEvidence,
    },
  }
}

export function selectEffectiveQualitativeExtraction(
  extractionRuns: unknown[],
  extractionReviews: unknown[],
): EffectiveQualitativeExtraction | null {
  const runs = extractionRuns.map(extractionRunRow)
  const eventIds = new Set(runs.map((run) => run.earnings_event_id))
  if (eventIds.size > 1) {
    throw new Error('Effective extraction selection cannot mix earnings events')
  }
  const runsById = new Map(runs.map((run) => [run.id, run]))
  const reviewsByRunId = new Map<string, EffectiveExtractionReviewRow[]>()

  for (const value of extractionReviews) {
    const review = extractionReviewRow(value)
    if (!runsById.has(review.extraction_run_id)) {
      throw new Error(`Qualitative review ${review.id} references an unavailable extraction run`)
    }
    const reviews = reviewsByRunId.get(review.extraction_run_id) ?? []
    reviews.push(review)
    reviewsByRunId.set(review.extraction_run_id, reviews)
  }

  const candidates: EffectiveQualitativeExtraction[] = []
  for (const run of runs) {
    const latestReview = reviewsByRunId.get(run.id)?.sort(compareNewestReview)[0]
    if (!latestReview) continue
    const candidate = effectiveCandidate(run, latestReview)
    if (candidate) candidates.push(candidate)
  }

  candidates.sort((left, right) => {
    const timeDifference = validTimestamp(
      right.review.createdAt,
      'created_at',
      'Qualitative extraction review',
    ) - validTimestamp(left.review.createdAt, 'created_at', 'Qualitative extraction review')
    return timeDifference || right.review.id.localeCompare(left.review.id)
  })
  return candidates[0] ?? null
}

export async function loadEffectiveQualitativeExtraction(
  client: SupabaseClient,
  earningsEventId: string,
): Promise<EffectiveQualitativeExtraction | null> {
  if (!earningsEventId.trim()) throw new Error('Effective extraction requires an event ID')

  const runs = await fetchAllPages<unknown>(
    (from, to) => client
      .from(DatabaseTable.extractionRuns)
      .select(
        'id,earnings_event_id,cutoff_at,schema_version,prompt_version,model_name,'
        + 'provider_status,validation_status,output,output_sha256,located_evidence,created_at',
      )
      .eq('earnings_event_id', earningsEventId)
      .order('created_at')
      .order('id')
      .range(from, to),
    'Could not load qualitative extraction runs',
  )
  if (runs.length === 0) return null

  const runIds = runs.map((value) => extractionRunRow(value).id)
  const reviews = await fetchAllPages<unknown>(
    (from, to) => client
      .from(DatabaseTable.extractionReviews)
      .select(
        'id,extraction_run_id,decision,reviewed_output_sha256,corrected_output,'
        + 'corrected_schema_version,corrected_output_sha256,corrected_located_evidence,'
        + 'reviewer_label,notes,review_version,created_at',
      )
      .in('extraction_run_id', runIds)
      .order('created_at')
      .order('id')
      .range(from, to),
    'Could not load qualitative extraction reviews',
  )

  return selectEffectiveQualitativeExtraction(runs, reviews)
}
