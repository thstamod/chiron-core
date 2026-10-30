import type { SupabaseClient } from '@supabase/supabase-js'
import {
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
    .from('market_sessions')
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
