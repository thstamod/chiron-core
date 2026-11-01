import {
  BenchmarkRole,
  PriceDataProvider,
  PriceInstrumentType,
  type BenchmarkRoleValue,
  type PriceInstrumentTypeValue,
} from './constants.js'

export interface WatchlistCompany {
  id: string
  cik: string
  legalName: string
  ticker: string
  exchange: string | null
  sector: string | null
}

export interface WatchlistPriceInstrument {
  id: string
  companyId: string | null
  symbol: string
  instrumentType: PriceInstrumentTypeValue
  providerName: string
  providerSymbol: string
  currency: string
  isActive: boolean
}

export interface WatchlistBenchmarkAssignment {
  id: string
  companyId: string
  benchmarkInstrumentId: string
  benchmarkRole: BenchmarkRoleValue
  mappingVersion: string
  applicableFrom: string
  rationale: string
  createdAt: string
}

export interface WatchlistValidationInput {
  companies: WatchlistCompany[]
  priceInstruments: WatchlistPriceInstrument[]
  benchmarkAssignments: WatchlistBenchmarkAssignment[]
}

export interface CompanyWatchlistValidation {
  ticker: string
  stockProviderSymbol: string | null
  marketBenchmarkSymbol: string | null
  sectorBenchmarkSymbol: string | null
  errors: string[]
}

export interface WatchlistValidationReport {
  validationDate: string
  passed: boolean
  companyCount: number
  stockInstrumentCount: number
  marketAssignmentCount: number
  sectorAssignmentCount: number
  configurationErrors: string[]
  companies: CompanyWatchlistValidation[]
}

