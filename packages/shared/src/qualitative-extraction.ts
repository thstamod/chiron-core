import { z } from 'zod'

export const guidanceChangeValues = [
  'raised',
  'maintained',
  'lowered',
  'introduced',
  'withdrawn',
  'not_provided',
  'unclear',
] as const

export const guidanceStatusValues = [
  'provided',
  'not_provided',
  'unclear',
] as const

export const guidanceMetricValues = [
  'revenue',
  'earnings_per_share',
  'operating_income',
  'operating_margin',
  'expenses',
  'capital_expenditures',
  'free_cash_flow',
  'other',
] as const

export const guidanceDirectionValues = [
  'raised',
  'maintained',
  'lowered',
  'introduced',
  'withdrawn',
] as const

export const marginDirectionValues = [
  'improving',
  'stable',
  'declining',
  'mixed',
  'not_disclosed',
  'unclear',
] as const

export const managementToneValues = [
  'positive',
  'neutral',
  'cautious',
  'negative',
  'mixed',
  'unclear',
] as const

export const managementToneChangeValues = [
  'more_positive',
  'similar',
  'more_negative',
  'unavailable',
  'unclear',
] as const

export const qualitativeExtractionSchemaVersion = 'qualitative-earnings-v2'

export const qualitativeEvidenceSchema = z.object({
  sourceDocumentId: z.uuid(),
  quote: z.string().min(1).max(1_000),
}).strict()

export type QualitativeEvidence = z.infer<typeof qualitativeEvidenceSchema>

function createQualitativeExtractionSchema(
  evidenceSchema: z.ZodType<QualitativeEvidence>,
) {
  const qualitativeClaimSchema = z.object({
    statement: z.string().min(1).max(500),
    evidence: z.array(evidenceSchema).min(1).max(2),
  }).strict()

  const guidanceItemSchema = z.object({
    metric: z.enum(guidanceMetricValues),
    direction: z.enum(guidanceDirectionValues),
    period: z.string().min(1).max(100).nullable(),
    summary: z.string().min(1).max(500),
    evidence: z.array(evidenceSchema).min(1).max(2),
  }).strict()

  const guidanceAssessmentSchema = z.object({
    status: z.enum(guidanceStatusValues),
    items: z.array(guidanceItemSchema).max(5),
    summary: z.string().min(1).max(500).nullable(),
    evidence: z.array(evidenceSchema).max(2),
  }).strict()

  const marginAssessmentSchema = z.object({
    direction: z.enum(marginDirectionValues),
    summary: z.string().min(1).max(500).nullable(),
    evidence: z.array(evidenceSchema).max(2),
  }).strict()

  const managementToneAssessmentSchema = z.object({
    currentTone: z.enum(managementToneValues),
    changeFromPrevious: z.enum(managementToneChangeValues),
    summary: z.string().min(1).max(500).nullable(),
    evidence: z.array(evidenceSchema).max(2),
  }).strict()

  return z.object({
    guidance: guidanceAssessmentSchema,
    marginDirection: marginAssessmentSchema,
    managementTone: managementToneAssessmentSchema,
    keyPositives: z.array(qualitativeClaimSchema).max(3),
    keyRisks: z.array(qualitativeClaimSchema).max(3),
    summary: z.string().min(1).max(1_200),
    sourceLimitations: z.array(z.string().min(1).max(300)).max(3),
  }).strict()
}

export const qualitativeExtractionSchema = createQualitativeExtractionSchema(
  qualitativeEvidenceSchema,
)

export function qualitativeExtractionSchemaForDocuments(
  documentIds: string[],
): typeof qualitativeExtractionSchema {
  const uniqueDocumentIds = [...new Set(documentIds)]
  if (uniqueDocumentIds.length === 0) {
    throw new Error('Qualitative extraction schema requires at least one document ID')
  }
  uniqueDocumentIds.forEach((documentId) => z.uuid().parse(documentId))
  const allowedDocumentIds = uniqueDocumentIds as [string, ...string[]]
  const constrainedEvidenceSchema = z.object({
    sourceDocumentId: z.enum(allowedDocumentIds),
    quote: z.string().min(1).max(1_000),
  }).strict()

  return createQualitativeExtractionSchema(constrainedEvidenceSchema)
}

export type QualitativeExtraction = z.infer<typeof qualitativeExtractionSchema>
export type GuidanceChange = typeof guidanceChangeValues[number]
export type GuidanceStatus = QualitativeExtraction['guidance']['status']
export type GuidanceMetric = QualitativeExtraction['guidance']['items'][number]['metric']
export type GuidanceDirection = QualitativeExtraction['guidance']['items'][number]['direction']
export type MarginDirection = QualitativeExtraction['marginDirection']['direction']
export type ManagementTone = QualitativeExtraction['managementTone']['currentTone']
export type ManagementToneChange = QualitativeExtraction['managementTone']['changeFromPrevious']
