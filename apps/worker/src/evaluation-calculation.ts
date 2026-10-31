import { EvaluationReturnPolicy } from './constants.js'

export interface EvaluationInstrumentPriceInput {
  adjustedEntryOpenPrice: string | number
  adjustedExitClosePrice: string | number
}

export interface InstrumentEvaluationReturn {
  entryPrice: number
  exitPrice: number
  returnFraction: number
}

export interface EvaluationReturnInput {
  stock: EvaluationInstrumentPriceInput
  marketBenchmark: EvaluationInstrumentPriceInput
  sectorBenchmark: EvaluationInstrumentPriceInput | null
}

export interface EvaluationReturnResult {
  stock: InstrumentEvaluationReturn
  marketBenchmark: InstrumentEvaluationReturn
  sectorBenchmark: InstrumentEvaluationReturn | null
  stockMinusMarketReturn: number
  stockMinusSectorReturn: number | null
}

function positivePrice(value: string | number, description: string): number {
  const price = Number(value)
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`${description} must be a positive finite number`)
  }
  return price
}

function roundedReturn(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Calculated return must be finite')
  return Number(value.toFixed(EvaluationReturnPolicy.decimalPlaces))
}

function calculateInstrumentReturn(
  input: EvaluationInstrumentPriceInput,
  description: string,
): InstrumentEvaluationReturn {
  const entryPrice = positivePrice(
    input.adjustedEntryOpenPrice,
    `${description} adjusted entry opening price`,
  )
  const exitPrice = positivePrice(
    input.adjustedExitClosePrice,
    `${description} adjusted exit closing price`,
  )
  return {
    entryPrice,
    exitPrice,
    returnFraction: roundedReturn((exitPrice / entryPrice) - 1),
  }
}

export function calculateEvaluationReturns(
  input: EvaluationReturnInput,
): EvaluationReturnResult {
  const stock = calculateInstrumentReturn(input.stock, 'Stock')
  const marketBenchmark = calculateInstrumentReturn(
    input.marketBenchmark,
    'Market benchmark',
  )
  const sectorBenchmark = input.sectorBenchmark
    ? calculateInstrumentReturn(input.sectorBenchmark, 'Sector benchmark')
    : null

  return {
    stock,
    marketBenchmark,
    sectorBenchmark,
    stockMinusMarketReturn: roundedReturn(
      stock.returnFraction - marketBenchmark.returnFraction,
    ),
    stockMinusSectorReturn: sectorBenchmark
      ? roundedReturn(stock.returnFraction - sectorBenchmark.returnFraction)
      : null,
  }
}
