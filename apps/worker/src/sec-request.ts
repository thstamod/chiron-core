import { SecRequest, SecRequestPolicy, WorkerTiming } from './constants.js'

type Sleep = (milliseconds: number) => Promise<void>

interface SecRequestClientOptions {
  fetchImplementation?: typeof fetch
  now?: () => number
  sleep?: Sleep
  minimumIntervalMs?: number
  maximumAttempts?: number
  baseRetryDelayMs?: number
  maximumRetryDelayMs?: number
  requestTimeoutMs?: number
}

interface SecResourceRequest {
  url: string | URL
  headers: HeadersInit
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class SecRequestClient {
  private readonly fetchImplementation: typeof fetch
  private readonly now: () => number
  private readonly sleep: Sleep
  private readonly minimumIntervalMs: number
  private readonly maximumAttempts: number
  private readonly baseRetryDelayMs: number
  private readonly maximumRetryDelayMs: number
  private readonly requestTimeoutMs: number
  private nextRequestAt = 0
  private limiterQueue: Promise<void> = Promise.resolve()

  constructor(options: SecRequestClientOptions = {}) {
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.minimumIntervalMs = options.minimumIntervalMs ?? SecRequestPolicy.minimumIntervalMs
    this.maximumAttempts = options.maximumAttempts ?? SecRequestPolicy.maximumAttempts
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? SecRequestPolicy.baseRetryDelayMs
    this.maximumRetryDelayMs = options.maximumRetryDelayMs ?? SecRequestPolicy.maximumRetryDelayMs
    this.requestTimeoutMs = options.requestTimeoutMs ?? WorkerTiming.secRequestTimeoutMs
  }

  private async startRequest(
    input: RequestInfo | URL,
    init: RequestInit,
  ): Promise<Response> {
    let releaseSlot = (): void => undefined
    const previousSlot = this.limiterQueue
    this.limiterQueue = new Promise<void>((resolve) => {
      releaseSlot = resolve
    })

    await previousSlot
    let request: Promise<Response>
    try {
      const waitMilliseconds = Math.max(0, this.nextRequestAt - this.now())
      if (waitMilliseconds > 0) await this.sleep(waitMilliseconds)
      this.nextRequestAt = this.now() + this.minimumIntervalMs
      request = this.fetchImplementation(input, init)
    } finally {
      releaseSlot()
    }

    return request
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get(SecRequest.retryAfterHeader)
    if (retryAfter) {
      const seconds = Number.parseFloat(retryAfter)
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1_000, this.maximumRetryDelayMs)
      }

      const retryDate = Date.parse(retryAfter)
      if (!Number.isNaN(retryDate)) {
        return Math.min(Math.max(0, retryDate - this.now()), this.maximumRetryDelayMs)
      }
    }

    return Math.min(
      this.baseRetryDelayMs * 2 ** (attempt - 1),
      this.maximumRetryDelayMs,
    )
  }

  async fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    let lastError: unknown

    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      try {
        const response = await this.startRequest(input, {
          ...init,
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        })

        const shouldRetry = SecRequestPolicy.retryableStatuses.has(response.status)
          && attempt < this.maximumAttempts
        if (!shouldRetry) return response

        const delay = this.retryDelay(response, attempt)
        await response.body?.cancel()
        if (delay > 0) await this.sleep(delay)
      } catch (error) {
        lastError = error
        if (attempt === this.maximumAttempts) throw error

        const delay = Math.min(
          this.baseRetryDelayMs * 2 ** (attempt - 1),
          this.maximumRetryDelayMs,
        )
        if (delay > 0) await this.sleep(delay)
      }
    }

    throw lastError ?? new Error('SEC request failed without a response')
  }
}

const sharedSecRequestClient = new SecRequestClient()

export function fetchSecResource(
  request: SecResourceRequest,
): Promise<Response> {
  return sharedSecRequestClient.fetch(request.url, { headers: request.headers })
}
