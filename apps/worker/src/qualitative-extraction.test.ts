import assert from 'node:assert/strict'
import test from 'node:test'
import { qualitativeExtractionSchema, type QualitativeExtraction } from '@chiron/shared'
import { canonicalJson } from './canonical-json.js'
import {
  prepareQualitativeExtractionInput,
  validateAndLocateQualitativeEvidence,
  type QualitativeSourceDocument,
} from './qualitative-extraction.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  QualitativeRiskAbsenceMeaning,
  QualitativeSourceScope,
  RuleVersion,
} from './constants.js'

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
      status: 'provided',
      items: [{
        metric: 'revenue',
        direction: 'maintained',
        period: 'full-year 2026',
        summary: 'Management maintained its demand outlook.',
        evidence: [{ passageId: 'current-p0001' }],
      }],
      summary: 'Management maintained its demand outlook.',
      evidence: [],
    },
    marginDirection: {
      direction: 'improving',
      summary: 'Revenue growth supports an improving direction.',
      evidence: [{ passageId: 'current-p0001' }],
    },
    managementTone: {
      currentTone: 'positive',
      changeFromPrevious: 'more_positive',
      summary: 'Management used stronger demand language than in the previous release.',
      currentEvidence: [{ passageId: 'current-p0001' }],
      previousEvidence: [{ passageId: 'previous-p0001' }],
    },
    keyPositives: [{
      statement: 'Revenue growth accelerated.',
      evidence: [{ passageId: 'current-p0001' }],
    }],
    keyRisks: [{
      statement: 'Supply remains constrained.',
      evidence: [{ passageId: 'current-p0001' }],
    }],
    summary: 'Revenue growth accelerated while management remained positive about demand.',
    sourceLimitations: [],
  }
}

function currentOnlyExtraction(): QualitativeExtraction {
  const extraction = comparativeExtraction()
  extraction.guidance = {
    status: 'not_provided',
    items: [],
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
    currentEvidence: [{ passageId: 'current-p0001' }],
    previousEvidence: [],
  }
  return extraction
}

test('accepts a valid structured extraction and derives exact passage evidence', () => {
  const result = validateAndLocateQualitativeEvidence(
    comparativeExtraction(),
    [currentDocument, previousDocument],
  )

  assert.equal(result.locatedEvidence.length, 6)
  assert.equal(result.locatedEvidence[0]?.sourceDocumentId, currentDocumentId)
  assert.equal(result.locatedEvidence[0]?.quote, currentDocument.text)
  assert.deepEqual(result.locatedEvidence[0]?.match, {
    startCharacter: 0,
    endCharacter: currentDocument.text.length,
  })
})

test('rejects evidence that references an unknown passage', () => {
  const extraction = comparativeExtraction()
  extraction.keyRisks[0]!.evidence[0]!.passageId = 'current-p9999'

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /references unknown passage/,
  )
})

test('requires both source periods for a concrete tone comparison', () => {
  const extraction = comparativeExtraction()
  extraction.managementTone.previousEvidence = []

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /previous period requires supporting evidence/,
  )
})

test('keeps current and previous tone evidence in their matching source roles', () => {
  const currentRoleMismatch = comparativeExtraction()
  currentRoleMismatch.managementTone.currentEvidence = [{ passageId: 'previous-p0001' }]
  assert.equal(qualitativeExtractionSchema.safeParse(currentRoleMismatch).success, false)

  const previousRoleMismatch = comparativeExtraction()
  previousRoleMismatch.managementTone.previousEvidence = [{ passageId: 'current-p0001' }]
  assert.equal(qualitativeExtractionSchema.safeParse(previousRoleMismatch).success, false)
})

test('rejects previous evidence when tone comparison is unavailable', () => {
  const extraction = currentOnlyExtraction()
  extraction.managementTone.previousEvidence = [{ passageId: 'previous-p0001' }]

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /Unavailable tone change cannot contain previous-document evidence/,
  )
})

test('requires unavailable tone change when no previous document is supplied', () => {
  const extraction = comparativeExtraction()
  extraction.managementTone.previousEvidence = []

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

test('requires evidence and a summary for each provided guidance item', () => {
  const withoutEvidence = comparativeExtraction()
  withoutEvidence.guidance.items[0]!.evidence = []
  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      withoutEvidence,
      [currentDocument, previousDocument],
    ),
  )

  const withoutSummary = comparativeExtraction()
  withoutSummary.guidance.items[0]!.summary = ''
  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      withoutSummary,
      [currentDocument, previousDocument],
    ),
  )
})

test('requires provided guidance to contain at least one classified item', () => {
  const extraction = comparativeExtraction()
  extraction.guidance.items = []

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /requires at least one guidance item/,
  )
})

test('rejects classified items when guidance is marked not provided', () => {
  const extraction = comparativeExtraction()
  extraction.guidance.status = 'not_provided'

  assert.throws(
    () => validateAndLocateQualitativeEvidence(
      extraction,
      [currentDocument, previousDocument],
    ),
    /Only provided guidance may contain classified guidance items/,
  )
})

test('requires current-document evidence for current guidance', () => {
  const extraction = comparativeExtraction()
  extraction.guidance.items[0]!.evidence = [{ passageId: 'previous-p0001' }]

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
  extraction.keyRisks[0]!.evidence = [{ passageId: 'previous-p0001' }]

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

test('records included and excluded source coverage in the immutable manifest', () => {
  const withPrevious = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00.000Z',
    [currentDocument, previousDocument],
  )
  const currentOnly = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00.000Z',
    [currentDocument],
  )

  assert.deepEqual(withPrevious.manifest.sourceCoverage, {
    version: RuleVersion.qualitativeSourceCoverage,
    includedScopes: [
      QualitativeSourceScope.currentEarningsRelease,
      QualitativeSourceScope.previousEarningsRelease,
    ],
    excludedScopes: [
      QualitativeSourceScope.secLegalAndRiskSections,
      QualitativeSourceScope.officialRegulatorySources,
      QualitativeSourceScope.externalNews,
    ],
    riskAbsenceMeaning: QualitativeRiskAbsenceMeaning.unknownNotPositive,
  })
  assert.ok(
    currentOnly.manifest.sourceCoverage.excludedScopes.includes(
      QualitativeSourceScope.previousEarningsRelease,
    ),
  )
  assert.notEqual(withPrevious.inputSha256, currentOnly.inputSha256)
})

test('keeps the existing document fingerprint compatible after adding coverage metadata', () => {
  const preparedInput = prepareQualitativeExtractionInput(
    'event-1',
    '2026-10-21T00:00:00.000Z',
    [currentDocument, previousDocument],
  )
  const { sourceCoverage, ...fingerprintedInput } = preparedInput.manifest
  const compatibleFingerprint = calculateContentSha256(
    new TextEncoder().encode(canonicalJson(fingerprintedInput)),
  )

  assert.equal(sourceCoverage.version, RuleVersion.qualitativeSourceCoverage)
  assert.equal(preparedInput.inputSha256, compatibleFingerprint)
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
