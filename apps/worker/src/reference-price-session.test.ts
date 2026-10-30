import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MarketCalendar,
  MarketCalendarVersion,
  RuleVersion,
} from './constants.js'
import { selectPlannedReferencePriceSession } from './reference-price-session.js'

interface QueryResult {
  data: Record<string, string> | null
  error: unknown
}

function databaseClientReturning(
  result: QueryResult,
  recordedCalls: string[],
): SupabaseClient {
  const query = {
    select(columns: string) {
      recordedCalls.push(`select:${columns}`)
      return this
    },
    eq(column: string, value: string) {
      recordedCalls.push(`eq:${column}:${value}`)
      return this
    },
    gt(column: string, value: string) {
      recordedCalls.push(`gt:${column}:${value}`)
      return this
    },
    order(column: string, options: { ascending: boolean }) {
      recordedCalls.push(`order:${column}:${options.ascending}`)
      return this
    },
    limit(count: number) {
      recordedCalls.push(`limit:${count}`)
      return this
    },
    async maybeSingle() {
      return result
    },
  }

  return {
    from(table: string) {
      recordedCalls.push(`from:${table}`)
      return query
    },
  } as unknown as SupabaseClient
}

test('selects the first market opening strictly after the analysis cutoff', async () => {
  const recordedCalls: string[] = []
  const client = databaseClientReturning({
    data: {
      session_date: '2026-11-30',
      opens_at: '2026-11-30T14:30:00+00:00',
      calendar_code: MarketCalendar.unitedStatesEquities,
      calendar_version: MarketCalendarVersion.unitedStatesEquities2026Through2028,
    },
    error: null,
  }, recordedCalls)

  const selectedSession = await selectPlannedReferencePriceSession(
    client,
    '2026-11-27T14:30:00.000Z',
  )

  assert.deepEqual(selectedSession, {
    sessionDate: '2026-11-30',
    opensAt: '2026-11-30T14:30:00.000Z',
    calendarCode: MarketCalendar.unitedStatesEquities,
    calendarVersion: MarketCalendarVersion.unitedStatesEquities2026Through2028,
    ruleVersion: RuleVersion.referencePriceSession,
  })
  assert.ok(recordedCalls.includes('gt:opens_at:2026-11-27T14:30:00.000Z'))
  assert.ok(recordedCalls.includes('order:opens_at:true'))
  assert.ok(recordedCalls.includes('limit:1'))
})

test('rejects an invalid analysis cutoff before querying the database', async () => {
  const recordedCalls: string[] = []
  const client = databaseClientReturning({ data: null, error: null }, recordedCalls)

  await assert.rejects(
    selectPlannedReferencePriceSession(client, 'not-a-timestamp'),
    /Invalid analysis cutoff timestamp/,
  )
  assert.deepEqual(recordedCalls, [])
})

test('fails clearly when the stored calendar has no later session', async () => {
  const client = databaseClientReturning({ data: null, error: null }, [])

  await assert.rejects(
    selectPlannedReferencePriceSession(client, '2029-01-01T00:00:00.000Z'),
    /No us_equities session.*opens after/,
  )
})

test('rejects a database result that does not actually open after the cutoff', async () => {
  const client = databaseClientReturning({
    data: {
      session_date: '2026-11-27',
      opens_at: '2026-11-27T14:30:00.000Z',
      calendar_code: MarketCalendar.unitedStatesEquities,
      calendar_version: MarketCalendarVersion.unitedStatesEquities2026Through2028,
    },
    error: null,
  }, [])

  await assert.rejects(
    selectPlannedReferencePriceSession(client, '2026-11-27T14:30:00.000Z'),
    /must open after the analysis cutoff/,
  )
})
