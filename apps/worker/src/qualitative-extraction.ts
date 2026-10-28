import {
  qualitativeExtractionSchema,
  qualitativeExtractionSchemaVersion,
  type QualitativeEvidence,
  type QualitativeExtraction,
} from '@chiron/shared'
import { canonicalJson } from './canonical-json.js'
import { calculateContentSha256 } from './content-hash.js'
import {
  QualitativeRiskAbsenceMeaning,
  QualitativeSourceScope,
  RuleVersion,
  type QualitativeRiskAbsenceMeaningValue,
  type QualitativeSourceScopeValue,
} from './constants.js'
import {
  createQualitativeEvidencePassages,
  qualitativeEvidencePassageVersion,
  type QualitativeEvidencePassage,
} from './qualitative-evidence-passages.js'

export type QualitativeDocumentRole = 'current' | 'previous'

export interface QualitativeSourceDocument {
  documentId: string
  role: QualitativeDocumentRole
  documentType: string
  publishedAt: string
  firstSeenAt: string
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
  firstSeenAt: string
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
  evidencePassageVersion: string
  sourceCoverage: {
    version: string
    includedScopes: QualitativeSourceScopeValue[]
    excludedScopes: QualitativeSourceScopeValue[]
    riskAbsenceMeaning: QualitativeRiskAbsenceMeaningValue
  }
  documents: QualitativeInputDocumentManifest[]
}

export interface PreparedQualitativeExtractionInput {
  manifest: QualitativeExtractionInputManifest
  inputSha256: string
  documents: QualitativeSourceDocument[]
  passages: QualitativeEvidencePassage[]
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
  sourceDocumentId: string
  quote: string
  match: EvidenceTextMatch
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
    firstSeenAt: document.firstSeenAt,
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
    const documentFirstSeenTimestamp = validTimestamp(
      document.firstSeenAt,
      `Document ${document.documentId} first-seen time`,
    )
    if (documentPublishedTimestamp > cutoffTimestamp) {
      throw new Error(`Document ${document.documentId} was published after the analysis cutoff`)
    }
    if (documentFirstSeenTimestamp > cutoffTimestamp) {
      throw new Error(`Document ${document.documentId} was first seen after the analysis cutoff`)
    }
    if (documentFirstSeenTimestamp < documentPublishedTimestamp) {
      throw new Error(`Document ${document.documentId} was first seen before it was published`)
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
    firstSeenAt: new Date(document.firstSeenAt).toISOString(),
  })).sort((left, right) => {
    const roleDifference = documentRoleOrder(left.role) - documentRoleOrder(right.role)
    return roleDifference || left.documentId.localeCompare(right.documentId)
  })
  const manifest: QualitativeExtractionInputManifest = {
    earningsEventId,
    cutoffAt: new Date(cutoffTimestamp).toISOString(),
    schemaVersion: qualitativeExtractionSchemaVersion,
    inputSelectionVersion: RuleVersion.qualitativeInputSelection,
    evidencePassageVersion: qualitativeEvidencePassageVersion,
    sourceCoverage: {
      version: RuleVersion.qualitativeSourceCoverage,
      includedScopes: [
        QualitativeSourceScope.currentEarningsRelease,
        ...(previousDocumentCount === 1
          ? [QualitativeSourceScope.previousEarningsRelease]
          : []),
      ],
      excludedScopes: [
        ...(previousDocumentCount === 0
          ? [QualitativeSourceScope.previousEarningsRelease]
          : []),
        QualitativeSourceScope.secLegalAndRiskSections,
        QualitativeSourceScope.officialRegulatorySources,
        QualitativeSourceScope.externalNews,
      ],
      riskAbsenceMeaning: QualitativeRiskAbsenceMeaning.unknownNotPositive,
    },
    documents: documents.map(inputDocumentManifest),
  }
  const { sourceCoverage: _sourceCoverage, ...fingerprintedInput } = manifest
  const inputSha256 = calculateContentSha256(
    new TextEncoder().encode(canonicalJson(fingerprintedInput)),
  )

  const passages = createQualitativeEvidencePassages(documents)

  return { manifest, inputSha256, documents, passages }
}

