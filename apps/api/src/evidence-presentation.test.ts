import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseFrozenPredictionEvidence,
  presentPredictionEvidence,
  type EvidenceDocumentRow,
} from './evidence-presentation.js'

const documentId = 'dc9bc5ee-3fab-463f-9f9c-f6c80fa40863'
const predictionId = '2a545c05-ef0e-43ea-88a1-1ab0f610a7e9'
const quote = 'Capital spending increased.'

function snapshot(): unknown {
  const output = {
    guidance: { status: 'not_provided', items: [], summary: null, evidence: [] },
    marginDirection: { direction: 'not_disclosed', summary: null, evidence: [] },
    managementTone: {
      currentTone: 'neutral',
      changeFromPrevious: 'unavailable',
      summary: null,
      currentEvidence: [],
      previousEvidence: [],
    },
    keyPositives: [],
    keyRisks: [{
      statement: 'Capital spending is a material risk.',
      evidence: [{ passageId: 'current-p0001' }],
    }],
    summary: 'Capital spending was the principal identified risk.',
    sourceLimitations: [],
  }
  return {
    qualitative: {
      run: {
        id: 'run-1',
        provider_name: 'openai',
        provider_request_id: 'request-1',
        resolved_model_name: 'gpt-test',
        input_selection_version: 'qualitative-input-selection-v1',
        started_at: '2026-10-30T17:00:00.000Z',
        finished_at: '2026-10-30T17:01:00.000Z',
        token_usage: { inputTokens: 100, outputTokens: 50 },
        input_manifest: {
          documents: [{
            documentId,
            role: 'current',
            documentType: 'sec-exhibit-99.1',
            publishedAt: '2026-10-29T20:05:27.000Z',
            firstSeenAt: '2026-10-29T21:49:05.510Z',
            sourceContentSha256: 'source-fingerprint',
          }],
        },
      },
      effectiveExtraction: {
        extractionRunId: 'run-1',
        cutoffAt: '2026-10-30T17:00:00.000Z',
        promptVersion: 'baseline-v6',
        modelName: 'gpt-test',
        original: {
          schemaVersion: 'qualitative-earnings-v4',
          validationStatus: 'valid',
          output,
          outputFingerprint: 'a'.repeat(64),
        },
        review: {
          id: 'review-1',
          decision: 'accepted',
          reviewerLabel: 'owner',
          notes: 'Reviewed against SEC evidence.',
          version: 'manual-qualitative-review-v1',
          createdAt: '2026-10-30T17:30:00.000Z',
        },
        effective: {
          source: 'original',
          schemaVersion: 'qualitative-earnings-v4',
          output,
          outputFingerprint: 'a'.repeat(64),
          locatedEvidence: [{
            fieldPath: 'keyRisks[0].evidence[0]',
            evidence: { passageId: 'current-p0001' },
            sourceDocumentId: documentId,
            quote,
            match: { startCharacter: 100, endCharacter: 100 + quote.length },
          }],
        },
      },
    },
  }
}

function databaseDocument(sourceUrl = 'https://www.sec.gov/Archives/edgar/data/1/report.htm'):
EvidenceDocumentRow {
  return {
    id: documentId,
    document_type: 'sec-exhibit-99.1',
    source_url: sourceUrl,
    published_at: '2026-10-29T20:05:27.000Z',
    first_seen_at: '2026-10-29T21:49:05.510Z',
    content_sha256: 'source-fingerprint',
  }
}

test('presents a frozen claim with its exact verified SEC evidence', () => {
  const frozen = parseFrozenPredictionEvidence(snapshot())
  const result = presentPredictionEvidence(predictionId, frozen, [databaseDocument()])

  assert.equal(result.extractionAudit.validationStatus, 'valid')
  assert.equal(result.extractionAudit.reviewDecision, 'accepted')
  assert.equal(result.extractionAudit.effectiveSource, 'original')
  assert.deepEqual(
    JSON.parse(result.extractionAudit.originalOutputJson),
    JSON.parse(result.extractionAudit.effectiveOutputJson),
  )
  assert.deepEqual(result, {
    predictionId,
    extractionSchemaVersion: 'qualitative-earnings-v4',
    extractionAudit: frozen.extractionAudit,
    evidence: [{
      fieldPath: 'keyRisks[0].evidence[0]',
      category: 'key_risk',
      claim: 'Capital spending is a material risk.',
      passageId: 'current-p0001',
      quote,
      startCharacter: 100,
      endCharacter: 100 + quote.length,
      source: {
        documentId,
        role: 'current',
        documentType: 'sec-exhibit-99.1',
        publishedAt: '2026-10-29T20:05:27.000Z',
        sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/report.htm',
      },
    }],
  })
})

test('rejects a source URL outside the official SEC archive', () => {
  const frozen = parseFrozenPredictionEvidence(snapshot())
  assert.throws(
    () => presentPredictionEvidence(
      predictionId,
      frozen,
      [databaseDocument('https://example.com/report.htm')],
    ),
    /not an approved SEC archive URL/,
  )
})
