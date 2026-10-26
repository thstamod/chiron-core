import {
  qualitativeExtractionSchema,
  qualitativeExtractionSchemaVersion,
  type QualitativeEvidence,
  type QualitativeExtraction,
} from '@chiron/shared'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import { RuleVersion } from './constants.js'

export type QualitativeDocumentRole = 'current' | 'previous'

export interface QualitativeSourceDocument {
  documentId: string
  role: QualitativeDocumentRole
  documentType: string
  publishedAt: string
  sourceContentSha256: string
  textExtractionVersion: string
  textContentSha256: string
  text: string
}

interface QualitativeInputDocumentManifest {
  documentId: string
  role: QualitativeDocumentRole
  documentType: string
  publishedAt: string
  sourceContentSha256: string
  textExtractionVersion: string
  textContentSha256: string
  characterCount: number
}

export interface QualitativeExtractionInputManifest {
  earningsEventId: string
  cutoffAt: string
  schemaVersion: string
  inputSelectionVersion: string
  documents: QualitativeInputDocumentManifest[]
}

export interface PreparedQualitativeExtractionInput {
  manifest: QualitativeExtractionInputManifest
  inputSha256: string
  documents: QualitativeSourceDocument[]
}

interface EvidenceReference {
  fieldPath: string
  evidence: QualitativeEvidence
}

export interface EvidenceTextMatch {
  startCharacter: number
  endCharacter: number
}

export interface LocatedQualitativeEvidence extends EvidenceReference {
  matches: EvidenceTextMatch[]
}

function documentRoleOrder(role: QualitativeDocumentRole): number {
  return role === 'current' ? 0 : 1
}

function inputDocumentManifest(
  document: QualitativeSourceDocument,
): QualitativeInputDocumentManifest {
  return {
    documentId: document.documentId,
    role: document.role,
    documentType: document.documentType,
    publishedAt: document.publishedAt,
    sourceContentSha256: document.sourceContentSha256,
    textExtractionVersion: document.textExtractionVersion,
    textContentSha256: document.textContentSha256,
    characterCount: document.text.length,
  }
}

function validTimestamp(value: string, fieldName: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`${fieldName} must be a valid timestamp`)
  return timestamp
}

export function prepareQualitativeExtractionInput(
  earningsEventId: string,
  cutoffAt: string,
  sourceDocuments: QualitativeSourceDocument[],
): PreparedQualitativeExtractionInput {
  if (!earningsEventId.trim()) throw new Error('Qualitative extraction requires an event ID')
  if (sourceDocuments.length === 0) {
    throw new Error('Qualitative extraction requires a current source document')
  }

  const cutoffTimestamp = validTimestamp(cutoffAt, 'Qualitative extraction cutoff')
  const documentIds = new Set<string>()
  let currentDocumentCount = 0
  let previousDocumentCount = 0
  for (const document of sourceDocuments) {
    if (documentIds.has(document.documentId)) {
      throw new Error(`Qualitative source document ${document.documentId} is duplicated`)
    }
    documentIds.add(document.documentId)

    if (!document.text.trim()) {
      throw new Error(`Qualitative source document ${document.documentId} has no readable text`)
    }
    const textContentSha256 = calculateContentSha256(new TextEncoder().encode(document.text))
    if (textContentSha256 !== document.textContentSha256) {
      throw new Error(
        `Qualitative source document ${document.documentId} text does not match its fingerprint`,
      )
    }

    if (document.role === 'current') currentDocumentCount += 1
    if (document.role === 'previous') previousDocumentCount += 1
    const documentPublishedTimestamp = validTimestamp(
      document.publishedAt,
      `Document ${document.documentId} publication time`,
    )
    if (documentPublishedTimestamp > cutoffTimestamp) {
      throw new Error(`Document ${document.documentId} was published after the analysis cutoff`)
    }
  }

  if (currentDocumentCount !== 1) {
    throw new Error('Qualitative extraction requires exactly one current source document')
  }
  if (previousDocumentCount > 1) {
    throw new Error('Qualitative extraction accepts at most one previous source document')
  }

  const documents = sourceDocuments.map((document) => ({
    ...document,
    publishedAt: new Date(document.publishedAt).toISOString(),
  })).sort((left, right) => {
    const roleDifference = documentRoleOrder(left.role) - documentRoleOrder(right.role)
    return roleDifference || left.documentId.localeCompare(right.documentId)
  })
  const manifest: QualitativeExtractionInputManifest = {
    earningsEventId,
    cutoffAt: new Date(cutoffTimestamp).toISOString(),
    schemaVersion: qualitativeExtractionSchemaVersion,
    inputSelectionVersion: RuleVersion.qualitativeInputSelection,
    documents: documents.map(inputDocumentManifest),
  }
  const inputSha256 = calculateContentSha256(
    new TextEncoder().encode(canonicalJson(manifest)),
  )

  return { manifest, inputSha256, documents }
}

function evidenceReferences(extraction: QualitativeExtraction): EvidenceReference[] {
  return [
    ...extraction.guidance.evidence.map((evidence, index) => ({
      fieldPath: `guidance.evidence[${index}]`,
      evidence,
    })),
    ...extraction.marginDirection.evidence.map((evidence, index) => ({
      fieldPath: `marginDirection.evidence[${index}]`,
      evidence,
    })),
    ...extraction.managementTone.evidence.map((evidence, index) => ({
      fieldPath: `managementTone.evidence[${index}]`,
      evidence,
    })),
    ...extraction.keyPositives.flatMap((claim, claimIndex) => (
      claim.evidence.map((evidence, evidenceIndex) => ({
        fieldPath: `keyPositives[${claimIndex}].evidence[${evidenceIndex}]`,
        evidence,
      }))
    )),
    ...extraction.keyRisks.flatMap((claim, claimIndex) => (
      claim.evidence.map((evidence, evidenceIndex) => ({
        fieldPath: `keyRisks[${claimIndex}].evidence[${evidenceIndex}]`,
        evidence,
      }))
    )),
  ]
}

