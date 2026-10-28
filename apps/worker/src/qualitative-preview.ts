import type { SupabaseClient } from '@supabase/supabase-js'
import { buildBaselineQualitativeProviderRequest } from './baseline-qualitative-prompt.js'
import { loadPreparedQualitativeExtractionInput } from './qualitative-input-loader.js'

export interface QualitativeExtractionPreview {
  earningsEventId: string
  analysisCutoffAt: string
  promptVersion: string
  schemaVersion: string
  inputSelectionVersion: string
  evidencePassageVersion: string
  inputFingerprint: string
  documents: {
    documentId: string
    role: string
    documentType: string
    publishedAt: string
    firstSeenAt: string
    characterCount: number
    passageCount: number
  }[]
  promptCharacterCount: number
  approximateInputTokens: number
  maximumOutputTokens: number
  warning: string
}

export async function previewQualitativeExtraction(
  client: SupabaseClient,
  earningsEventId: string,
  analysisCutoffAt: string,
): Promise<QualitativeExtractionPreview> {
  const preparedInput = await loadPreparedQualitativeExtractionInput(
    client,
    earningsEventId,
    analysisCutoffAt,
  )
  const request = buildBaselineQualitativeProviderRequest(preparedInput)
  const promptCharacterCount = request.prompt.instructions.length
    + request.prompt.documentInput.length

  return {
    earningsEventId,
    analysisCutoffAt: request.metadata.analysisCutoffAt,
    promptVersion: request.prompt.version,
    schemaVersion: request.metadata.schemaVersion,
    inputSelectionVersion: request.metadata.inputSelectionVersion,
    evidencePassageVersion: preparedInput.manifest.evidencePassageVersion,
    inputFingerprint: request.metadata.inputFingerprint,
    documents: preparedInput.manifest.documents.map((document) => ({
      documentId: document.documentId,
      role: document.role,
      documentType: document.documentType,
      publishedAt: document.publishedAt,
      firstSeenAt: document.firstSeenAt,
      characterCount: document.characterCount,
      passageCount: preparedInput.passages.filter(
        (passage) => passage.sourceDocumentId === document.documentId,
      ).length,
    })),
    promptCharacterCount,
    approximateInputTokens: Math.ceil(promptCharacterCount / 4),
    maximumOutputTokens: request.maximumOutputTokens,
    warning: 'Token count is a rough character-based prompt estimate and excludes provider schema overhead; no OpenAI request was made.',
  }
}
