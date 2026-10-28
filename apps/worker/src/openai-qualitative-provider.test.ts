import assert from 'node:assert/strict'
import test from 'node:test'
import OpenAI from 'openai'
import type { QualitativeExtraction } from '@chiron/shared'
import { QualitativeProviderStatus } from './constants.js'
import {
  OpenAIQualitativeExtractionProvider,
  type OpenAIQualitativeResponse,
  type OpenAIResponsesParser,
} from './openai-qualitative-provider.js'
import type { QualitativeProviderRequest } from './qualitative-provider.js'

const validExtraction: QualitativeExtraction = {
  guidance: {
    status: 'not_provided',
    items: [],
    summary: null,
    evidence: [],
  },
  marginDirection: {
    direction: 'not_disclosed',
    summary: null,
    evidence: [],
  },
  managementTone: {
    currentTone: 'unclear',
    changeFromPrevious: 'unavailable',
    summary: null,
    currentEvidence: [],
    previousEvidence: [],
  },
  keyPositives: [],
  keyRisks: [],
  summary: 'The supplied release did not contain enough qualitative information.',
  sourceLimitations: ['No previous release was supplied.'],
}

const providerRequest: QualitativeProviderRequest = {
  metadata: {
    earningsEventId: 'event-1',
    analysisCutoffAt: '2026-10-21T00:00:00.000Z',
    inputFingerprint: 'input-fingerprint',
    schemaVersion: 'qualitative-earnings-v4',
    inputSelectionVersion: 'earnings-release-input-v1',
  },
  prompt: {
    version: 'baseline-v4',
    instructions: 'Extract only supported qualitative facts.',
    documentInput: 'BEGIN_DOCUMENT\nDocument text\nEND_DOCUMENT',
  },
  maximumOutputTokens: 2_000,
}

function openAIResponse(
  overrides: Partial<OpenAIQualitativeResponse> = {},
): OpenAIQualitativeResponse {
  return {
    id: 'resp-1',
    model: 'resolved-model-2026-10-01',
    status: 'completed',
    output: [],
    output_parsed: validExtraction,
    incomplete_details: null,
    error: null,
    usage: {
      input_tokens: 1_000,
      input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
      output_tokens: 300,
      output_tokens_details: { reasoning_tokens: 50 },
      total_tokens: 1_300,
    },
    ...overrides,
  }
}

function testClock(): () => number {
  const times = [1_000, 1_250]
  return () => times.shift() ?? 1_250
}

test('sends one structured, non-stored OpenAI request and normalizes success', async () => {
  const requests: Parameters<OpenAIResponsesParser['parse']>[0][] = []
  const responsesParser: OpenAIResponsesParser = {
    async parse(request) {
      requests.push(request)
      return openAIResponse()
    },
  }
  const provider = new OpenAIQualitativeExtractionProvider({
    model: 'requested-model',
    responsesParser,
    now: testClock(),
  })

  const result = await provider.extract(providerRequest)

  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.model, 'requested-model')
  assert.equal(requests[0]?.max_output_tokens, 2_000)
  assert.equal(requests[0]?.reasoning?.effort, 'low')
  assert.equal(requests[0]?.store, false)
  assert.equal(requests[0]?.truncation, 'disabled')
  assert.equal(requests[0]?.text?.format?.type, 'json_schema')
  assert.equal(requests[0]?.text?.format?.name, 'chiron_qualitative_earnings')
  assert.doesNotMatch(JSON.stringify(requests[0]?.text?.format), /current-p0001/)
  assert.doesNotMatch(JSON.stringify(requests[0]), /input-fingerprint/)
  assert.equal(result.status, QualitativeProviderStatus.completed)
  assert.equal(result.providerRequestId, 'resp-1')
  assert.equal(result.resolvedModel, 'resolved-model-2026-10-01')
  assert.equal(result.durationMilliseconds, 250)
  assert.equal(result.tokenUsage.cachedInputTokens, 200)
  assert.equal(result.tokenUsage.cacheWriteTokens, 100)
  assert.equal(result.tokenUsage.reasoningTokens, 50)
})

test('records a refusal without retrying', async () => {
  let requestCount = 0
  const provider = new OpenAIQualitativeExtractionProvider({
    model: 'requested-model',
    now: testClock(),
    responsesParser: {
      async parse() {
        requestCount += 1
        return openAIResponse({
          output: [{ content: [{ type: 'refusal', refusal: 'Request refused.' }] }],
          output_parsed: null,
        })
      },
    },
  })

  const result = await provider.extract(providerRequest)

  assert.equal(requestCount, 1)
  assert.equal(result.status, QualitativeProviderStatus.refused)
  assert.equal(result.extraction, null)
  assert.equal(result.retryable, false)
})

