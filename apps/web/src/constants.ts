export const WebAppConfig = {
  mountSelector: '#app',
} as const

export const ScoreFormat = {
  positivePrefix: '+',
} as const

export const RequiredEvaluationHorizons = [1, 5, 20] as const

export const UiText = {
  waitingForResult: 'Waiting',
  unavailable: 'Unavailable',
  noSummary: 'A reviewed research summary is not available for this event yet.',
  noMainRisk: 'A reviewed main risk is not available for this event yet.',
} as const
