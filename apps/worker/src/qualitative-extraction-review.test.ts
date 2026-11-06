import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QualitativeExtraction } from '@chiron/shared'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  DatabaseTable,
  QualitativeExtractionPurpose,
  QualitativeProviderStatus,
  QualitativeReviewDecision,
  QualitativeReviewVersion,
  QualitativeSourceAvailabilityMode,
  SecDocumentType,
  QualitativeValidationStatus,
} from './constants.js'
import { documentTextExtractionVersion } from './document-text.js'
import { prepareHistoricalReconstructionPlan } from './historical-reconstruction-plan.js'
import { prepareQualitativeExtractionInput } from './qualitative-extraction.js'
import {
  parseQualitativeReviewDecision,
  recordQualitativeExtractionReview,
} from './qualitative-extraction-review.js'

const extractionOutput: QualitativeExtraction = {
  guidance: { status: 'not_provided', items: [], summary: null, evidence: [] },
  marginDirection: { direction: 'not_disclosed', summary: null, evidence: [] },
  managementTone: {
    currentTone: 'unclear',
    changeFromPrevious: 'unavailable',
    summary: null,
    currentEvidence: [],
    previousEvidence: [],
  },
  keyPositives: [],
  keyRisks: [],
  summary: 'The source did not contain enough qualitative information.',
  sourceLimitations: ['No previous release was supplied.'],
}

function fingerprint(output: unknown): string {
  return calculateContentSha256(new TextEncoder().encode(canonicalJson(output)))
}

function extractionRun(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    earnings_event_id: '22222222-2222-4222-8222-222222222222',
    cutoff_at: '2026-10-28T10:00:00.000Z',
    schema_version: 'qualitative-earnings-v4',
    input_sha256: 'input-fingerprint',
    extraction_purpose: QualitativeExtractionPurpose.forwardPrediction,
    historical_reconstruction_plan_id: null,
    provider_status: QualitativeProviderStatus.completed,
    validation_status: QualitativeValidationStatus.valid,
    output: extractionOutput,
    output_sha256: fingerprint(extractionOutput),
    ...overrides,
  }
}

