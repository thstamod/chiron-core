import { z } from 'zod'
import {
  guidanceChangeValues,
  guidanceDirectionValues,
  guidanceMetricValues,
  guidanceStatusValues,
  managementToneChangeValues,
  managementToneValues,
  marginDirectionValues,
  qualitativeExtractionSchema,
  qualitativeExtractionSchemaVersion,
} from './qualitative-extraction.js'

export const qualitativeExtractionSchemaVersions = {
  version1: 'qualitative-earnings-v1',
  version2: 'qualitative-earnings-v2',
  version3: 'qualitative-earnings-v3',
  version4: 'qualitative-earnings-v4',
} as const

export interface ComparableQualitativeExtraction {
  guidance: unknown
  marginDirection: unknown
  managementTone: unknown
  keyPositives: unknown
  keyRisks: unknown
  summary: string
  sourceLimitations: string[]
}

const documentEvidenceSchema = z.object({
  sourceDocumentId: z.uuid(),
  quote: z.string().min(1).max(1_000),
}).strict()

const passageEvidenceSchema = z.object({
  passageId: z.string().regex(/^(current|previous)-p\d{4}$/),
}).strict()

function commonClaimSchema(evidenceSchema: z.ZodType) {
  return z.object({
    statement: z.string().min(1).max(500),
    evidence: z.array(evidenceSchema).min(1).max(2),
  }).strict()
}

function commonMarginSchema(evidenceSchema: z.ZodType) {
  return z.object({
    direction: z.enum(marginDirectionValues),
    summary: z.string().min(1).max(500).nullable(),
    evidence: z.array(evidenceSchema).max(2),
  }).strict()
}

function legacyToneSchema(evidenceSchema: z.ZodType) {
  return z.object({
    currentTone: z.enum(managementToneValues),
    changeFromPrevious: z.enum(managementToneChangeValues),
    summary: z.string().min(1).max(500).nullable(),
    evidence: z.array(evidenceSchema).max(2),
  }).strict()
}

function completeLegacySchema(
  guidanceSchema: z.ZodType,
  evidenceSchema: z.ZodType,
) {
  return z.object({
    guidance: guidanceSchema,
    marginDirection: commonMarginSchema(evidenceSchema),
    managementTone: legacyToneSchema(evidenceSchema),
    keyPositives: z.array(commonClaimSchema(evidenceSchema)).max(3),
    keyRisks: z.array(commonClaimSchema(evidenceSchema)).max(3),
    summary: z.string().min(1).max(1_200),
    sourceLimitations: z.array(z.string().min(1).max(300)).max(3),
  }).strict()
}

const version1GuidanceSchema = z.object({
  change: z.enum(guidanceChangeValues),
  summary: z.string().min(1).max(500).nullable(),
  evidence: z.array(documentEvidenceSchema).max(2),
}).strict()

function detailedGuidanceSchema(evidenceSchema: z.ZodType) {
  const guidanceItemSchema = z.object({
    metric: z.enum(guidanceMetricValues),
    direction: z.enum(guidanceDirectionValues),
    period: z.string().min(1).max(100).nullable(),
    summary: z.string().min(1).max(500),
    evidence: z.array(evidenceSchema).min(1).max(2),
  }).strict()

  return z.object({
    status: z.enum(guidanceStatusValues),
    items: z.array(guidanceItemSchema).max(5),
    summary: z.string().min(1).max(500).nullable(),
    evidence: z.array(evidenceSchema).max(2),
  }).strict()
}

const version1Schema = completeLegacySchema(
  version1GuidanceSchema,
  documentEvidenceSchema,
)
const version2Schema = completeLegacySchema(
  detailedGuidanceSchema(documentEvidenceSchema),
  documentEvidenceSchema,
)
const version3Schema = completeLegacySchema(
  detailedGuidanceSchema(passageEvidenceSchema),
  passageEvidenceSchema,
)

function parseVersion4(value: unknown): ComparableQualitativeExtraction {
  if (qualitativeExtractionSchemaVersion !== qualitativeExtractionSchemaVersions.version4) {
    throw new Error(
      'Version 4 must receive a frozen historical parser before the current schema changes',
    )
  }
  return qualitativeExtractionSchema.parse(value) as ComparableQualitativeExtraction
}

export function parseVersionedQualitativeExtraction(
  schemaVersion: string,
  value: unknown,
): ComparableQualitativeExtraction {
  switch (schemaVersion) {
    case qualitativeExtractionSchemaVersions.version1:
      return version1Schema.parse(value) as ComparableQualitativeExtraction
    case qualitativeExtractionSchemaVersions.version2:
      return version2Schema.parse(value) as ComparableQualitativeExtraction
    case qualitativeExtractionSchemaVersions.version3:
      return version3Schema.parse(value) as ComparableQualitativeExtraction
    case qualitativeExtractionSchemaVersions.version4:
      return parseVersion4(value)
    default:
      throw new Error(`Unsupported qualitative extraction schema version: ${schemaVersion}`)
  }
}
