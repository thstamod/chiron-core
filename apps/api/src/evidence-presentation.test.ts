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
  return {
    qualitative: {
      run: {
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
        effective: {
          schemaVersion: 'qualitative-earnings-v4',
          output: {
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
          },
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

  assert.deepEqual(result, {
    predictionId,
    extractionSchemaVersion: 'qualitative-earnings-v4',
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