function reviewClient(run: Record<string, unknown>): {
  client: SupabaseClient
  insertedRecords: Record<string, unknown>[]
} {
  const insertedRecords: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      if (table === DatabaseTable.extractionRuns) {
        const query = {
          select() { return query },
          eq() { return query },
          async single() { return { data: run, error: null } },
        }
        return query
      }
      if (table === DatabaseTable.extractionReviews) {
        return {
          insert(record: Record<string, unknown>) {
            insertedRecords.push(record)
            const query = {
              select() { return query },
              async single() {
                return { data: { id: '33333333-3333-4333-8333-333333333333' }, error: null }
              },
            }
            return query
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  } as unknown as SupabaseClient
  return { client, insertedRecords }
}

test('parses only supported qualitative review decisions', () => {
  assert.equal(
    parseQualitativeReviewDecision('accepted'),
    QualitativeReviewDecision.accepted,
  )
  assert.throws(
    () => parseQualitativeReviewDecision('approved'),
    /Unknown qualitative review decision/,
  )
})

test('stores an accepted review without correction fields', async () => {
  const { client, insertedRecords } = reviewClient(extractionRun())
  const summary = await recordQualitativeExtractionReview(client, {
    extractionRunId: '11111111-1111-4111-8111-111111111111',
    decision: QualitativeReviewDecision.accepted,
    reviewerLabel: ' owner-manual-review ',
    notes: ' Reviewed the evidence. ',
  })

  assert.equal(summary.decision, QualitativeReviewDecision.accepted)
  assert.equal(summary.reviewVersion, QualitativeReviewVersion.manual)
  assert.equal(insertedRecords.length, 1)
  assert.equal(insertedRecords[0]?.corrected_output, null)
  assert.equal(insertedRecords[0]?.corrected_output_sha256, null)
  assert.equal(insertedRecords[0]?.reviewer_label, 'owner-manual-review')
  assert.equal(insertedRecords[0]?.notes, 'Reviewed the evidence.')
})

test('rejects an accepted extraction that failed local validation', async () => {
  const { client, insertedRecords } = reviewClient(extractionRun({
    validation_status: QualitativeValidationStatus.invalid,
  }))

  await assert.rejects(
    recordQualitativeExtractionReview(client, {
      extractionRunId: '11111111-1111-4111-8111-111111111111',
      decision: QualitativeReviewDecision.accepted,
      reviewerLabel: 'owner-manual-review',
      notes: 'Attempted acceptance.',
    }),
    /Only a locally valid qualitative extraction can be accepted/,
  )
  assert.equal(insertedRecords.length, 0)
})

test('rejects extraction output that does not match its stored fingerprint', async () => {
  const { client, insertedRecords } = reviewClient(extractionRun({
    output_sha256: '0'.repeat(64),
  }))

  await assert.rejects(
    recordQualitativeExtractionReview(client, {
      extractionRunId: '11111111-1111-4111-8111-111111111111',
      decision: QualitativeReviewDecision.rejected,
      reviewerLabel: 'owner-manual-review',
      notes: 'Fingerprint verification.',
    }),
    /does not match its stored fingerprint/,
  )
  assert.equal(insertedRecords.length, 0)
})

test('requires corrected output only for corrected decisions', async () => {
  const { client } = reviewClient(extractionRun())

  await assert.rejects(
    recordQualitativeExtractionReview(client, {
      extractionRunId: '11111111-1111-4111-8111-111111111111',
      decision: QualitativeReviewDecision.corrected,
      reviewerLabel: 'owner-manual-review',
      notes: 'Correction required.',
    }),
    /requires corrected output/,
  )
})

test('validates a historical correction through its immutable reconstruction plan', async () => {
  const earningsEventId = '22222222-2222-4222-8222-222222222222'
  const historicalPlanId = '44444444-4444-4444-8444-444444444444'
  const cutoffAt = '2026-08-05T11:20:09.000Z'
  const readableText = 'Disney maintained its full-year outlook.'
  const readableTextBytes = new TextEncoder().encode(readableText)
  const sourceFingerprint = 'a'.repeat(64)
  const readableTextFingerprint = calculateContentSha256(readableTextBytes)
  const sourceDocument = {
    documentId: '55555555-5555-4555-8555-555555555555',
    role: 'current' as const,
    documentType: SecDocumentType.earningsExhibit,
    publishedAt: '2026-08-05T11:05:09.000Z',
    firstSeenAt: '2026-11-01T10:00:00.000Z',
    sourceContentSha256: sourceFingerprint,
    textExtractionVersion: documentTextExtractionVersion,
    textContentSha256: readableTextFingerprint,
    text: readableText,
  }
  const preparedInput = prepareQualitativeExtractionInput(
    earningsEventId,
    cutoffAt,
    [sourceDocument],
    {
      sourceAvailabilityMode: QualitativeSourceAvailabilityMode.historicalReconstruction,
    },
  )
  const historicalPlanRecord = prepareHistoricalReconstructionPlan(
    preparedInput.manifest,
    preparedInput.inputSha256,
    'historical-review-test-v1',
  ).record
  const run = extractionRun({
    earnings_event_id: earningsEventId,
    cutoff_at: cutoffAt,
    input_sha256: preparedInput.inputSha256,
    extraction_purpose: QualitativeExtractionPurpose.historicalReconstruction,
    historical_reconstruction_plan_id: historicalPlanId,
  })
  const insertedRecords: Record<string, unknown>[] = []
  const documentRow = {
    id: sourceDocument.documentId,
    earnings_event_id: earningsEventId,
    document_type: sourceDocument.documentType,
    published_at: sourceDocument.publishedAt,
    first_seen_at: sourceDocument.firstSeenAt,
    content_sha256: sourceFingerprint,
    document_text_versions: {
      extraction_version: documentTextExtractionVersion,
      source_content_sha256: sourceFingerprint,
      storage_path: 'derived-text/disney.txt',
      content_sha256: readableTextFingerprint,
    },
  }

  const client = {
    from(table: string) {
      if (table === DatabaseTable.extractionRuns) {
        const query = {
          select() { return query },
          eq() { return query },
          async single() { return { data: run, error: null } },
        }
        return query
      }
      if (table === DatabaseTable.historicalReconstructionPlans) {
        const query = {
          select() { return query },
          eq() { return query },
          async single() {
            return {
              data: {
                id: historicalPlanId,
                ...historicalPlanRecord,
                recorded_at: '2026-11-06T12:00:00.000Z',
              },
              error: null,
            }
          },
        }
        return query
      }
      if (table === DatabaseTable.earningsEvents) {
        const query = {
          select() { return query },
          eq() { return query },
          async single() {
            return { data: { id: earningsEventId, previous_event_id: null }, error: null }
          },
        }
        return query
      }
      if (table === DatabaseTable.documents) {
        const result = Promise.resolve({ data: [documentRow], error: null })
        const query = {
          select() { return query },
          in() { return query },
          eq() { return query },
          lte() { return query },
          order() { return query },
          then: result.then.bind(result),
        }
        return query
      }
      if (table === DatabaseTable.extractionReviews) {
        return {
          insert(record: Record<string, unknown>) {
            insertedRecords.push(record)
            const query = {
              select() { return query },
              async single() {
                return { data: { id: '33333333-3333-4333-8333-333333333333' }, error: null }
              },
            }
            return query
          },
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
    storage: {
      from() {
        return {
          async download() {
            return { data: new Blob([readableTextBytes]), error: null }
          },
        }
      },
    },
  } as unknown as SupabaseClient

  const summary = await recordQualitativeExtractionReview(client, {
    extractionRunId: run.id as string,
    decision: QualitativeReviewDecision.corrected,
    reviewerLabel: 'owner-manual-review',
    notes: 'Corrected historical extraction.',
    correctedOutput: extractionOutput,
  })

  assert.equal(summary.decision, QualitativeReviewDecision.corrected)
  assert.equal(insertedRecords.length, 1)
  assert.deepEqual(insertedRecords[0]?.corrected_output, extractionOutput)
  assert.equal(
    insertedRecords[0]?.corrected_output_sha256,
    fingerprint(extractionOutput),
  )
})
