import { load, type CheerioAPI } from 'cheerio'
import {
  AccountingBasis,
  FinancialUnit,
  FinancialMetricCode,
  RuleVersion,
  SecForm,
  XbrlConcept,
  XbrlFiscalPeriod,
  XbrlSelector,
} from './constants.js'

type FinancialMetricCodeValue = typeof FinancialMetricCode[keyof typeof FinancialMetricCode]

interface XbrlContext {
  id: string
  startDate: string | null
  endDate: string | null
  dimensionCount: number
}

interface XbrlFact {
  concept: string
  context: XbrlContext
  contextId: string
  unitReference: string
  unit: string
  sourceText: string
  valueNumeric: string
  scale: number
  decimals: string | null
  format: string | null
  sign: string | null
  sourceIndex: number
  factId: string | null
  isHidden: boolean
}

interface MetricDefinition {
  metricCode: FinancialMetricCodeValue
  concepts: readonly string[]
}

export interface ExtractedFinancialMetric {
  metricCode: FinancialMetricCodeValue
  valueNumeric: string
  unit: string
  accountingBasis: typeof AccountingBasis.gaap
  periodStart: string
  periodEnd: string
  xbrlConcept: string
  xbrlContextId: string
  sourceLocation: string
  sourceText: string
  sourceMetadata: {
    unitReference: string
    scale: number
    decimals: string | null
    format: string | null
    sign: string | null
    dimensionCount: number
    sourceIndex: number
    factId: string | null
    isHidden: boolean
  }
}

export interface FinancialMetricExtractionResult {
  extractionVersion: string
  fiscalYear: number | null
  fiscalPeriod: string | null
  periodStart: string | null
  periodEnd: string
  metrics: ExtractedFinancialMetric[]
  warnings: string[]
}

const metricDefinitions: readonly MetricDefinition[] = [
  {
    metricCode: FinancialMetricCode.revenue,
    concepts: [
      XbrlConcept.revenueFromCustomerContracts,
      XbrlConcept.revenues,
      XbrlConcept.salesRevenueNet,
    ],
  },
  {
    metricCode: FinancialMetricCode.netIncome,
    concepts: [XbrlConcept.netIncomeLoss, XbrlConcept.profitLoss],
  },
  {
    metricCode: FinancialMetricCode.earningsPerShareBasic,
    concepts: [XbrlConcept.earningsPerShareBasic],
  },
  {
    metricCode: FinancialMetricCode.earningsPerShareDiluted,
    concepts: [XbrlConcept.earningsPerShareDiluted],
  },
]

const supportedFiscalPeriods = new Set<string>(Object.values(XbrlFiscalPeriod))
const annualForms = new Set<string>([SecForm.annualReport, SecForm.annualReportAmendment])
const supportedConcepts = new Set(metricDefinitions.flatMap(({ concepts }) => concepts))

export const financialMetricExtractionVersion = RuleVersion.financialMetricExtraction

function normalizedInlineText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function inlineFactText($: CheerioAPI, element: Parameters<CheerioAPI>[0]): string {
  const copy = $(element).clone()
  copy.find(XbrlSelector.excludedContent).remove()
  return normalizedInlineText(copy.text())
}

