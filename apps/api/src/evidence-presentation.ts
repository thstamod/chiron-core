import {
  qualitativeExtractionSchema,
  qualitativeExtractionSchemaVersion,
  type QualitativeExtraction,
} from '@chiron/shared'
import { TrustedSourceDocumentUrl } from './constants.js'
import type {
  ResearchEvidenceCategory,
  ResearchPredictionEvidence,
} from './types.js'

export interface EvidenceDocumentRow {
  id: string
  document_type: string
  source_url: string
  published_at: string
  first_seen_at: string
  content_sha256: string
}

interface FrozenEvidenceDocument {
  documentId: string
  role: 'current' | 'previous'
  documentType: string
  publishedAt: string
  firstSeenAt: string
  sourceContentSha256: string
}

interface FrozenLocatedEvidence {
  fieldPath: string
  passageId: string
  sourceDocumentId: string
  quote: string
  startCharacter: number
  endCharacter: number
}

export interface FrozenPredictionEvidence {
  schemaVersion: string
  output: QualitativeExtraction
  documents: FrozenEvidenceDocument[]
  locatedEvidence: FrozenLocatedEvidence[]
}

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${description} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, description: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${description} must be an array`)
  return value
}

function requireString(
  record: Record<string, unknown>,
  fieldName: string,
  description: string,
): string {
  const value = record[fieldName]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${description} has an invalid ${fieldName}`)
  }
  return value
}

