import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses'
import {
  qualitativeExtractionSchema,
} from '@chiron/shared'
import type { OpenAILanguageModelConfig } from './config.js'
import {
  LanguageModelProvider,
  OpenAIConfig,
  OpenAIRetryPolicy,
  QualitativeProviderStatus,
} from './constants.js'
import type {
  QualitativeExtractionProvider,
  QualitativeProviderRequest,
  QualitativeProviderResult,
  QualitativeProviderTokenUsage,
} from './qualitative-provider.js'

interface OpenAIResponseUsage {
  input_tokens: number
  input_tokens_details: {
    cached_tokens: number
    cache_write_tokens: number
  }
  output_tokens: number
  output_tokens_details: { reasoning_tokens: number }
  total_tokens: number
}

export interface OpenAIQualitativeResponse {
  id: string
  model: string
  status?: string
  output: unknown[]
  output_parsed: unknown
  incomplete_details: { reason?: string } | null
  error: { code: string; message: string } | null
  usage?: OpenAIResponseUsage
}

export interface OpenAIResponsesParser {
  parse(request: ResponseCreateParamsNonStreaming): Promise<OpenAIQualitativeResponse>
}

interface OpenAIQualitativeProviderOptions {
  model: string
  responsesParser: OpenAIResponsesParser
  now?: () => number
}

function emptyTokenUsage(): QualitativeProviderTokenUsage {
  return {
    inputTokens: null,
    cachedInputTokens: null,
    cacheWriteTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
  }
}

function tokenUsage(response: OpenAIQualitativeResponse): QualitativeProviderTokenUsage {
  if (!response.usage) return emptyTokenUsage()
  return {
    inputTokens: response.usage.input_tokens,
    cachedInputTokens: response.usage.input_tokens_details.cached_tokens,
    cacheWriteTokens: response.usage.input_tokens_details.cache_write_tokens,
    outputTokens: response.usage.output_tokens,
    reasoningTokens: response.usage.output_tokens_details.reasoning_tokens,
    totalTokens: response.usage.total_tokens,
  }
}

function refusalReason(output: unknown[]): string | null {
  for (const item of output) {
    if (!item || typeof item !== 'object' || !('content' in item)) continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (
        part
        && typeof part === 'object'
        && 'type' in part
        && part.type === 'refusal'
        && 'refusal' in part
        && typeof part.refusal === 'string'
      ) {
        return part.refusal
      }
    }
  }
  return null
}

function requestFailureDetails(error: unknown): {
  providerRequestId: string | null
  status: typeof QualitativeProviderStatus.requestFailed
    | typeof QualitativeProviderStatus.invalidOutput
  failureReason: string
  retryable: boolean
} {
  if (error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError')) {
    return {
      providerRequestId: null,
      status: QualitativeProviderStatus.invalidOutput,
      failureReason: error.message,
      retryable: false,
    }
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return {
      providerRequestId: null,
      status: QualitativeProviderStatus.requestFailed,
      failureReason: error.message,
      retryable: true,
    }
  }
  if (error instanceof OpenAI.APIError) {
    const status = error.status
    return {
      providerRequestId: error.requestID ?? null,
      status: QualitativeProviderStatus.requestFailed,
      failureReason: error.message,
      retryable: OpenAIRetryPolicy.retryableHttpStatuses.has(status ?? 0)
        || OpenAIRetryPolicy.retryableErrorCodes.has(error.code ?? '')
        || (status ?? 0) >= 500,
    }
  }
  return {
    providerRequestId: null,
    status: QualitativeProviderStatus.requestFailed,
    failureReason: error instanceof Error ? error.message : String(error),
    retryable: false,
  }
}

export class OpenAIQualitativeExtractionProvider implements QualitativeExtractionProvider {
  private readonly model: string
  private readonly responsesParser: OpenAIResponsesParser
  private readonly now: () => number

