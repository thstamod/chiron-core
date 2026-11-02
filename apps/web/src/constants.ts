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

export const FinancialMetricLabel: Readonly<Record<string, string>> = {
  revenue: 'Revenue',
  net_income: 'Net income',
  earnings_per_share_basic: 'Basic earnings per share',
  earnings_per_share_diluted: 'Diluted earnings per share',
  revenue_growth_year_over_year_percent: 'Revenue growth from the same period last year',
  net_margin_percent: 'Net margin',
  net_margin_change_year_over_year_percentage_points:
    'Net-margin change from the same period last year',
}

export const FinancialMetricUnit = {
  unitedStatesDollar: 'USD',
  unitedStatesDollarPerShare: 'USD/share',
  percent: 'percent',
  percentagePoints: 'percentage_points',
} as const

export const SourceDocumentTypeLabel: Readonly<Record<string, string>> = {
  'sec-primary-document': 'SEC primary filing',
  'sec-exhibit-99.1': 'Earnings release exhibit (99.1)',
}

export const AccountingBasisLabel: Readonly<Record<string, string>> = {
  gaap: 'GAAP',
  non_gaap: 'Non-GAAP',
  unknown: 'Unknown',
}
