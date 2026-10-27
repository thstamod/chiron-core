import assert from 'node:assert/strict'
import test from 'node:test'
import { qualitativeExtractionSchema, type QualitativeExtraction } from '@chiron/shared'
import {
  prepareQualitativeExtractionInput,
  validateAndLocateQualitativeEvidence,
  type QualitativeSourceDocument,
} from './qualitative-extraction.js'
import { calculateContentSha256 } from './content-hash.js'

const currentDocumentId = '11111111-1111-4111-8111-111111111111'
const previousDocumentId = '22222222-2222-4222-8222-222222222222'

function sourceDocument(
  documentId: string,
  role: 'current' | 'previous',
  publishedAt: string,
  text: string,
): QualitativeSourceDocument {
  return {
    documentId,
    role,
    documentType: 'sec-exhibit-99.1',
    publishedAt,
    firstSeenAt: publishedAt,
    sourceContentSha256: `source-${documentId}`,
    textExtractionVersion: 'sec-html-text-v3',
    textContentSha256: calculateContentSha256(new TextEncoder().encode(text)),
    text,
  }
}

const currentDocument = sourceDocument(
  currentDocumentId,
  'current',
  '2026-10-20T20:00:00.000Z',
  'Revenue increased 20%. Management expects continued demand. Supply constraints remain.',
)

const previousDocument = sourceDocument(
  previousDocumentId,
  'previous',
  '2025-10-20T20:00:00.000Z',
  'Revenue increased 10%. Management expects stable demand.',
)

function comparativeExtraction(): QualitativeExtraction {
  return {
    guidance: {
      change: 'maintained',
      summary: 'Management maintained its demand outlook.',
      evidence: [{
        sourceDocumentId: currentDocumentId,
        quote: 'Management expects continued demand.',
      }],
    },
    marginDirection: {
      direction: 'improving',
      summary: 'Revenue growth supports an improving direction.',
      evidence: [{
        sourceDocumentId: currentDocumentId,
        quote: 'Revenue increased 20%.',
      }],
    },
    managementTone: {
      currentTone: 'positive',
      changeFromPrevious: 'more_positive',
      summary: 'Management used stronger demand language than in the previous release.',
      evidence: [
        {
          sourceDocumentId: currentDocumentId,
          quote: 'Management expects continued demand.',
        },
        {
          sourceDocumentId: previousDocumentId,
          quote: 'Management expects stable demand.',
        },
      ],
    },
    keyPositives: [{
      statement: 'Revenue growth accelerated.',
      evidence: [{
        sourceDocumentId: currentDocumentId,
        quote: 'Revenue increased 20%.',
      }],
    }],
    keyRisks: [{
      statement: 'Supply remains constrained.',
      evidence: [{
        sourceDocumentId: currentDocumentId,
        quote: 'Supply constraints remain.',
      }],
    }],
    summary: 'Revenue growth accelerated while management remained positive about demand.',
    sourceLimitations: [],
  }
}

function currentOnlyExtraction(): QualitativeExtraction {
  const extraction = comparativeExtraction()
  extraction.guidance = {
    change: 'not_provided',
    summary: null,
    evidence: [],
  }
  extraction.marginDirection = {
    direction: 'not_disclosed',
    summary: null,
    evidence: [],
  }
  extraction.managementTone = {
    currentTone: 'positive',
    changeFromPrevious: 'unavailable',
    summary: 'Management expects continued demand.',
    evidence: [{
      sourceDocumentId: currentDocumentId,
      quote: 'Management expects continued demand.',
    }],
  }
  return extraction
}

test('accepts a valid structured extraction and locates exact evidence', () => {
  const result = validateAndLocateQualitativeEvidence(
    comparativeExtraction(),
    [currentDocument, previousDocument],
  )

  assert.equal(result.locatedEvidence.length, 6)
  assert.deepEqual(result.locatedEvidence[0]?.matches, [{
    startCharacter: 23,
    endCharacter: 59,
  }])
})

test('rejects an evidence quote that is not present verbatim', () => {
  const extraction = comparativeExtraction()
  extraction.keyRisks[0]!.evidence[0]!.quote = 'Supply constraints improved.'

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /does not exactly match its source document/,
  )
})

test('rejects evidence that references an unknown document', () => {
  const extraction = comparativeExtraction()
  extraction.keyRisks[0]!.evidence[0]!.sourceDocumentId =
    '33333333-3333-4333-8333-333333333333'

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /references unknown document/,
  )
})

test('requires both source periods for a concrete tone comparison', () => {
  const extraction = comparativeExtraction()
  extraction.managementTone.evidence = [extraction.managementTone.evidence[0]!]

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /requires current and previous document evidence/,
  )
})