test('records an output-limit response without retrying', async () => {
  let requestCount = 0
  const provider = new OpenAIQualitativeExtractionProvider({
    model: 'requested-model',
    now: testClock(),
    responsesParser: {
      async parse() {
        requestCount += 1
        return openAIResponse({
          status: 'incomplete',
          output_parsed: null,
          incomplete_details: { reason: 'max_output_tokens' },
        })
      },
    },
  })

  const result = await provider.extract(providerRequest)

  assert.equal(requestCount, 1)
  assert.equal(result.status, QualitativeProviderStatus.incomplete)
  assert.equal(result.failureReason, 'max_output_tokens')
  assert.equal(result.retryable, false)
})

test('records schema-invalid output without retrying', async () => {
  let requestCount = 0
  const provider = new OpenAIQualitativeExtractionProvider({
    model: 'requested-model',
    now: testClock(),
    responsesParser: {
      async parse() {
        requestCount += 1
        return openAIResponse({ output_parsed: { guidance: 'raised' } })
      },
    },
  })

  const result = await provider.extract(providerRequest)

  assert.equal(requestCount, 1)
  assert.equal(result.status, QualitativeProviderStatus.invalidOutput)
  assert.equal(result.retryable, false)
})

test('leaves exact passage existence validation to the local evidence validator', async () => {
  const provider = new OpenAIQualitativeExtractionProvider({
    model: 'requested-model',
    now: testClock(),
    responsesParser: {
      async parse() {
        return openAIResponse({
          output_parsed: {
            ...validExtraction,
            guidance: {
              status: 'provided',
              items: [{
                metric: 'revenue',
                direction: 'maintained',
                period: 'full-year 2026',
                summary: 'Guidance was maintained.',
                evidence: [{ passageId: 'current-p9999' }],
              }],
              summary: 'Guidance was maintained.',
              evidence: [],
            },
          },
        })
      },
    },
  })

  const result = await provider.extract(providerRequest)

  assert.equal(result.status, QualitativeProviderStatus.completed)
  assert.equal(result.extraction?.guidance.items[0]?.evidence[0]?.passageId, 'current-p9999')
})

test('records an SDK structured-output parse error without retrying', async () => {
  let requestCount = 0
  const provider = new OpenAIQualitativeExtractionProvider({
    model: 'requested-model',
    now: testClock(),
    responsesParser: {
      async parse() {
        requestCount += 1
        throw new SyntaxError('Invalid structured output JSON.')
      },
    },
  })

  const result = await provider.extract(providerRequest)

  assert.equal(requestCount, 1)
  assert.equal(result.status, QualitativeProviderStatus.invalidOutput)
  assert.equal(result.retryable, false)
})

test('marks a rate-limit API failure retryable but does not retry it', async () => {
  let requestCount = 0
  const provider = new OpenAIQualitativeExtractionProvider({
    model: 'requested-model',
    now: testClock(),
    responsesParser: {
      async parse() {
        requestCount += 1
        throw OpenAI.APIError.generate(
          429,
          { error: { message: 'Rate limited.', code: 'rate_limit_exceeded' } },
          'Rate limited.',
          new Headers({ 'x-request-id': 'request-429' }),
        )
      },
    },
  })

  const result = await provider.extract(providerRequest)

  assert.equal(requestCount, 1)
  assert.equal(result.status, QualitativeProviderStatus.requestFailed)
  assert.equal(result.retryable, true)
  assert.equal(result.providerRequestId, 'request-429')
})

test('does not mark a project spending-limit failure retryable', async () => {
  let requestCount = 0
  const provider = new OpenAIQualitativeExtractionProvider({
    model: 'requested-model',
    now: testClock(),
    responsesParser: {
      async parse() {
        requestCount += 1
        throw OpenAI.APIError.generate(
          429,
          {
            error: {
              message: 'Project spending limit reached.',
              code: 'project_spend_limit_exceeded',
            },
          },
          'Project spending limit reached.',
          new Headers({ 'x-request-id': 'request-spend-limit' }),
        )
      },
    },
  })

  const result = await provider.extract(providerRequest)

  assert.equal(requestCount, 1)
  assert.equal(result.status, QualitativeProviderStatus.requestFailed)
  assert.equal(result.retryable, false)
})

test('marks a temporary connection failure retryable but does not retry it', async () => {
  let requestCount = 0
  const provider = new OpenAIQualitativeExtractionProvider({
    model: 'requested-model',
    now: testClock(),
    responsesParser: {
      async parse() {
        requestCount += 1
        throw new OpenAI.APIConnectionError({
          message: 'Temporary connection failure.',
          cause: new Error('Connection reset.'),
        })
      },
    },
  })

  const result = await provider.extract(providerRequest)

  assert.equal(requestCount, 1)
  assert.equal(result.status, QualitativeProviderStatus.requestFailed)
  assert.equal(result.retryable, true)
})