function locateQuote(text: string, quote: string): EvidenceTextMatch[] {
  const matches: EvidenceTextMatch[] = []
  let searchFrom = 0
  while (searchFrom <= text.length - quote.length) {
    const startCharacter = text.indexOf(quote, searchFrom)
    if (startCharacter === -1) break
    matches.push({
      startCharacter,
      endCharacter: startCharacter + quote.length,
    })
    searchFrom = startCharacter + 1
  }
  return matches
}

function requireEvidence(
  condition: boolean,
  evidence: QualitativeEvidence[],
  fieldName: string,
): void {
  if (condition && evidence.length === 0) {
    throw new Error(`${fieldName} requires supporting evidence`)
  }
}

function requireSummary(condition: boolean, summary: string | null, fieldName: string): void {
  if (condition && summary === null) throw new Error(`${fieldName} requires a summary`)
}

function requireEvidenceFromDocument(
  evidence: QualitativeEvidence[],
  documentId: string,
  fieldName: string,
): void {
  if (!evidence.some((item) => item.sourceDocumentId === documentId)) {
    throw new Error(`${fieldName} requires evidence from the current document`)
  }
}

function validateSemanticEvidenceRules(
  extraction: QualitativeExtraction,
  documents: QualitativeSourceDocument[],
): void {
  const currentDocument = documents.find((document) => document.role === 'current')
  if (!currentDocument) {
    throw new Error('Qualitative evidence validation requires a current document')
  }

  const concreteGuidance = !['not_provided', 'unclear'].includes(extraction.guidance.change)
  requireEvidence(
    concreteGuidance,
    extraction.guidance.evidence,
    'A concrete guidance change',
  )
  requireSummary(concreteGuidance, extraction.guidance.summary, 'A concrete guidance change')
  if (concreteGuidance) {
    requireEvidenceFromDocument(
      extraction.guidance.evidence,
      currentDocument.documentId,
      'A concrete guidance change',
    )
  }

  const concreteMargin = !['not_disclosed', 'unclear']
    .includes(extraction.marginDirection.direction)
  requireEvidence(
    concreteMargin,
    extraction.marginDirection.evidence,
    'A concrete margin direction',
  )
  requireSummary(concreteMargin, extraction.marginDirection.summary, 'A concrete margin direction')
  if (concreteMargin) {
    requireEvidenceFromDocument(
      extraction.marginDirection.evidence,
      currentDocument.documentId,
      'A concrete margin direction',
    )
  }

  const concreteCurrentTone = extraction.managementTone.currentTone !== 'unclear'
  requireEvidence(
    concreteCurrentTone,
    extraction.managementTone.evidence,
    'A concrete management tone',
  )
  requireSummary(
    concreteCurrentTone,
    extraction.managementTone.summary,
    'A concrete management tone',
  )
  if (concreteCurrentTone) {
    requireEvidenceFromDocument(
      extraction.managementTone.evidence,
      currentDocument.documentId,
      'A concrete management tone',
    )
  }

  extraction.keyPositives.forEach((claim, index) => {
    requireEvidenceFromDocument(
      claim.evidence,
      currentDocument.documentId,
      `keyPositives[${index}]`,
    )
  })
  extraction.keyRisks.forEach((claim, index) => {
    requireEvidenceFromDocument(
      claim.evidence,
      currentDocument.documentId,
      `keyRisks[${index}]`,
    )
  })

  const previousDocument = documents.find((document) => document.role === 'previous')
  const concreteToneComparison = ['more_positive', 'similar', 'more_negative']
    .includes(extraction.managementTone.changeFromPrevious)
  if (!previousDocument && extraction.managementTone.changeFromPrevious !== 'unavailable') {
    throw new Error('Tone change must be unavailable when no previous document is supplied')
  }
  if (!concreteToneComparison) return
  requireSummary(
    true,
    extraction.managementTone.summary,
    'A concrete tone comparison',
  )

  const evidenceDocumentIds = new Set(
    extraction.managementTone.evidence.map((evidence) => evidence.sourceDocumentId),
  )
  if (
    !previousDocument
    || !evidenceDocumentIds.has(currentDocument.documentId)
    || !evidenceDocumentIds.has(previousDocument.documentId)
  ) {
    throw new Error('A concrete tone comparison requires current and previous document evidence')
  }
}

export function validateAndLocateQualitativeEvidence(
  untrustedExtraction: unknown,
  documents: QualitativeSourceDocument[],
): { extraction: QualitativeExtraction; locatedEvidence: LocatedQualitativeEvidence[] } {
  const extraction = qualitativeExtractionSchema.parse(untrustedExtraction)
  const documentsById = new Map(documents.map((document) => [document.documentId, document]))
  const locatedEvidence = evidenceReferences(extraction).map((reference) => {
    const sourceDocument = documentsById.get(reference.evidence.sourceDocumentId)
    if (!sourceDocument) {
      throw new Error(
        `${reference.fieldPath} references unknown document `
        + reference.evidence.sourceDocumentId,
      )
    }
    const matches = locateQuote(sourceDocument.text, reference.evidence.quote)
    if (matches.length === 0) {
      throw new Error(`${reference.fieldPath} does not exactly match its source document`)
    }
    return { ...reference, matches }
  })
  validateSemanticEvidenceRules(extraction, documents)

  return { extraction, locatedEvidence }
}
