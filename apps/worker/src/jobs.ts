import type { SupabaseClient } from '@supabase/supabase-js'
import { JobStatus } from './constants.js'
import { createJobRun, finishJobRun } from './database.js'

export async function runTrackedJob<T extends Record<string, unknown>>(
  client: SupabaseClient,
  jobName: string,
  operation: () => Promise<T>,
): Promise<T> {
  const jobRunId = await createJobRun(client, jobName)

  try {
    const details = await operation()
    await finishJobRun(client, jobRunId, JobStatus.succeeded, details)
    return details
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    try {
      await finishJobRun(client, jobRunId, JobStatus.failed, {}, message)
    } catch (finishError) {
      const finishMessage = finishError instanceof Error ? finishError.message : String(finishError)
      throw new Error(`${message}; additionally failed to record job failure: ${finishMessage}`)
    }
    throw error
  }
}
