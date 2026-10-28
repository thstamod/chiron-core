import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { qualitativeExtractionSchemaVersion } from '@chiron/shared'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  DatabaseTable,
  QualitativeProviderStatus,
  QualitativeReviewDecision,
  QualitativeReviewLimit,
  QualitativeReviewVersion,
  QualitativeValidationStatus,
} from './constants.js'
import { validateAndLocateQualitativeEvidence } from './qualitative-extraction.js'
import { loadPreparedQualitativeExtractionInput } from './qualitative-input-loader.js'

export type QualitativeReviewDecisionValue =
  typeof QualitativeReviewDecision[keyof typeof QualitativeReviewDecision]

interface ExtractionRunForReview {
  id: string
  earnings_event_id: string
  cutoff_at: string
  schema_version: string
  input_sha256: string
  provider_status: string
  validation_status: string | null
  output: unknown | null
  output_sha256: string | null
}

export interface QualitativeExtractionReviewInput {
  extractionRunId: string
  decision: QualitativeReviewDecisionValue
  reviewerLabel: string
  notes: string
  correctedOutput?: unknown
}

export interface QualitativeExtractionReviewSummary extends Record<string, unknown> {
  reviewId: string
  extractionRunId: string
  decision: QualitativeReviewDecisionValue
  reviewedOutputFingerprint: string
  correctedOutputFingerprint: string | null
  reviewVersion: string
}

export function parseQualitativeReviewDecision(value: string): QualitativeReviewDecisionValue {
  const normalizedValue = value.trim()
  const decision = Object.values(QualitativeReviewDecision).find(
    (candidate) => candidate === normalizedValue,
  )
  if (!decision) {
    throw new Error(`Unknown qualitative review decision: ${normalizedValue}`)
  }
  return decision
}

function outputFingerprint(output: unknown): string {
  return calculateContentSha256(new TextEncoder().encode(canonicalJson(output)))
}

function extractionRunForReview(value: unknown): ExtractionRunForReview {
  if (!value || typeof value !== 'object') {
    throw new Error('Qualitative extraction run has an invalid database shape')
  }
  const record = value as Record<string, unknown>
  const requiredStringFields = [
    'id',
    'earnings_event_id',
    'cutoff_at',
    'schema_version',
    'input_sha256',
    'provider_status',
  ] as const
  for (const field of requiredStringFields) {
    if (typeof record[field] !== 'string' || !record[field].trim()) {
      throw new Error(`Qualitative extraction run has an invalid ${field}`)
    }
  }
  if (record.validation_status !== null && typeof record.validation_status !== 'string') {
    throw new Error('Qualitative extraction run has an invalid validation_status')
  }
  if (record.output_sha256 !== null && typeof record.output_sha256 !== 'string') {
    throw new Error('Qualitative extraction run has an invalid output_sha256')
  }
  return record as unknown as ExtractionRunForReview
}

async function loadExtractionRunForReview(
  client: SupabaseClient,
  extractionRunId: string,
): Promise<ExtractionRunForReview> {
  const { data, error } = await client
    .from(DatabaseTable.extractionRuns)
    .select(
      'id,earnings_event_id,cutoff_at,schema_version,input_sha256,'
      + 'provider_status,validation_status,output,output_sha256',
    )
    .eq('id', extractionRunId)
    .single()
  if (error) throw new Error(`Could not load qualitative extraction run: ${error.message}`)
  return extractionRunForReview(data)
}

function validateReviewInput(input: QualitativeExtractionReviewInput): void {
  if (!input.extractionRunId.trim()) throw new Error('Qualitative review requires a run ID')
  const reviewerLabel = input.reviewerLabel.trim()
  const notes = input.notes.trim()
  if (!reviewerLabel) throw new Error('Qualitative review requires a reviewer label')
  if (reviewerLabel.length > QualitativeReviewLimit.maximumReviewerLabelCharacters) {
    throw new Error('Qualitative review reviewer label is too long')
  }
  if (!notes) throw new Error('Qualitative review requires notes')
  if (notes.length > QualitativeReviewLimit.maximumNotesCharacters) {
    throw new Error('Qualitative review notes are too long')
  }
  const hasCorrectedOutput = input.correctedOutput !== undefined
  if (input.decision === QualitativeReviewDecision.corrected && !hasCorrectedOutput) {
    throw new Error('A corrected review requires corrected output')
  }
  if (input.decision !== QualitativeReviewDecision.corrected && hasCorrectedOutput) {
    throw new Error('Only a corrected review may include corrected output')
  }
}

