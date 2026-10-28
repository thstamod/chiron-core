import type { QualitativeExtraction } from '@chiron/shared'
import { QualitativeProviderStatus } from './constants.js'

export interface QualitativeExtractionPrompt {
  version: string
  instructions: string
  documentInput: string
}

export interface QualitativeProviderRequestMetadata {
  earningsEventId: string
  analysisCutoffAt: string
  inputFingerprint: string
  schemaVersion: string
  inputSelectionVersion: string
}

export interface QualitativeProviderRequest {
  metadata: QualitativeProviderRequestMetadata
  prompt: QualitativeExtractionPrompt
  allowedPassageIds: string[]
  maximumOutputTokens: number
}

export interface QualitativeProviderTokenUsage {
  inputTokens: number | null
  cachedInputTokens: number | null
  cacheWriteTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
}

interface QualitativeProviderResultMetadata {
  providerName: string
  providerRequestId: string | null
  requestedModel: string
  resolvedModel: string | null
  startedAt: string
  finishedAt: string
  durationMilliseconds: number
  tokenUsage: QualitativeProviderTokenUsage
}

export interface CompletedQualitativeProviderResult
  extends QualitativeProviderResultMetadata {
  status: typeof QualitativeProviderStatus.completed
  extraction: QualitativeExtraction
}

export interface UnsuccessfulQualitativeProviderResult
  extends QualitativeProviderResultMetadata {
  status: Exclude<
    typeof QualitativeProviderStatus[keyof typeof QualitativeProviderStatus],
    typeof QualitativeProviderStatus.completed
  >
  extraction: null
  failureReason: string
  retryable: boolean
}

export type QualitativeProviderResult =
  | CompletedQualitativeProviderResult
  | UnsuccessfulQualitativeProviderResult

export interface QualitativeExtractionProvider {
  extract(request: QualitativeProviderRequest): Promise<QualitativeProviderResult>
}