function shiftDecimalPoint(value: string, scale: number): string {
  const [integerPart = '0', fractionalPart = ''] = value.split('.')
  const digits = `${integerPart}${fractionalPart}`
  const decimalPosition = integerPart.length + scale

  let scaledValue: string
  if (decimalPosition <= 0) {
    scaledValue = `0.${'0'.repeat(-decimalPosition)}${digits}`
  } else if (decimalPosition >= digits.length) {
    scaledValue = `${digits}${'0'.repeat(decimalPosition - digits.length)}`
  } else {
    scaledValue = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`
  }

  const [scaledInteger = '0', scaledFraction = ''] = scaledValue.split('.')
  const normalizedInteger = scaledInteger.replace(/^0+(?=\d)/, '') || '0'
  const normalizedFraction = scaledFraction.replace(/0+$/, '')
  return normalizedFraction.length > 0
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger
}

export function normalizeXbrlNumericValue(
  sourceText: string,
  scaleValue: string | undefined,
  sign: string | undefined,
  format: string | undefined,
): string {
  const scale = scaleValue === undefined ? 0 : Number.parseInt(scaleValue, 10)
  if (!Number.isInteger(scale) || Math.abs(scale) > 30) {
    throw new Error(`Unsupported XBRL scale: ${scaleValue}`)
  }

  const normalizedFormat = format?.toLowerCase() ?? ''
  let displayedValue = normalizedInlineText(sourceText)
  if (/^[\-—–]$/.test(displayedValue) && normalizedFormat.includes('zero')) return '0'

  const hasParenthesizedNegative = displayedValue.startsWith('(') && displayedValue.endsWith(')')
  displayedValue = displayedValue.replace(/[()$£€¥\s]/g, '')

  if (normalizedFormat.includes('commadecimal') || normalizedFormat.includes('comma-decimal')) {
    displayedValue = displayedValue.replace(/\./g, '').replace(',', '.')
  } else {
    displayedValue = displayedValue.replace(/,/g, '')
  }

  const hasTextNegative = displayedValue.startsWith('-')
  displayedValue = displayedValue.replace(/^[+-]/, '')
  if (!/^\d+(?:\.\d+)?$/.test(displayedValue)) {
    throw new Error(`Unsupported XBRL numeric value: ${sourceText}`)
  }

  const scaledValue = shiftDecimalPoint(displayedValue, scale)
  const isNegative = sign === '-' || hasParenthesizedNegative || hasTextNegative
  return isNegative && scaledValue !== '0' ? `-${scaledValue}` : scaledValue
}

function normalizeUnitMeasure(measure: string): string {
  const localName = measure.split(':').at(-1)?.toLowerCase()
  if (
    localName === 'usd'
    || localName === 'unitedstatesofamericadollars'
  ) return FinancialUnit.unitedStatesDollar
  if (localName === 'shares' || localName === 'share') return FinancialUnit.share
  return measure
}

function parseUnits($: CheerioAPI): Map<string, string> {
  const units = new Map<string, string>()

  $(XbrlSelector.unit).each((_index, element) => {
    const unit = $(element)
    const id = unit.attr('id')
    if (!id) return

    const numerator = unit
      .find(XbrlSelector.unitNumerator)
      .find(XbrlSelector.measure)
      .first()
      .text()
      .trim()
    const denominator = unit
      .find(XbrlSelector.unitDenominator)
      .find(XbrlSelector.measure)
      .first()
      .text()
      .trim()

    if (numerator && denominator) {
      const normalizedNumerator = normalizeUnitMeasure(numerator)
      const normalizedDenominator = normalizeUnitMeasure(denominator)
      const normalizedUnit = normalizedNumerator === FinancialUnit.unitedStatesDollar
        && normalizedDenominator === FinancialUnit.share
        ? FinancialUnit.unitedStatesDollarPerShare
        : `${normalizedNumerator}/${normalizedDenominator}`
      units.set(id, normalizedUnit)
      return
    }

    const measure = unit.children(XbrlSelector.measure).first().text().trim()
    if (measure) units.set(id, normalizeUnitMeasure(measure))
  })

  return units
}

function parseContexts($: CheerioAPI): Map<string, XbrlContext> {
  const contexts = new Map<string, XbrlContext>()

  $(XbrlSelector.context).each((_index, element) => {
    const context = $(element)
    const id = context.attr('id')
    if (!id) return

    contexts.set(id, {
      id,
      startDate: context.find(XbrlSelector.startDate).first().text().trim() || null,
      endDate: context.find(XbrlSelector.endDate).first().text().trim() || null,
      dimensionCount: context.find(
        `${XbrlSelector.explicitMember}, ${XbrlSelector.typedMember}`,
      ).length,
    })
  })

  return contexts
}

function parseDocumentFact($: CheerioAPI, concept: string): string | null {
  let result: string | null = null

  $(XbrlSelector.nonNumericFact).each((_index, element) => {
    if (result !== null) return
    const fact = $(element)
    if (fact.attr('name') === concept) result = inlineFactText($, element)
  })

  return result
}

function parseFacts(
  $: CheerioAPI,
  contexts: Map<string, XbrlContext>,
  units: Map<string, string>,
): XbrlFact[] {
  const facts: XbrlFact[] = []

  $(XbrlSelector.numericFact).each((sourceIndex, element) => {
    const fact = $(element)
    const concept = fact.attr('name')
    const contextId = fact.attr('contextref')
    const unitReference = fact.attr('unitref')
    if (
      !concept
      || !supportedConcepts.has(concept)
      || !contextId
      || !unitReference
      || fact.attr('nil') === 'true'
      || fact.attr('xsi:nil') === 'true'
    ) return

    const context = contexts.get(contextId)
    const unit = units.get(unitReference)
    if (!context || !unit) return

    const sourceText = inlineFactText($, element)
    const scaleValue = fact.attr('scale')
    const sign = fact.attr('sign')
    const format = fact.attr('format')
    facts.push({
      concept,
      context,
      contextId,
      unitReference,
      unit,
      sourceText,
      valueNumeric: normalizeXbrlNumericValue(sourceText, scaleValue, sign, format),
      scale: scaleValue === undefined ? 0 : Number.parseInt(scaleValue, 10),
      decimals: fact.attr('decimals') ?? null,
      format: format ?? null,
      sign: sign ?? null,
      sourceIndex,
      factId: fact.attr('id') ?? null,
      isHidden: fact.parents(XbrlSelector.hiddenFactContainer).length > 0,
    })
  })

  return facts
}

function selectPeriodStart(
  facts: XbrlFact[],
  reportDate: string,
  formType: string,
): string | null {
  const starts = [...new Set(
    facts
      .filter(({ context }) => (
        context.dimensionCount === 0
        && context.endDate === reportDate
        && context.startDate !== null
      ))
      .map(({ context }) => context.startDate!),
  )].sort()

  if (starts.length === 0) return null
  return annualForms.has(formType) ? starts[0]! : starts.at(-1)!
}

function selectMetricFact(
  definition: MetricDefinition,
  facts: XbrlFact[],
  periodStart: string,
  periodEnd: string,
): XbrlFact | null {
  for (const concept of definition.concepts) {
    const candidates = facts
      .filter((fact) => (
        fact.concept === concept
        && fact.context.dimensionCount === 0
        && fact.context.startDate === periodStart
        && fact.context.endDate === periodEnd
      ))
      .sort((left, right) => (
        Number(left.isHidden) - Number(right.isHidden)
        || left.sourceIndex - right.sourceIndex
      ))

    if (candidates.length === 0) continue
    const distinctValues = new Set(candidates.map(({ valueNumeric, unit }) => `${valueNumeric}:${unit}`))
    if (distinctValues.size > 1) {
      throw new Error(
        `Conflicting ${definition.metricCode} facts for ${concept} and context period ${periodStart} to ${periodEnd}`,
      )
    }
    return candidates[0]!
  }

  return null
}

function extractedMetric(
  definition: MetricDefinition,
  fact: XbrlFact,
): ExtractedFinancialMetric {
  return {
    metricCode: definition.metricCode,
    valueNumeric: fact.valueNumeric,
    unit: fact.unit,
    accountingBasis: AccountingBasis.gaap,
    periodStart: fact.context.startDate!,
    periodEnd: fact.context.endDate!,
    xbrlConcept: fact.concept,
    xbrlContextId: fact.contextId,
    sourceLocation: `ix:nonfraction[name="${fact.concept}"][contextref="${fact.contextId}"]`,
    sourceText: fact.sourceText,
    sourceMetadata: {
      unitReference: fact.unitReference,
      scale: fact.scale,
      decimals: fact.decimals,
      format: fact.format,
      sign: fact.sign,
      dimensionCount: fact.context.dimensionCount,
      sourceIndex: fact.sourceIndex,
      factId: fact.factId,
      isHidden: fact.isHidden,
    },
  }
}

export function extractFinancialMetricsFromInlineXbrl(
  html: string,
  formType: string,
  reportDate: string,
): FinancialMetricExtractionResult {
  const $ = load(html)
  const contexts = parseContexts($)
  const units = parseUnits($)
  const facts = parseFacts($, contexts, units)
  const warnings: string[] = []
  const periodStart = selectPeriodStart(facts, reportDate, formType)

  const fiscalYearText = parseDocumentFact($, XbrlConcept.documentFiscalYear)
  const fiscalYear = fiscalYearText && /^\d{4}$/.test(fiscalYearText)
    ? Number.parseInt(fiscalYearText, 10)
    : null
  if (fiscalYear === null) warnings.push('Missing or invalid document fiscal year')

  const fiscalPeriodText = parseDocumentFact($, XbrlConcept.documentFiscalPeriod)
  const fiscalPeriod = fiscalPeriodText && supportedFiscalPeriods.has(fiscalPeriodText)
    ? fiscalPeriodText
    : null
  if (fiscalPeriod === null) warnings.push('Missing or unsupported document fiscal period')
  if (periodStart === null) warnings.push('Could not identify the current reporting period')

  const metrics: ExtractedFinancialMetric[] = []
  if (periodStart !== null) {
    for (const definition of metricDefinitions) {
      const fact = selectMetricFact(definition, facts, periodStart, reportDate)
      if (fact) {
        metrics.push(extractedMetric(definition, fact))
      } else {
        warnings.push(`Missing ${definition.metricCode} for the current reporting period`)
      }
    }
  }

  return {
    extractionVersion: financialMetricExtractionVersion,
    fiscalYear,
    fiscalPeriod,
    periodStart,
    periodEnd: reportDate,
    metrics,
    warnings,
  }
}
