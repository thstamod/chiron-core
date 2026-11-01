export interface ResearchEvaluation {
  horizonDays: number
  stockMinusMarketReturn: number
}

export interface ResearchScoreComponent {
  code: string
  category: 'financial' | 'qualitative'
  points: number
  explanation: string
}

export interface ResearchPrediction {
  id: string
  score: number
  financialScore: number
  qualitativeScore: number
  uncappedCombinedScore: number
  scoreComponents: ResearchScoreComponent[]
  ruleVersion: string
  cutoffAt: string
  recordedAt: string
  plannedEntrySession: string
  plannedDay1Session: string
  plannedDay5Session: string
  plannedDay20Session: string
  summary: string | null
  guidanceDirection: string
  guidanceSummary: string | null
  marginDirection: string
  managementTone: string
  mainRisk: string | null
  evaluations: ResearchEvaluation[]
}

export interface ResearchEarningsEvent {
  id: string
  companyId: string
  companyName: string
  ticker: string
  sector: string | null
  periodEnd: string | null
  detectedAt: string
  status: string
  latestPrediction: ResearchPrediction | null
}

interface GraphQlError {
  message: string
}

interface RecentPredictionEventsResponse {
  data?: { recentPredictionEvents: ResearchEarningsEvent[] }
  errors?: GraphQlError[]
}

const ResearchApiConfig = {
  endpoint: '/graphql',
  recentEventsLimit: 25,
} as const

const RecentPredictionEventsQuery = /* GraphQL */ `
  query RecentPredictionEvents($limit: Int!) {
    recentPredictionEvents(limit: $limit) {
      id
      companyId
      companyName
      ticker
      sector
      periodEnd
      detectedAt
      status
      latestPrediction {
        id
        score
        financialScore
        qualitativeScore
        uncappedCombinedScore
        scoreComponents {
          code
          category
          points
          explanation
        }
        ruleVersion
        cutoffAt
        recordedAt
        plannedEntrySession
        plannedDay1Session
        plannedDay5Session
        plannedDay20Session
        summary
        guidanceDirection
        guidanceSummary
        marginDirection
        managementTone
        mainRisk
        evaluations {
          horizonDays
          stockMinusMarketReturn
        }
      }
    }
  }
`

export async function loadRecentPredictionEvents(): Promise<ResearchEarningsEvent[]> {
  const response = await fetch(ResearchApiConfig.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: RecentPredictionEventsQuery,
      variables: { limit: ResearchApiConfig.recentEventsLimit },
    }),
  })

  if (!response.ok) throw new Error(`Research API returned HTTP ${response.status}`)
  const result = await response.json() as RecentPredictionEventsResponse
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join('; '))
  if (!result.data) throw new Error('Research API returned no data')
  return result.data.recentPredictionEvents
}