  constructor(options: OpenAIQualitativeProviderOptions) {
    this.model = options.model
    this.responsesParser = options.responsesParser
    this.now = options.now ?? Date.now
  }

  async extract(request: QualitativeProviderRequest): Promise<QualitativeProviderResult> {
    const startedMilliseconds = this.now()
    const startedAt = new Date(startedMilliseconds).toISOString()

    try {
      const response = await this.responsesParser.parse({
        model: this.model,
        input: [
          { role: 'system', content: request.prompt.instructions },
          { role: 'user', content: request.prompt.documentInput },
        ],
        text: {
          format: zodTextFormat(
            qualitativeExtractionSchema,
            OpenAIConfig.qualitativeResponseFormatName,
          ),
        },
        max_output_tokens: request.maximumOutputTokens,
        reasoning: { effort: OpenAIConfig.reasoningEffort },
        store: false,
        truncation: 'disabled',
      })
      const finishedMilliseconds = this.now()
      const sharedResult = {
        providerName: LanguageModelProvider.openAi,
        providerRequestId: response.id,
        requestedModel: this.model,
        resolvedModel: response.model,
        startedAt,
        finishedAt: new Date(finishedMilliseconds).toISOString(),
        durationMilliseconds: Math.max(0, finishedMilliseconds - startedMilliseconds),
        tokenUsage: tokenUsage(response),
      }
      const refusal = refusalReason(response.output)
      if (refusal) {
        return {
          ...sharedResult,
          status: QualitativeProviderStatus.refused,
          extraction: null,
          failureReason: refusal,
          retryable: false,
        }
      }
      if (response.status === 'incomplete') {
        return {
          ...sharedResult,
          status: QualitativeProviderStatus.incomplete,
          extraction: null,
          failureReason: response.incomplete_details?.reason ?? 'OpenAI response was incomplete',
          retryable: false,
        }
      }
      if (response.status !== 'completed') {
        return {
          ...sharedResult,
          status: QualitativeProviderStatus.requestFailed,
          extraction: null,
          failureReason: response.error?.message ?? `OpenAI response status was ${response.status}`,
          retryable: response.error?.code === 'server_error'
            || response.error?.code === 'rate_limit_exceeded',
        }
      }

      const parsedExtraction = qualitativeExtractionSchema.safeParse(response.output_parsed)
      if (!parsedExtraction.success) {
        return {
          ...sharedResult,
          status: QualitativeProviderStatus.invalidOutput,
          extraction: null,
          failureReason: 'OpenAI response did not match the qualitative extraction schema',
          retryable: false,
        }
      }

      return {
        ...sharedResult,
        status: QualitativeProviderStatus.completed,
        extraction: parsedExtraction.data,
      }
    } catch (error: unknown) {
      const finishedMilliseconds = this.now()
      const failure = requestFailureDetails(error)
      return {
        providerName: LanguageModelProvider.openAi,
        providerRequestId: failure.providerRequestId,
        requestedModel: this.model,
        resolvedModel: null,
        startedAt,
        finishedAt: new Date(finishedMilliseconds).toISOString(),
        durationMilliseconds: Math.max(0, finishedMilliseconds - startedMilliseconds),
        tokenUsage: emptyTokenUsage(),
        status: failure.status,
        extraction: null,
        failureReason: failure.failureReason,
        retryable: failure.retryable,
      }
    }
  }
}

export function createOpenAIQualitativeExtractionProvider(
  config: OpenAILanguageModelConfig,
): OpenAIQualitativeExtractionProvider {
  const client = new OpenAI({
    apiKey: config.apiKey,
    maxRetries: OpenAIConfig.maximumRetries,
    timeout: OpenAIConfig.requestTimeoutMilliseconds,
  })
  return new OpenAIQualitativeExtractionProvider({
    model: config.model,
    responsesParser: {
      parse: (request) => client.responses.parse(request),
    },
  })
}
