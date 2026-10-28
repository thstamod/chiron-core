import type { SupabaseClient } from '@supabase/supabase-js'
import { buildBaselineQualitativeProviderRequest } from './baseline-qualitative-prompt.js'
import { buildOpenAIQualitativeResponseFormat } from './openai-qualitative-provider.js'
import type { PreparedQualitativeExtractionInput } from './qualitative-extraction.js'
import { loadPreparedQualitativeExtractionInput } from './qualitative-input-loader.js'

export interface QualitativeExtractionPreview {
  earningsEventId: string
  analysisCutoffAt: string
  promptVersion: string
  schemaVersion: string
  inputSelectionVersion: string
  evidencePassageVersion: string
  sourceCoverage: PreparedQualitativeExtractionInput['manifest']['sourceCoverage']
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
  structuredOutputSchemaCharacterCount: number
  approximatePromptTokens: number
  approximateStructuredOutputSchemaTokens: number
  approximateTotalInputTokens: number
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
  const structuredOutputSchemaCharacterCount = JSON.stringify(
    buildOpenAIQualitativeResponseFormat(),
  ).length
  const approximatePromptTokens = Math.ceil(promptCharacterCount / 4)
  const approximateStructuredOutputSchemaTokens = Math.ceil(
    structuredOutputSchemaCharacterCount / 4,
  )

  return {
    earningsEventId,
    analysisCutoffAt: request.metadata.analysisCutoffAt,
    promptVersion: request.prompt.version,
    schemaVersion: request.metadata.schemaVersion,
    inputSelectionVersion: request.metadata.inputSelectionVersion,
    evidencePassageVersion: preparedInput.manifest.evidencePassageVersion,
    sourceCoverage: preparedInput.manifest.sourceCoverage,
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
    structuredOutputSchemaCharacterCount,
    approximatePromptTokens,
    approximateStructuredOutputSchemaTokens,
    approximateTotalInputTokens:
      approximatePromptTokens + approximateStructuredOutputSchemaTokens,
    maximumOutputTokens: request.maximumOutputTokens,
    warning: 'Token counts are rough character-based estimates; no OpenAI request was made.',
  }
}
