import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EvaluationHorizonTradingDays,
  MarketCalendar,
  MarketCalendarVersion,
  RuleVersion,
} from './constants.js'
import {
  selectPlannedPredictionSessions,
  selectPlannedReferencePriceSession,
} from './reference-price-session.js'

interface QueryResult {
  data: unknown
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
    then<TResult1 = QueryResult, TResult2 = never>(
      onFulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(result).then(onFulfilled, onRejected)
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
      calendar_version: MarketCalendarVersion.unitedStatesEquities2024Through2028,
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
    calendarVersion: MarketCalendarVersion.unitedStatesEquities2024Through2028,
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
      calendar_version: MarketCalendarVersion.unitedStatesEquities2024Through2028,
    },
    error: null,
  }, [])

  await assert.rejects(
    selectPlannedReferencePriceSession(client, '2026-11-27T14:30:00.000Z'),
    /must open after the analysis cutoff/,
  )
})

const november2026SessionDates = [
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-09',
  '2026-11-10',
  '2026-11-11',
  '2026-11-12',
  '2026-11-13',
  '2026-11-16',
  '2026-11-17',
  '2026-11-18',
  '2026-11-19',
  '2026-11-20',
  '2026-11-23',
  '2026-11-24',
  '2026-11-25',
  '2026-11-27',
  '2026-11-30',
]

function storedSessions(dates: string[]) {
  return dates.map((sessionDate) => ({
    session_date: sessionDate,
    opens_at: `${sessionDate}T14:30:00.000Z`,
    calendar_code: MarketCalendar.unitedStatesEquities,
    calendar_version: MarketCalendarVersion.unitedStatesEquities2024Through2028,
  }))
}

test('plans entry-inclusive one, five, and twenty-session horizons', async () => {
  const recordedCalls: string[] = []
  const client = databaseClientReturning({
    data: storedSessions(november2026SessionDates),
    error: null,
  }, recordedCalls)

  const schedule = await selectPlannedPredictionSessions(
    client,
    '2026-10-30T18:10:00.000Z',
  )

  assert.equal(schedule.entry.sessionDate, '2026-11-02')
  assert.equal(schedule.day1SessionDate, '2026-11-02')
  assert.equal(schedule.day5SessionDate, '2026-11-06')
  assert.equal(schedule.day20SessionDate, '2026-11-30')
  assert.equal(schedule.evaluationSessionRuleVersion, RuleVersion.evaluationSessionPlan)
  assert.ok(recordedCalls.includes(`limit:${EvaluationHorizonTradingDays.twenty}`))
})

test('refuses to plan a prediction without twenty future sessions', async () => {
  const client = databaseClientReturning({
    data: storedSessions(november2026SessionDates.slice(0, -1)),
    error: null,
  }, [])

  await assert.rejects(
    selectPlannedPredictionSessions(client, '2026-10-30T18:10:00.000Z'),
    /does not contain 20 sessions after/,
  )
})

test('refuses an entry session that reveals missing calendar coverage', async () => {
  const client = databaseClientReturning({
    data: storedSessions(november2026SessionDates),
    error: null,
  }, [])

  await assert.rejects(
    selectPlannedPredictionSessions(client, '2025-08-01T10:04:08.000Z'),
    /more than 7 calendar days.*calendar coverage may be incomplete/,
  )
})
