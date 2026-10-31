import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DatabaseTable,
  EvaluationHorizonTradingDays,
  MarketCalendar,
  MarketCalendarVersion,
  RuleVersion,
} from './constants.js'

interface StoredMarketSession {
  session_date: string
  opens_at: string
  calendar_code: string
  calendar_version: string
}

export interface PlannedReferencePriceSession {
  sessionDate: string
  opensAt: string
  calendarCode: string
  calendarVersion: string
  ruleVersion: string
}

export interface PlannedPredictionSessions {
  entry: PlannedReferencePriceSession
  day1SessionDate: string
  day5SessionDate: string
  day20SessionDate: string
  evaluationSessionRuleVersion: string
}

function normalizedTimestamp(timestamp: string, description: string): string {
  const parsedTimestamp = new Date(timestamp)
  if (Number.isNaN(parsedTimestamp.valueOf())) {
    throw new Error(`Invalid ${description}: ${timestamp}`)
  }
  return parsedTimestamp.toISOString()
}

export async function selectPlannedReferencePriceSession(
  client: SupabaseClient,
  analysisCutoffAt: string,
): Promise<PlannedReferencePriceSession> {
  const normalizedAnalysisCutoffAt = normalizedTimestamp(
    analysisCutoffAt,
    'analysis cutoff timestamp',
  )
  const calendarCode = MarketCalendar.unitedStatesEquities
  const calendarVersion = MarketCalendarVersion.unitedStatesEquities2026Through2028

  const { data, error } = await client
    .from(DatabaseTable.marketSessions)
    .select('session_date,opens_at,calendar_code,calendar_version')
    .eq('calendar_code', calendarCode)
    .eq('calendar_version', calendarVersion)
    .gt('opens_at', normalizedAnalysisCutoffAt)
    .order('opens_at', { ascending: true })
    .limit(1)
    .maybeSingle<StoredMarketSession>()

  if (error) {
    throw new Error('Could not select the planned reference-price session', { cause: error })
  }
  if (!data) {
    throw new Error(
      `No ${calendarCode} session in ${calendarVersion} opens after ${normalizedAnalysisCutoffAt}`,
    )
  }

  const opensAt = normalizedTimestamp(data.opens_at, 'market-session opening timestamp')
  if (opensAt <= normalizedAnalysisCutoffAt) {
    throw new Error('The selected reference-price session must open after the analysis cutoff')
  }

  return {
    sessionDate: data.session_date,
    opensAt,
    calendarCode: data.calendar_code,
    calendarVersion: data.calendar_version,
    ruleVersion: RuleVersion.referencePriceSession,
  }
}

function requireStoredMarketSession(
  value: unknown,
  calendarCode: string,
  calendarVersion: string,
  analysisCutoffAt: string,
): StoredMarketSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Prediction schedule contains an invalid market-session row')
  }
  const row = value as Record<string, unknown>
  if (
    typeof row.session_date !== 'string'
    || typeof row.opens_at !== 'string'
    || row.calendar_code !== calendarCode
    || row.calendar_version !== calendarVersion
  ) {
    throw new Error('Prediction schedule contains mismatched market-session data')
  }
  const opensAt = normalizedTimestamp(row.opens_at, 'market-session opening timestamp')
  if (opensAt <= analysisCutoffAt) {
    throw new Error('Every planned prediction session must open after the analysis cutoff')
  }
  return {
    session_date: row.session_date,
    opens_at: opensAt,
    calendar_code: calendarCode,
    calendar_version: calendarVersion,
  }
}

export async function selectPlannedPredictionSessions(
  client: SupabaseClient,
  analysisCutoffAt: string,
): Promise<PlannedPredictionSessions> {
  const normalizedAnalysisCutoffAt = normalizedTimestamp(
    analysisCutoffAt,
    'analysis cutoff timestamp',
  )
  const calendarCode = MarketCalendar.unitedStatesEquities
  const calendarVersion = MarketCalendarVersion.unitedStatesEquities2026Through2028
  const requiredSessionCount = EvaluationHorizonTradingDays.twenty

  const { data, error } = await client
    .from(DatabaseTable.marketSessions)
    .select('session_date,opens_at,calendar_code,calendar_version')
    .eq('calendar_code', calendarCode)
    .eq('calendar_version', calendarVersion)
    .gt('opens_at', normalizedAnalysisCutoffAt)
    .order('opens_at', { ascending: true })
    .limit(requiredSessionCount)

  if (error) {
    throw new Error('Could not select planned prediction sessions', { cause: error })
  }
  if (!data || data.length !== requiredSessionCount) {
    throw new Error(
      `${calendarVersion} does not contain ${requiredSessionCount} sessions after `
      + normalizedAnalysisCutoffAt,
    )
  }

  const sessions = data.map((row) => requireStoredMarketSession(
    row,
    calendarCode,
    calendarVersion,
    normalizedAnalysisCutoffAt,
  ))
  for (let index = 1; index < sessions.length; index += 1) {
    if (sessions[index]!.opens_at <= sessions[index - 1]!.opens_at) {
      throw new Error('Planned prediction sessions must be ordered by increasing opening time')
    }
  }

  const entrySession = sessions[0]!
  return {
    entry: {
      sessionDate: entrySession.session_date,
      opensAt: entrySession.opens_at,
      calendarCode,
      calendarVersion,
      ruleVersion: RuleVersion.referencePriceSession,
    },
    day1SessionDate: sessions[EvaluationHorizonTradingDays.one - 1]!.session_date,
    day5SessionDate: sessions[EvaluationHorizonTradingDays.five - 1]!.session_date,
    day20SessionDate: sessions[EvaluationHorizonTradingDays.twenty - 1]!.session_date,
    evaluationSessionRuleVersion: RuleVersion.evaluationSessionPlan,
  }
}