export async function loadCorrectedQualitativeOutput(filePath: string): Promise<unknown> {
  if (!filePath.trim()) throw new Error('Corrected output file path cannot be empty')
  const absolutePath = resolve(filePath)
  try {
    return JSON.parse(await readFile(absolutePath, 'utf8')) as unknown
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not read corrected qualitative output ${absolutePath}: ${message}`)
  }
}

export async function recordQualitativeExtractionReview(
  client: SupabaseClient,
  input: QualitativeExtractionReviewInput,
): Promise<QualitativeExtractionReviewSummary> {
  validateReviewInput(input)
  const extractionRun = await loadExtractionRunForReview(client, input.extractionRunId.trim())
  if (
    extractionRun.provider_status !== QualitativeProviderStatus.completed
    || extractionRun.output === null
    || extractionRun.output_sha256 === null
  ) {
    throw new Error('Only a completed qualitative extraction can be reviewed')
  }

  const calculatedOutputFingerprint = outputFingerprint(extractionRun.output)
  if (calculatedOutputFingerprint !== extractionRun.output_sha256) {
    throw new Error('Qualitative extraction output does not match its stored fingerprint')
  }
  if (
    input.decision === QualitativeReviewDecision.accepted
    && extractionRun.validation_status !== QualitativeValidationStatus.valid
  ) {
    throw new Error('Only a locally valid qualitative extraction can be accepted')
  }

  let correctedOutput: unknown | null = null
  let correctedOutputFingerprint: string | null = null
  let correctedLocatedEvidence: unknown[] | null = null
  if (input.decision === QualitativeReviewDecision.corrected) {
    if (extractionRun.schema_version !== qualitativeExtractionSchemaVersion) {
      throw new Error(
        `Corrected output currently supports ${qualitativeExtractionSchemaVersion} extraction runs`,
      )
    }
    const preparedInput = await loadPreparedQualitativeExtractionInput(
      client,
      extractionRun.earnings_event_id,
      extractionRun.cutoff_at,
    )
    if (preparedInput.inputSha256 !== extractionRun.input_sha256) {
      throw new Error('Corrected output source input does not match the extraction run fingerprint')
    }
    const validation = validateAndLocateQualitativeEvidence(
      input.correctedOutput,
      preparedInput.documents,
    )
    correctedOutput = validation.extraction
    correctedOutputFingerprint = outputFingerprint(validation.extraction)
    correctedLocatedEvidence = validation.locatedEvidence
  }

  const { data, error } = await client
    .from(DatabaseTable.extractionReviews)
    .insert({
      extraction_run_id: extractionRun.id,
      decision: input.decision,
      reviewed_output_sha256: extractionRun.output_sha256,
      corrected_output: correctedOutput,
      corrected_schema_version: input.decision === QualitativeReviewDecision.corrected
        ? qualitativeExtractionSchemaVersion
        : null,
      corrected_output_sha256: correctedOutputFingerprint,
      corrected_located_evidence: correctedLocatedEvidence,
      reviewer_label: input.reviewerLabel.trim(),
      notes: input.notes.trim(),
      review_version: QualitativeReviewVersion.manual,
    })
    .select('id')
    .single()
  if (error) throw new Error(`Could not save qualitative extraction review: ${error.message}`)
  const reviewId = (data as { id?: unknown }).id
  if (typeof reviewId !== 'string' || !reviewId.trim()) {
    throw new Error('Saved qualitative extraction review did not return a valid ID')
  }

  return {
    reviewId,
    extractionRunId: extractionRun.id,
    decision: input.decision,
    reviewedOutputFingerprint: extractionRun.output_sha256,
    correctedOutputFingerprint,
    reviewVersion: QualitativeReviewVersion.manual,
  }
}