function requireNonNegativeInteger(
  record: Record<string, unknown>,
  fieldName: string,
  description: string,
): number {
  const value = record[fieldName]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${description} has an invalid ${fieldName}`)
  }
  return value
}

function validTimestamp(value: string, description: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`${description} has an invalid timestamp`)
  return timestamp
}

function frozenDocument(value: unknown, index: number): FrozenEvidenceDocument {
  const description = `Evidence input document ${index}`
  const record = requireRecord(value, description)
  const role = record.role
  if (role !== 'current' && role !== 'previous') {
    throw new Error(`${description} has an invalid role`)
  }
  return {
    documentId: requireString(record, 'documentId', description),
    role,
    documentType: requireString(record, 'documentType', description),
    publishedAt: requireString(record, 'publishedAt', description),
    firstSeenAt: requireString(record, 'firstSeenAt', description),
    sourceContentSha256: requireString(record, 'sourceContentSha256', description),
  }
}

function frozenLocatedEvidence(value: unknown, index: number): FrozenLocatedEvidence {
  const description = `Located evidence ${index}`
  const record = requireRecord(value, description)
  const evidence = requireRecord(record.evidence, `${description} reference`)
  const match = requireRecord(record.match, `${description} match`)
  const quote = requireString(record, 'quote', description)
  const startCharacter = requireNonNegativeInteger(match, 'startCharacter', `${description} match`)
  const endCharacter = requireNonNegativeInteger(match, 'endCharacter', `${description} match`)
  if (endCharacter - startCharacter !== quote.length) {
    throw new Error(`${description} quote length does not match its source range`)
  }
  return {
    fieldPath: requireString(record, 'fieldPath', description),
    passageId: requireString(evidence, 'passageId', `${description} reference`),
    sourceDocumentId: requireString(record, 'sourceDocumentId', description),
    quote,
    startCharacter,
    endCharacter,
  }
}

export function parseFrozenPredictionEvidence(snapshotValue: unknown): FrozenPredictionEvidence {
  const snapshot = requireRecord(snapshotValue, 'Prediction snapshot')
  const qualitative = requireRecord(snapshot.qualitative, 'Prediction qualitative snapshot')
  const run = requireRecord(qualitative.run, 'Prediction qualitative run')
  const inputManifest = requireRecord(run.input_manifest, 'Prediction qualitative input manifest')
  const effectiveExtraction = requireRecord(
    qualitative.effectiveExtraction,
    'Prediction effective extraction',
  )
  const effective = requireRecord(effectiveExtraction.effective, 'Prediction effective output')
  const schemaVersion = requireString(effective, 'schemaVersion', 'Prediction effective output')
  if (schemaVersion !== qualitativeExtractionSchemaVersion) {
    throw new Error(`Unsupported prediction evidence schema version: ${schemaVersion}`)
  }
  const outputResult = qualitativeExtractionSchema.safeParse(effective.output)
  if (!outputResult.success) throw new Error('Prediction evidence output does not match its schema')

  const documents = requireArray(
    inputManifest.documents,
    'Prediction qualitative input documents',
  ).map(frozenDocument)
  const documentIds = new Set(documents.map((document) => document.documentId))
  if (documentIds.size !== documents.length) {
    throw new Error('Prediction evidence contains duplicate input documents')
  }

  const locatedEvidence = requireArray(
    effective.locatedEvidence,
    'Prediction located evidence',
  ).map(frozenLocatedEvidence)
  for (const evidence of locatedEvidence) {
    const document = documents.find((candidate) => candidate.documentId === evidence.sourceDocumentId)
    if (!document) throw new Error(`Evidence ${evidence.fieldPath} references an unknown document`)
    if (!evidence.passageId.startsWith(`${document.role}-p`)) {
      throw new Error(`Evidence ${evidence.fieldPath} has the wrong document role`)
    }
  }

  return { schemaVersion, output: outputResult.data, documents, locatedEvidence }
}

function indexedClaim(
  values: Array<{ statement?: string; summary?: string }>,
  indexText: string,
  property: 'statement' | 'summary',
  fieldPath: string,
): string {
  const index = Number(indexText)
  const value = values[index]?.[property]
  if (!value) throw new Error(`Evidence path ${fieldPath} does not match its extracted claim`)
  return value
}

function claimForFieldPath(
  output: QualitativeExtraction,
  fieldPath: string,
): { category: ResearchEvidenceCategory; claim: string } {
  if (/^guidance\.evidence\[\d+\]$/.test(fieldPath)) {
    if (!output.guidance.summary) throw new Error(`Evidence path ${fieldPath} has no guidance summary`)
    return { category: 'guidance', claim: output.guidance.summary }
  }

  const guidanceItemMatch = /^guidance\.items\[(\d+)\]\.evidence\[\d+\]$/.exec(fieldPath)
  if (guidanceItemMatch?.[1]) {
    return {
      category: 'guidance',
      claim: indexedClaim(output.guidance.items, guidanceItemMatch[1], 'summary', fieldPath),
    }
  }
  if (/^marginDirection\.evidence\[\d+\]$/.test(fieldPath)) {
    if (!output.marginDirection.summary) throw new Error(`Evidence path ${fieldPath} has no margin summary`)
    return { category: 'margin_direction', claim: output.marginDirection.summary }
  }
  if (/^managementTone\.(currentEvidence|previousEvidence)\[\d+\]$/.test(fieldPath)) {
    if (!output.managementTone.summary) throw new Error(`Evidence path ${fieldPath} has no tone summary`)
    return { category: 'management_tone', claim: output.managementTone.summary }
  }

  const positiveMatch = /^keyPositives\[(\d+)\]\.evidence\[\d+\]$/.exec(fieldPath)
  if (positiveMatch?.[1]) {
    return {
      category: 'key_positive',
      claim: indexedClaim(output.keyPositives, positiveMatch[1], 'statement', fieldPath),
    }
  }
  const riskMatch = /^keyRisks\[(\d+)\]\.evidence\[\d+\]$/.exec(fieldPath)
  if (riskMatch?.[1]) {
    return {
      category: 'key_risk',
      claim: indexedClaim(output.keyRisks, riskMatch[1], 'statement', fieldPath),
    }
  }
  throw new Error(`Unsupported qualitative evidence path: ${fieldPath}`)
}

function trustedSecSourceUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Evidence source document has an invalid URL')
  }
  if (
    url.protocol !== TrustedSourceDocumentUrl.protocol
    || url.hostname !== TrustedSourceDocumentUrl.hostname
    || !url.pathname.startsWith(TrustedSourceDocumentUrl.archivePathPrefix)
  ) {
    throw new Error('Evidence source document is not an approved SEC archive URL')
  }
  return url.toString()
}

function sameTimestamp(left: string, right: string): boolean {
  return validTimestamp(left, 'Frozen document') === validTimestamp(right, 'Database document')
}

export function presentPredictionEvidence(
  predictionId: string,
  frozen: FrozenPredictionEvidence,
  databaseDocuments: EvidenceDocumentRow[],
): ResearchPredictionEvidence {
  const documentsById = new Map(databaseDocuments.map((document) => [document.id, document]))
  const frozenDocumentsById = new Map(frozen.documents.map((document) => [document.documentId, document]))

  for (const document of frozen.documents) {
    const databaseDocument = documentsById.get(document.documentId)
    if (!databaseDocument) throw new Error(`Evidence document ${document.documentId} is unavailable`)
    if (
      databaseDocument.document_type !== document.documentType
      || databaseDocument.content_sha256 !== document.sourceContentSha256
      || !sameTimestamp(databaseDocument.published_at, document.publishedAt)
      || !sameTimestamp(databaseDocument.first_seen_at, document.firstSeenAt)
    ) {
      throw new Error(`Evidence document ${document.documentId} does not match the frozen snapshot`)
    }
  }

  return {
    predictionId,
    extractionSchemaVersion: frozen.schemaVersion,
    evidence: frozen.locatedEvidence.map((evidence) => {
      const frozenDocument = frozenDocumentsById.get(evidence.sourceDocumentId)
      const databaseDocument = documentsById.get(evidence.sourceDocumentId)
      if (!frozenDocument || !databaseDocument) {
        throw new Error(`Evidence ${evidence.fieldPath} has no verified source document`)
      }
      return {
        fieldPath: evidence.fieldPath,
        ...claimForFieldPath(frozen.output, evidence.fieldPath),
        passageId: evidence.passageId,
        quote: evidence.quote,
        startCharacter: evidence.startCharacter,
        endCharacter: evidence.endCharacter,
        source: {
          documentId: frozenDocument.documentId,
          role: frozenDocument.role,
          documentType: frozenDocument.documentType,
          publishedAt: frozenDocument.publishedAt,
          sourceUrl: trustedSecSourceUrl(databaseDocument.source_url),
        },
      }
    }),
  }
}
