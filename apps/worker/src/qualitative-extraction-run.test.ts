import assert from 'node:assert/strict'
import test from 'node:test'
import type { QualitativeExtraction } from '@chiron/shared'
import {
  QualitativeProviderStatus,
  QualitativeValidationStatus,
} from './constants.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  prepareQualitativeExtractionInput,
  type QualitativeSourceDocument,
} from './qualitative-extraction.js'
import { buildQualitativeExtractionRunRecord } from './qualitative-extraction-run.js'
import type { QualitativeProviderResult } from './qualitative-provider.js'

const documentText = 'Management expects continued demand.'
const currentDocument: QualitativeSourceDocument = {
  documentId: '11111111-1111-4111-8111-111111111111',
  role: 'current',
  documentType: 'sec-exhibit-99.1',
  publishedAt: '2026-10-20T20:00:00.000Z',
  firstSeenAt: '2026-10-20T20:05:00.000Z',
  sourceContentSha256: 'source-fingerprint',
  textExtractionVersion: 'readable-text-v1',
  textContentSha256: calculateContentSha256(new TextEncoder().encode(documentText)),
  text: documentText,
}
const preparedInput = prepareQualitativeExtractionInput(
  'event-1',
  '2026-10-20T21:00:00.000Z',
  [currentDocument],
)
const tokenUsage = {
  inputTokens: 1_000,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 200,
  reasoningTokens: 50,
  totalTokens: 1_200,
}

function extraction(guidanceQuote: string): QualitativeExtraction {
  return {
    guidance: {
      change: 'maintained',
      summary: 'Management maintained its demand outlook.',
      evidence: [{ sourceDocumentId: currentDocument.documentId, quote: guidanceQuote }],
    },
    marginDirection: { direction: 'not_disclosed', summary: null, evidence: [] },
    managementTone: {
      currentTone: 'unclear',
      changeFromPrevious: 'unavailable',
      summary: null,
      evidence: [],
    },
    keyPositives: [],
    keyRisks: [],
    summary: 'Management maintained its demand outlook.',
    sourceLimitations: ['No previous release was supplied.'],
  }
}

function completedResult(output: QualitativeExtraction): QualitativeProviderResult {
  return {
    status: QualitativeProviderStatus.completed,
    extraction: output,
    providerName: 'openai',
    providerRequestId: 'response-1',
    requestedModel: 'requested-model',
    resolvedModel: 'resolved-model',
    startedAt: '2026-10-20T21:00:01.000Z',
    finishedAt: '2026-10-20T21:00:02.000Z',
    durationMilliseconds: 1_000,
    tokenUsage,
  }
}

test('builds a valid permanent record after exact evidence validation', () => {
  const record = buildQualitativeExtractionRunRecord(
    preparedInput,
    'baseline-v1',
    completedResult(extraction(documentText)),
  )

  assert.equal(record.provider_status, QualitativeProviderStatus.completed)
  assert.equal(record.validation_status, QualitativeValidationStatus.valid)
  assert.equal(record.failure_reason, null)
  assert.equal(record.output_sha256?.length, 64)
  assert.equal(record.located_evidence?.length, 1)
  assert.equal(record.validation_errors, null)
})

test('preserves completed output that fails evidence validation', () => {
  const record = buildQualitativeExtractionRunRecord(
    preparedInput,
    'baseline-v1',
    completedResult(extraction('This quote is not in the document.')),
  )

  assert.equal(record.provider_status, QualitativeProviderStatus.completed)
  assert.equal(record.validation_status, QualitativeValidationStatus.invalid)
  assert.notEqual(record.output, null)
  assert.equal(record.located_evidence, null)
  assert.match(record.validation_errors?.[0] ?? '', /does not exactly match/)
})

test('builds an unsuccessful record without fake output or validation', () => {
  const failedResult: QualitativeProviderResult = {
    status: QualitativeProviderStatus.requestFailed,
    extraction: null,
    failureReason: 'Temporary connection failure',
    retryable: true,
    providerName: 'openai',
    providerRequestId: null,
    requestedModel: 'requested-model',
    resolvedModel: null,
    startedAt: '2026-10-20T21:00:01.000Z',
    finishedAt: '2026-10-20T21:00:02.000Z',
    durationMilliseconds: 1_000,
    tokenUsage,
  }
  const record = buildQualitativeExtractionRunRecord(
    preparedInput,
    'baseline-v1',
    failedResult,
  )

  assert.equal(record.output, null)
  assert.equal(record.output_sha256, null)
  assert.equal(record.validation_status, null)
  assert.equal(record.failure_reason, 'Temporary connection failure')
  assert.equal(record.retryable, true)
})
