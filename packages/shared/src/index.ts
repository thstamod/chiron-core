export type GuidanceChange = 'raised' | 'maintained' | 'lowered' | 'unclear'
export type EventStatus = 'tracking' | 'complete'

export interface DemoEarningsEvent {
  id: string
  company: string
  ticker: string
  period: string
  score: number
  guidance: GuidanceChange
  summary: string
  mainRisk: string
  status: EventStatus
  marketComparison: number | null
}

export interface WorkerHealth {
  service: string
  phase: 'foundation' | 'ingestion' | 'extraction' | 'evaluation'
  ready: boolean
  checkedAt: string
}