function evidenceReferences(extraction: QualitativeExtraction): EvidenceReference[] {
  return [
    ...extraction.guidance.evidence.map((evidence, index) => ({
      fieldPath: `guidance.evidence[${index}]`,
      evidence,
    })),
    ...extraction.guidance.items.flatMap((item, itemIndex) => (
      item.evidence.map((evidence, evidenceIndex) => ({
        fieldPath: `guidance.items[${itemIndex}].evidence[${evidenceIndex}]`,
        evidence,
      }))
    )),
    ...extraction.marginDirection.evidence.map((evidence, index) => ({
      fieldPath: `marginDirection.evidence[${index}]`,
      evidence,
    })),
    ...extraction.managementTone.currentEvidence.map((evidence, index) => ({
      fieldPath: `managementTone.currentEvidence[${index}]`,
      evidence,
    })),
    ...extraction.managementTone.previousEvidence.map((evidence, index) => ({
      fieldPath: `managementTone.previousEvidence[${index}]`,
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
  passagesById: Map<string, QualitativeEvidencePassage>,
): void {
  if (!evidence.some((item) => passagesById.get(item.passageId)?.sourceDocumentId === documentId)) {
    const requiredDocumentRole = [...passagesById.values()].find(
      (passage) => passage.sourceDocumentId === documentId,
    )?.documentRole ?? 'required'
    throw new Error(`${fieldName} requires evidence from the ${requiredDocumentRole} document`)
  }
}

function validateSemanticEvidenceRules(
  extraction: QualitativeExtraction,
  documents: QualitativeSourceDocument[],
  passagesById: Map<string, QualitativeEvidencePassage>,
): void {
  const currentDocument = documents.find((document) => document.role === 'current')
  if (!currentDocument) {
    throw new Error('Qualitative evidence validation requires a current document')
  }

  if (extraction.guidance.status === 'provided' && extraction.guidance.items.length === 0) {
    throw new Error('Provided guidance requires at least one guidance item')
  }
  if (
    extraction.guidance.status !== 'provided'
    && extraction.guidance.items.length > 0
  ) {
    throw new Error('Only provided guidance may contain classified guidance items')
  }
  const unclearGuidance = extraction.guidance.status === 'unclear'
  requireEvidence(unclearGuidance, extraction.guidance.evidence, 'Unclear guidance')
  const guidanceAssessmentHasEvidence = extraction.guidance.evidence.length > 0
  requireSummary(
    unclearGuidance || guidanceAssessmentHasEvidence,
    extraction.guidance.summary,
    'Guidance assessment with evidence',
  )
  if (guidanceAssessmentHasEvidence) {
    requireEvidenceFromDocument(
      extraction.guidance.evidence,
      currentDocument.documentId,
      'Guidance assessment',
      passagesById,
    )
  }
  extraction.guidance.items.forEach((item, index) => {
    requireEvidenceFromDocument(
      item.evidence,
      currentDocument.documentId,
      `guidance.items[${index}]`,
      passagesById,
    )
  })

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
      passagesById,
    )
  }

  const concreteCurrentTone = extraction.managementTone.currentTone !== 'unclear'
  requireEvidence(
    concreteCurrentTone,
    extraction.managementTone.currentEvidence,
    'A concrete management tone',
  )
  requireSummary(
    concreteCurrentTone,
    extraction.managementTone.summary,
    'A concrete management tone',
  )
  if (concreteCurrentTone) {
    requireEvidenceFromDocument(
      extraction.managementTone.currentEvidence,
      currentDocument.documentId,
      'A concrete management tone',
      passagesById,
    )
  }

  extraction.keyPositives.forEach((claim, index) => {
    requireEvidenceFromDocument(
      claim.evidence,
      currentDocument.documentId,
      `keyPositives[${index}]`,
      passagesById,
    )
  })
  extraction.keyRisks.forEach((claim, index) => {
    requireEvidenceFromDocument(
      claim.evidence,
      currentDocument.documentId,
      `keyRisks[${index}]`,
      passagesById,
    )
  })

  const previousDocument = documents.find((document) => document.role === 'previous')
  const concreteToneComparison = ['more_positive', 'similar', 'more_negative']
    .includes(extraction.managementTone.changeFromPrevious)
  if (!previousDocument && extraction.managementTone.changeFromPrevious !== 'unavailable') {
    throw new Error('Tone change must be unavailable when no previous document is supplied')
  }
  if (
    extraction.managementTone.changeFromPrevious === 'unavailable'
    && extraction.managementTone.previousEvidence.length > 0
  ) {
    throw new Error('Unavailable tone change cannot contain previous-document evidence')
  }
  if (!concreteToneComparison) return
  requireSummary(
    true,
    extraction.managementTone.summary,
    'A concrete tone comparison',
  )

  requireEvidence(
    true,
    extraction.managementTone.currentEvidence,
    'A concrete tone comparison current period',
  )
  requireEvidence(
    true,
    extraction.managementTone.previousEvidence,
    'A concrete tone comparison previous period',
  )
  requireEvidenceFromDocument(
    extraction.managementTone.currentEvidence,
    currentDocument.documentId,
    'A concrete tone comparison current period',
    passagesById,
  )
  if (!previousDocument) {
    throw new Error('A concrete tone comparison requires a previous document')
  }
  requireEvidenceFromDocument(
    extraction.managementTone.previousEvidence,
    previousDocument.documentId,
    'A concrete tone comparison previous period',
    passagesById,
  )
}

export function validateAndLocateQualitativeEvidence(
  untrustedExtraction: unknown,
  documents: QualitativeSourceDocument[],
): { extraction: QualitativeExtraction; locatedEvidence: LocatedQualitativeEvidence[] } {
  const extraction = qualitativeExtractionSchema.parse(untrustedExtraction)
  const passages = createQualitativeEvidencePassages(documents)
  const passagesById = new Map(passages.map((passage) => [passage.passageId, passage]))
  const locatedEvidence = evidenceReferences(extraction).map((reference) => {
    const passage = passagesById.get(reference.evidence.passageId)
    if (!passage) {
      throw new Error(`${reference.fieldPath} references unknown passage ${reference.evidence.passageId}`)
    }
    return {
      ...reference,
      sourceDocumentId: passage.sourceDocumentId,
      quote: passage.text,
      match: {
        startCharacter: passage.startCharacter,
        endCharacter: passage.endCharacter,
      },
    }
  })
  validateSemanticEvidenceRules(extraction, documents, passagesById)

  return { extraction, locatedEvidence }
}