const cikPattern = /^\d{10}$/
const tickerPattern = /^[A-Z][A-Z0-9.-]{0,19}$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function validateCalendarDate(value: string, description: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (
    !datePattern.test(value)
    || Number.isNaN(parsed.valueOf())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${description} must be a valid YYYY-MM-DD date`)
  }
}

function latestApplicableAssignment(
  assignments: WatchlistBenchmarkAssignment[],
  companyId: string,
  benchmarkRole: BenchmarkRoleValue,
  validationDate: string,
): WatchlistBenchmarkAssignment | null {
  return assignments
    .filter((assignment) => (
      assignment.companyId === companyId
      && assignment.benchmarkRole === benchmarkRole
      && assignment.applicableFrom <= validationDate
    ))
    .sort((left, right) => (
      right.applicableFrom.localeCompare(left.applicableFrom)
      || right.createdAt.localeCompare(left.createdAt)
      || right.id.localeCompare(left.id)
    ))[0] ?? null
}

function validateInstrument(
  instrument: WatchlistPriceInstrument,
  expectedType: PriceInstrumentTypeValue,
  description: string,
  errors: string[],
): void {
  if (instrument.instrumentType !== expectedType) {
    errors.push(`${description} has instrument type ${instrument.instrumentType}, expected ${expectedType}`)
  }
  if (!instrument.isActive) errors.push(`${description} is inactive`)
  if (instrument.providerName !== PriceDataProvider.tiingo) {
    errors.push(`${description} uses unsupported provider ${instrument.providerName}`)
  }
  if (!instrument.providerSymbol.trim()) errors.push(`${description} has no provider symbol`)
  if (instrument.currency !== 'USD') errors.push(`${description} uses unsupported currency ${instrument.currency}`)
}

function validateBenchmark(
  company: WatchlistCompany,
  benchmarkRole: BenchmarkRoleValue,
  validationDate: string,
  assignments: WatchlistBenchmarkAssignment[],
  instrumentsById: ReadonlyMap<string, WatchlistPriceInstrument>,
  errors: string[],
): WatchlistPriceInstrument | null {
  const assignment = latestApplicableAssignment(
    assignments,
    company.id,
    benchmarkRole,
    validationDate,
  )
  if (!assignment) {
    errors.push(`Missing applicable ${benchmarkRole} benchmark assignment`)
    return null
  }
  if (!assignment.mappingVersion.trim()) {
    errors.push(`${benchmarkRole} benchmark assignment has no mapping version`)
  }
  if (!assignment.rationale.trim()) {
    errors.push(`${benchmarkRole} benchmark assignment has no rationale`)
  }
  const benchmark = instrumentsById.get(assignment.benchmarkInstrumentId)
  if (!benchmark) {
    errors.push(`${benchmarkRole} benchmark assignment references a missing instrument`)
    return null
  }
  if (benchmark.companyId !== null) {
    errors.push(`${benchmarkRole} benchmark instrument must not belong to a company`)
  }
  validateInstrument(
    benchmark,
    benchmarkRole === BenchmarkRole.market
      ? PriceInstrumentType.marketBenchmark
      : PriceInstrumentType.sectorBenchmark,
    `${benchmarkRole} benchmark ${benchmark.symbol}`,
    errors,
  )
  return benchmark
}

export function validateWatchlist(
  input: WatchlistValidationInput,
  validationDate: string,
): WatchlistValidationReport {
  validateCalendarDate(validationDate, 'Watchlist validation date')
  const configurationErrors: string[] = []
  if (input.companies.length === 0) configurationErrors.push('No active companies are configured')

  const tickerCounts = new Map<string, number>()
  for (const company of input.companies) {
    const normalizedTicker = company.ticker.trim().toUpperCase()
    tickerCounts.set(normalizedTicker, (tickerCounts.get(normalizedTicker) ?? 0) + 1)
  }
  for (const [ticker, count] of tickerCounts) {
    if (count > 1) configurationErrors.push(`Active ticker ${ticker} is used by ${count} companies`)
  }

  const activeCompanyIds = new Set(input.companies.map((company) => company.id))
  for (const instrument of input.priceInstruments) {
    if (
      instrument.isActive
      && instrument.instrumentType === PriceInstrumentType.companyStock
      && (!instrument.companyId || !activeCompanyIds.has(instrument.companyId))
    ) {
      configurationErrors.push(
        `Active stock instrument ${instrument.symbol} does not belong to an active company`,
      )
    }
  }

  const instrumentsById = new Map(input.priceInstruments.map((instrument) => [instrument.id, instrument]))
  const companies = [...input.companies]
    .sort((left, right) => left.ticker.localeCompare(right.ticker))
    .map((company): CompanyWatchlistValidation => {
      const errors: string[] = []
      if (!cikPattern.test(company.cik)) errors.push('CIK must contain exactly 10 digits')
      if (!tickerPattern.test(company.ticker)) errors.push('Ticker has an invalid format')
      if (!company.legalName.trim()) errors.push('Legal name is missing')
      if (!company.exchange?.trim()) errors.push('Exchange is missing')
      if (!company.sector?.trim()) errors.push('Sector is missing')

      const activeStockInstruments = input.priceInstruments.filter((instrument) => (
        instrument.companyId === company.id
        && instrument.instrumentType === PriceInstrumentType.companyStock
        && instrument.isActive
      ))
      if (activeStockInstruments.length !== 1) {
        errors.push(`Expected exactly one active stock instrument, found ${activeStockInstruments.length}`)
      }
      const stockInstrument = activeStockInstruments[0] ?? null
      if (stockInstrument) {
        validateInstrument(
          stockInstrument,
          PriceInstrumentType.companyStock,
          `Stock instrument ${stockInstrument.symbol}`,
          errors,
        )
      }

      const marketBenchmark = validateBenchmark(
        company,
        BenchmarkRole.market,
        validationDate,
        input.benchmarkAssignments,
        instrumentsById,
        errors,
      )
      const sectorBenchmark = validateBenchmark(
        company,
        BenchmarkRole.sector,
        validationDate,
        input.benchmarkAssignments,
        instrumentsById,
        errors,
      )

      return {
        ticker: company.ticker,
        stockProviderSymbol: stockInstrument?.providerSymbol ?? null,
        marketBenchmarkSymbol: marketBenchmark?.symbol ?? null,
        sectorBenchmarkSymbol: sectorBenchmark?.symbol ?? null,
        errors,
      }
    })

  const companyErrors = companies.reduce((total, company) => total + company.errors.length, 0)
  return {
    validationDate,
    passed: configurationErrors.length === 0 && companyErrors === 0,
    companyCount: companies.length,
    stockInstrumentCount: companies.filter((company) => company.stockProviderSymbol).length,
    marketAssignmentCount: companies.filter((company) => company.marketBenchmarkSymbol).length,
    sectorAssignmentCount: companies.filter((company) => company.sectorBenchmarkSymbol).length,
    configurationErrors,
    companies,
  }
}

function validationSymbol(passed: boolean): string {
  return passed ? '✓' : '✗'
}

export function formatWatchlistValidationReport(report: WatchlistValidationReport): string {
  const lines = [
    `Watchlist validation ${report.passed ? 'passed' : 'failed'}`,
    '',
    `Validation date: ${report.validationDate}`,
    `Companies: ${report.companyCount}`,
    `Stock instruments: ${report.stockInstrumentCount}`,
    `Market assignments: ${report.marketAssignmentCount}`,
    `Sector assignments: ${report.sectorAssignmentCount}`,
  ]

  if (report.configurationErrors.length > 0) {
    lines.push('', 'Configuration errors:')
    for (const error of report.configurationErrors) lines.push(`- ${error}`)
  }

  lines.push('')
  for (const company of report.companies) {
    lines.push(
      `${company.ticker} ${validationSymbol(company.errors.length === 0)}`
      + `  Stock ${company.stockProviderSymbol ?? 'missing'}`
      + `  Market ${company.marketBenchmarkSymbol ?? 'missing'}`
      + `  Sector ${company.sectorBenchmarkSymbol ?? 'missing'}`,
    )
    for (const error of company.errors) lines.push(`  - ${error}`)
  }

  return lines.join('\n')
}