test('requires unavailable tone change when no previous document is supplied', () => {
  const extraction = comparativeExtraction()
  extraction.managementTone.evidence = [extraction.managementTone.evidence[0]!]

  assert.throws(
    () => validateAndLocateQualitativeEvidence(extraction, [currentDocument]),
    /must be unavailable/,
  )
})

test('accepts explicit unavailable values for a current-only extraction', () => {
  const result = validateAndLocateQualitativeEvidence(
    currentOnlyExtraction(),
    [currentDocument],
  )

  assert.equal(result.extraction.managementTone.changeFromPrevious, 'unavailable')
  assert.equal(result.locatedEvidence.length, 3)
})

test('requires evidence and a summary for a concrete guidance change', () => {
  const withoutEvidence = comparativeExtraction()
  withoutEvidence.guidance.evidence = []
  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      withoutEvidence,
      [currentDocument, previousDocument],
    ),
    /requires supporting evidence/,
  )

  const withoutSummary = comparativeExtraction()
  withoutSummary.guidance.summary = null
  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      withoutSummary,
      [currentDocument, previousDocument],
    ),
    /requires a summary/,
  )
})

test('requires current-document evidence for current guidance', () => {
  const extraction = comparativeExtraction()
  extraction.guidance.evidence = [{
    sourceDocumentId: previousDocumentId,
    quote: 'Management expects stable demand.',
  }]

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /requires evidence from the current document/,
  )
})

test('requires current-document evidence for current positives and risks', () => {
  const extraction = comparativeExtraction()
  extraction.keyRisks[0]!.evidence = [{
    sourceDocumentId: previousDocumentId,
    quote: 'Management expects stable demand.',
  }]

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /keyRisks\[0\] requires evidence from the current document/,
  )
})

test('enforces compact output limits', () => {
  const extraction = comparativeExtraction()
  extraction.keyPositives = Array.from({ length: 4 }, () => extraction.keyPositives[0]!)

  assert.equal(qualitativeExtractionSchema.safeParse(extraction).success, false)
})

test('produces the same fingerprint regardless of document input order', () => {
  const left = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00.000Z',
    [currentDocument, previousDocument],
  )
  const right = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00.000Z',
    [previousDocument, currentDocument],
  )

  assert.equal(left.inputSha256, right.inputSha256)
  assert.deepEqual(left.manifest, right.manifest)
})

test('normalizes equivalent timestamps before fingerprinting', () => {
  const left = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00Z',
    [currentDocument],
  )
  const right = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00.000Z',
    [{ ...currentDocument, publishedAt: '2026-10-20T20:00:00Z' }],
  )

  assert.equal(left.inputSha256, right.inputSha256)
})

test('changes the fingerprint when a source fingerprint changes', () => {
  const left = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00.000Z',
    [currentDocument],
  )
  const right = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00.000Z',
    [sourceDocument(
      currentDocumentId,
      'current',
      currentDocument.publishedAt,
      `${currentDocument.text} Additional disclosure.`,
    )],
  )

  assert.notEqual(left.inputSha256, right.inputSha256)
})

test('rejects readable text that does not match its recorded fingerprint', () => {
  assert.throws(
    () => prepareQualitativeExtractionInput(
      'event-1',
      '2026-10-21T00:00:00.000Z',
      [{ ...currentDocument, text: `${currentDocument.text} Changed.` }],
    ),
    /text does not match its fingerprint/,
  )
})

test('rejects a source published after the analysis cutoff', () => {
  assert.throws(
    () => prepareQualitativeExtractionInput(
      'event-1',
      '2026-10-20T19:59:59.000Z',
      [currentDocument],
    ),
    /published after the analysis cutoff/,
  )
})

test('rejects a source first seen after the analysis cutoff', () => {
  assert.throws(
    () => prepareQualitativeExtractionInput(
      'event-1',
      '2026-10-20T21:00:00.000Z',
      [{ ...currentDocument, firstSeenAt: '2026-10-20T21:00:01.000Z' }],
    ),
    /first seen after the analysis cutoff/,
  )
})

test('requires exactly one current document', () => {
  assert.throws(
    () => prepareQualitativeExtractionInput(
      'event-1',
      '2026-10-21T00:00:00.000Z',
      [previousDocument],
    ),
    /exactly one current source document/,
  )
})

test('rejects duplicated source documents', () => {
  assert.throws(
    () => prepareQualitativeExtractionInput(
      'event-1',
      '2026-10-21T00:00:00.000Z',
      [currentDocument, currentDocument],
    ),
    /is duplicated/,
  )
})
