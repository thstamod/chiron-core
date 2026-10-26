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

export const qualitativeExtractionSchemaVersion = 'qualitative-earnings-v1'

export const qualitativeEvidenceSchema = z.object({
  sourceDocumentId: z.uuid(),
  quote: z.string().min(1).max(1_000),
}).strict()

const qualitativeClaimSchema = z.object({
  statement: z.string().min(1).max(500),
  evidence: z.array(qualitativeEvidenceSchema).min(1).max(2),
}).strict()

const guidanceAssessmentSchema = z.object({
  change: z.enum(guidanceChangeValues),
  summary: z.string().min(1).max(500).nullable(),
  evidence: z.array(qualitativeEvidenceSchema).max(2),
}).strict()

const marginAssessmentSchema = z.object({
  direction: z.enum(marginDirectionValues),
  summary: z.string().min(1).max(500).nullable(),
  evidence: z.array(qualitativeEvidenceSchema).max(2),
}).strict()

const managementToneAssessmentSchema = z.object({
  currentTone: z.enum(managementToneValues),
  changeFromPrevious: z.enum(managementToneChangeValues),
  summary: z.string().min(1).max(500).nullable(),
  evidence: z.array(qualitativeEvidenceSchema).max(2),
}).strict()

export const qualitativeExtractionSchema = z.object({
  guidance: guidanceAssessmentSchema,
  marginDirection: marginAssessmentSchema,
  managementTone: managementToneAssessmentSchema,
  keyPositives: z.array(qualitativeClaimSchema).max(3),
  keyRisks: z.array(qualitativeClaimSchema).max(3),
  summary: z.string().min(1).max(1_200),
  sourceLimitations: z.array(z.string().min(1).max(300)).max(3),
}).strict()

export type GuidanceChange = z.infer<typeof guidanceAssessmentSchema>['change']
export type MarginDirection = z.infer<typeof marginAssessmentSchema>['direction']
export type ManagementTone = z.infer<typeof managementToneAssessmentSchema>['currentTone']
export type ManagementToneChange =
  z.infer<typeof managementToneAssessmentSchema>['changeFromPrevious']
export type QualitativeEvidence = z.infer<typeof qualitativeEvidenceSchema>
export type QualitativeExtraction = z.infer<typeof qualitativeExtractionSchema>
