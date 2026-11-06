import type { SupabaseClient } from '@supabase/supabase-js'
import { buildBaselineQualitativeProviderRequest } from './baseline-qualitative-prompt.js'
import { QualitativeExtractionPurpose } from './constants.js'
import { loadPreparedHistoricalReconstructionInput } from './historical-reconstruction-plan.js'
import {
  buildQualitativeExtractionRunRecord,
  saveQualitativeExtractionRun,
} from './qualitative-extraction-run.js'
import {
  buildQualitativeExtractionPreview,
  type QualitativeExtractionPreview,
} from './qualitative-preview.js'
import type { QualitativeExtractionProvider } from './qualitative-provider.js'

export interface HistoricalQualitativeExtractionPreview
  extends QualitativeExtractionPreview {
  historicalReconstructionPlanId: string
  extractionPurpose: string
  experimentVersion: string
}

export interface HistoricalQualitativeExtractionSummary extends Record<string, unknown> {
  extractionRunId: string
  historicalReconstructionPlanId: string
  earningsEventId: string
  extractionPurpose: string
  experimentVersion: string
  inputFingerprint: string
  providerStatus: string
  validationStatus: string | null
  requestedModel: string
  resolvedModel: string | null
  tokenUsage: unknown
}

export async function previewHistoricalQualitativeExtraction(
  client: SupabaseClient,
  historicalReconstructionPlanId: string,
): Promise<HistoricalQualitativeExtractionPreview> {
  const { plan, qualitativeInput } = await loadPreparedHistoricalReconstructionInput(
    client,
    historicalReconstructionPlanId,
  )
  return {
    ...buildQualitativeExtractionPreview(qualitativeInput),
    historicalReconstructionPlanId: plan.id,
    extractionPurpose: QualitativeExtractionPurpose.historicalReconstruction,
    experimentVersion: plan.experiment_version,
  }
}

export async function extractAndStoreHistoricalQualitativeAnalysis(
  client: SupabaseClient,
  provider: QualitativeExtractionProvider,
  historicalReconstructionPlanId: string,
): Promise<HistoricalQualitativeExtractionSummary> {
  const { plan, qualitativeInput } = await loadPreparedHistoricalReconstructionInput(
    client,
    historicalReconstructionPlanId,
  )
  const request = buildBaselineQualitativeProviderRequest(qualitativeInput)
  const providerResult = await provider.extract(request)
  const record = buildQualitativeExtractionRunRecord(
    qualitativeInput,
    request.prompt.version,
    providerResult,
    {
      historicalReconstructionPlanId: plan.id,
      sourceAvailabilityRuleVersion: plan.source_availability_rule_version,
    },
  )
  const extractionRunId = await saveQualitativeExtractionRun(client, record)

  return {
    extractionRunId,
    historicalReconstructionPlanId: plan.id,
    earningsEventId: plan.earnings_event_id,
    extractionPurpose: QualitativeExtractionPurpose.historicalReconstruction,
    experimentVersion: plan.experiment_version,
    inputFingerprint: qualitativeInput.inputSha256,
    providerStatus: providerResult.status,
    validationStatus: record.validation_status,
    requestedModel: providerResult.requestedModel,
    resolvedModel: providerResult.resolvedModel,
    tokenUsage: providerResult.tokenUsage,
  }
}
