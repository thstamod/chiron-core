import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QualitativeExtraction } from '@chiron/shared'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  DatabaseTable,
  QualitativeProviderStatus,
  QualitativeReviewDecision,
  QualitativeReviewVersion,
  QualitativeValidationStatus,
} from './constants.js'
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
