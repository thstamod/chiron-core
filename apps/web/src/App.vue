<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  AccountingBasisLabel,
  FinancialMetricLabel,
  FinancialMetricUnit,
  RequiredEvaluationHorizons,
  ScoreFormat,
  SourceDocumentTypeLabel,
  UiText,
} from './constants'
import {
  loadEventDetails,
  loadResearchOverview,
  loadPredictionEvidence,
  type ResearchCompany,
  type ResearchEventDetails,
  type ResearchEarningsEvent,
  type ResearchPrediction,
  type ResearchPredictionEvidence,
} from './research-api'

const events = ref<ResearchEarningsEvent[]>([])
const unpredictedEvents = ref<ResearchEarningsEvent[]>([])
const watchlistCompanies = ref<ResearchCompany[]>([])
const selectedId = ref('')
const isLoading = ref(true)
const loadError = ref<string | null>(null)
const predictionEvidence = ref<ResearchPredictionEvidence | null>(null)
const isEvidenceLoading = ref(false)
const evidenceLoadError = ref<string | null>(null)
let evidenceRequestSequence = 0
const eventDetails = ref<ResearchEventDetails | null>(null)
const isEventDetailsLoading = ref(false)
const eventDetailsLoadError = ref<string | null>(null)
let eventDetailsRequestSequence = 0

const selectedEvent = computed(() => (
  events.value.find((event) => event.id === selectedId.value) ?? events.value[0] ?? null
))

const apiStateLabel = computed(() => {
  if (isLoading.value) return 'Loading research data'
  if (loadError.value) return 'Research API unavailable'
  return 'Connected to research database'
})

function scoreLabel(score: number): string {
  return score > 0 ? `${ScoreFormat.positivePrefix}${score}` : String(score)
}

function predictionScore(prediction: ResearchPrediction | null): string {
  return prediction ? scoreLabel(prediction.score) : '—'
}

function displayValue(value: string | null | undefined): string {
  return value?.replaceAll('_', ' ') ?? UiText.unavailable
}

function displayDate(value: string | null): string {
  if (!value) return 'Period pending'
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function displayTimestamp(value: string): string {
  const formattedTimestamp = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value))
  return `${formattedTimestamp} UTC`
}

function financialMetricLabel(metricCode: string): string {
  return FinancialMetricLabel[metricCode] ?? displayValue(metricCode)
}

function accountingBasisLabel(accountingBasis: string): string {
  return AccountingBasisLabel[accountingBasis] ?? displayValue(accountingBasis)
}

function sourceDocumentTypeLabel(documentType: string): string {
  return SourceDocumentTypeLabel[documentType] ?? displayValue(documentType)
}

function financialMetricValue(value: string, unit: string): string {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return `${value} ${unit}`
  if (unit === FinancialMetricUnit.unitedStatesDollar) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(numericValue)
  }
  if (unit === FinancialMetricUnit.unitedStatesDollarPerShare) {
    return `${new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 4,
    }).format(numericValue)} per share`
  }
  if (unit === FinancialMetricUnit.percent) return `${numericValue.toFixed(2)}%`
  if (unit === FinancialMetricUnit.percentagePoints) {
    return `${numericValue.toFixed(2)} percentage points`
  }
  return `${new Intl.NumberFormat('en-US').format(numericValue)} ${unit}`
}

function fileSize(value: number | null): string {
  if (value === null) return UiText.unavailable
  return new Intl.NumberFormat('en-US', {
    style: 'unit',
    unit: 'kilobyte',
    maximumFractionDigits: 1,
  }).format(value / 1_000)
}

function metricSourceUrl(sourceDocumentId: string): string | null {
  return eventDetails.value?.documents.find((document) => document.id === sourceDocumentId)
    ?.sourceUrl ?? null
}

function scoreComponentClass(points: number): string {
  if (points > 0) return 'positive'
  if (points < 0) return 'negative'
  return 'neutral'
}

function marketComparison(prediction: ResearchPrediction | null): string {
  const day20Evaluation = prediction?.evaluations.find((evaluation) => evaluation.horizonDays === 20)
  if (!day20Evaluation) return UiText.waitingForResult
  const percentage = day20Evaluation.stockMinusMarketReturn * 100
  return `${percentage > 0 ? ScoreFormat.positivePrefix : ''}${percentage.toFixed(2)}%`
}

function researchStatus(prediction: ResearchPrediction | null): string {
  if (!prediction) return 'Awaiting prediction'
  return prediction.evaluations.some((evaluation) => evaluation.horizonDays === 20)
    ? 'Evaluated'
    : 'Tracking'
}

function hasEveryEvaluationHorizon(prediction: ResearchPrediction | null): boolean {
  if (!prediction) return false
  const completedHorizons = new Set(
    prediction.evaluations.map((evaluation) => evaluation.horizonDays),
  )
  return RequiredEvaluationHorizons.every((horizon) => completedHorizons.has(horizon))
}

async function refreshEvents(): Promise<void> {
  isLoading.value = true
  loadError.value = null
  try {
    const overview = await loadResearchOverview()
    events.value = overview.predictionEvents
    unpredictedEvents.value = overview.unpredictedEvents
    watchlistCompanies.value = overview.watchlistCompanies
    if (!events.value.some((event) => event.id === selectedId.value)) {
      selectedId.value = events.value[0]?.id ?? ''
    }
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Could not load research data'
  } finally {
    isLoading.value = false
  }
}

async function refreshPredictionEvidence(predictionId: string | null): Promise<void> {
  const requestSequence = ++evidenceRequestSequence
  predictionEvidence.value = null
  evidenceLoadError.value = null
  if (!predictionId) {
    isEvidenceLoading.value = false
    return
  }

  isEvidenceLoading.value = true
  try {
    const loadedEvidence = await loadPredictionEvidence(predictionId)
    if (requestSequence === evidenceRequestSequence) predictionEvidence.value = loadedEvidence
  } catch (error) {
    if (requestSequence === evidenceRequestSequence) {
      evidenceLoadError.value = error instanceof Error
        ? error.message
        : 'Could not load prediction evidence'
    }
  } finally {
    if (requestSequence === evidenceRequestSequence) isEvidenceLoading.value = false
  }
}

async function refreshEventDetails(eventId: string | null): Promise<void> {
  const requestSequence = ++eventDetailsRequestSequence
  eventDetails.value = null
  eventDetailsLoadError.value = null
  if (!eventId) {
    isEventDetailsLoading.value = false
    return
  }

  isEventDetailsLoading.value = true
  try {
    const loadedDetails = await loadEventDetails(eventId)
    if (requestSequence === eventDetailsRequestSequence) eventDetails.value = loadedDetails
  } catch (error) {
    if (requestSequence === eventDetailsRequestSequence) {
      eventDetailsLoadError.value = error instanceof Error
        ? error.message
        : 'Could not load event research details'
    }
  } finally {
    if (requestSequence === eventDetailsRequestSequence) isEventDetailsLoading.value = false
  }
}

onMounted(refreshEvents)
watch(
  () => selectedEvent.value?.latestPrediction?.id ?? null,
  refreshPredictionEvidence,
)
watch(
  () => selectedEvent.value?.id ?? null,
  refreshEventDetails,
)
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">C</span><span>Chiron Project</span></div>
      <div class="system-state" :class="{ error: loadError }"><span class="state-dot"></span>{{ apiStateLabel }}</div>
    </header>

    <aside class="sidebar">
      <p class="nav-heading">Workspace</p>
      <nav aria-label="Main navigation">
        <a class="active" href="#overview">Overview</a>
        <a href="#events">Earnings events</a>
        <a href="#companies">Companies</a>
        <a href="#unpredicted">Unpredicted events</a>
        <a href="#results">Results</a>
        <a href="#method">Method</a>
      </nav>
      <p class="research-note">Research tool only.<br />No buy or sell recommendations.</p>
    </aside>

    <main id="overview" class="content">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Forward research record</p>
          <h1>Earnings research, with evidence</h1>
          <p class="subtitle">Understand what changed, why it received a score, and what happened afterward.</p>
        </div>
        <span class="watchlist-count">{{ watchlistCompanies.length }} tracked companies</span>
      </div>

      <section v-if="loadError" class="panel message-panel error-message" role="alert">
        <div><h2>Research data could not be loaded</h2><p>{{ loadError }}</p></div>
        <button type="button" @click="refreshEvents">Try again</button>
      </section>

      <section v-else-if="isLoading" class="panel message-panel" aria-live="polite">
        <div><h2>Loading earnings events</h2><p>The dashboard is requesting the latest stored research from the local API.</p></div>
      </section>

      <section v-else-if="events.length === 0" class="panel message-panel">
        <div><h2>No frozen predictions yet</h2><p>The watchlist and detected events awaiting prediction remain visible below.</p></div>
      </section>

      <template v-else-if="selectedEvent">
        <div class="overview-grid">
          <section class="panel feature-panel">
            <p class="eyebrow">Selected earnings event · Stored research data</p>
            <div class="company-row">
              <div class="company-identity">
                <span class="company-mark">{{ selectedEvent.ticker.slice(0, 2) }}</span>
                <div><h2>{{ selectedEvent.companyName }}</h2><p>{{ selectedEvent.ticker }} · {{ displayDate(selectedEvent.periodEnd) }}</p></div>
              </div>
              <div class="score"><strong>{{ predictionScore(selectedEvent.latestPrediction) }}</strong><span>research score</span></div>
            </div>
            <p class="summary">{{ selectedEvent.latestPrediction?.summary ?? UiText.noSummary }}</p>
            <div class="signal-grid">
              <article><h3>Future outlook</h3><p class="capitalize">{{ displayValue(selectedEvent.latestPrediction?.guidanceDirection) }}</p></article>
              <article><h3>Profit margin</h3><p class="capitalize">{{ displayValue(selectedEvent.latestPrediction?.marginDirection) }}</p></article>
              <article><h3>Management tone</h3><p class="capitalize">{{ displayValue(selectedEvent.latestPrediction?.managementTone) }}</p></article>
            </div>
            <p class="risk"><strong>Main risk:</strong> {{ selectedEvent.latestPrediction?.mainRisk ?? UiText.noMainRisk }}</p>
          </section>

          <section class="panel process-panel">
            <h2>Research progress</h2>
            <ol class="process-list">
              <li class="complete"><strong>Report saved</strong><span>Original SEC document stored</span></li>
              <li :class="{ complete: selectedEvent.latestPrediction }"><strong>Information reviewed</strong><span>Numbers and management language</span></li>
              <li :class="{ complete: selectedEvent.latestPrediction }"><strong>Prediction frozen</strong><span>Cannot be edited afterward</span></li>
              <li :class="{ complete: hasEveryEvaluationHorizon(selectedEvent.latestPrediction) }"><strong>Measure results</strong><span>After 1, 5 and 20 market days</span></li>
            </ol>
          </section>
        </div>

        <div v-if="selectedEvent.latestPrediction" class="prediction-details-grid">
          <section class="panel score-breakdown-panel">
            <div class="section-heading">
              <div><p class="eyebrow">Transparent scoring rule</p><h2>Why this score?</h2></div>
              <strong class="detail-score">{{ scoreLabel(selectedEvent.latestPrediction.score) }}</strong>
            </div>
            <div class="score-totals">
              <span>Financial {{ scoreLabel(selectedEvent.latestPrediction.financialScore) }}</span>
              <span>Qualitative {{ scoreLabel(selectedEvent.latestPrediction.qualitativeScore) }}</span>
              <span>Before limit {{ scoreLabel(selectedEvent.latestPrediction.uncappedCombinedScore) }}</span>
            </div>
            <ol class="score-component-list">
              <li v-for="component in selectedEvent.latestPrediction.scoreComponents" :key="component.code">
                <div class="component-heading">
                  <div><strong class="capitalize">{{ displayValue(component.code) }}</strong><span class="capitalize">{{ component.category }}</span></div>
                  <span class="component-points" :class="scoreComponentClass(component.points)">{{ scoreLabel(component.points) }}</span>
                </div>
                <p>{{ component.explanation }}</p>
              </li>
            </ol>
          </section>

          <section class="panel prediction-timeline-panel">
            <p class="eyebrow">Immutable forward record</p>
            <h2>Frozen timeline</h2>
            <dl class="prediction-timeline">
              <div><dt>Prediction cutoff</dt><dd>{{ displayTimestamp(selectedEvent.latestPrediction.cutoffAt) }}</dd></div>
              <div><dt>Recorded by database</dt><dd>{{ displayTimestamp(selectedEvent.latestPrediction.recordedAt) }}</dd></div>
              <div><dt>Reference entry · session open</dt><dd>{{ displayDate(selectedEvent.latestPrediction.plannedEntrySession) }}</dd></div>
              <div><dt>Day 1 outcome · session close</dt><dd>{{ displayDate(selectedEvent.latestPrediction.plannedDay1Session) }}</dd></div>
              <div><dt>Day 5 outcome</dt><dd>{{ displayDate(selectedEvent.latestPrediction.plannedDay5Session) }}</dd></div>
              <div><dt>Day 20 outcome</dt><dd>{{ displayDate(selectedEvent.latestPrediction.plannedDay20Session) }}</dd></div>
            </dl>
            <p class="rule-version"><strong>Rule version</strong><span>{{ selectedEvent.latestPrediction.ruleVersion }}</span></p>
            <p class="immutable-note">These timestamps and planned market sessions cannot be changed after prediction creation.</p>
          </section>
        </div>

        <section v-if="selectedEvent.latestPrediction" class="panel evidence-panel">
          <div class="section-heading">
            <div><p class="eyebrow">Validated qualitative extraction</p><h2>Supporting SEC evidence</h2></div>
            <span v-if="predictionEvidence">{{ predictionEvidence.evidence.length }} exact references</span>
          </div>

          <div v-if="isEvidenceLoading" class="evidence-message" aria-live="polite">
            Loading frozen evidence…
          </div>
          <div v-else-if="evidenceLoadError" class="evidence-message evidence-error" role="alert">
            <span>{{ evidenceLoadError }}</span>
            <button type="button" @click="refreshPredictionEvidence(selectedEvent.latestPrediction.id)">Try again</button>
          </div>
          <div v-else-if="predictionEvidence" class="evidence-list">
            <article v-for="item in predictionEvidence.evidence" :key="item.fieldPath" class="evidence-item">
              <div class="evidence-labels">
                <span class="status-pill capitalize">{{ displayValue(item.category) }}</span>
                <span class="source-role capitalize">{{ item.source.role }} release</span>
              </div>
              <h3>{{ item.claim }}</h3>
              <blockquote>{{ item.quote }}</blockquote>
              <footer>
                <span>{{ item.passageId }} · {{ displayValue(item.source.documentType) }}</span>
                <span>Published {{ displayTimestamp(item.source.publishedAt) }}</span>
                <a :href="item.source.sourceUrl" target="_blank" rel="noopener noreferrer">Open official SEC source</a>
              </footer>
            </article>
          </div>
          <div v-else class="evidence-message">No validated qualitative evidence is available.</div>
        </section>

        <section class="panel financial-details-panel">
          <div class="section-heading">
            <div><p class="eyebrow">Deterministic SEC/XBRL data</p><h2>Reported and calculated financial values</h2></div>
            <span v-if="eventDetails">{{ eventDetails.reportedMetrics.length + eventDetails.derivedMetrics.length }} values</span>
          </div>
          <div v-if="isEventDetailsLoading" class="event-details-message" aria-live="polite">
            Loading financial details…
          </div>
          <div v-else-if="eventDetailsLoadError" class="event-details-message evidence-error" role="alert">
            <span>{{ eventDetailsLoadError }}</span>
            <button type="button" @click="refreshEventDetails(selectedEvent.id)">Try again</button>
          </div>
          <template v-else-if="eventDetails">
            <div v-if="eventDetails.derivedMetrics.length" class="derived-metric-grid">
              <article v-for="metric in eventDetails.derivedMetrics" :key="metric.id">
                <h3>{{ financialMetricLabel(metric.metricCode) }}</h3>
                <strong>{{ financialMetricValue(metric.value, metric.unit) }}</strong>
                <span>{{ metric.calculationVersion }}</span>
              </article>
            </div>
            <div v-if="eventDetails.reportedMetrics.length" class="table-wrap">
              <table>
                <thead><tr><th>Reported value</th><th>Value</th><th>Period</th><th>Basis</th><th>Parser version</th><th>Source</th></tr></thead>
                <tbody>
                  <tr v-for="metric in eventDetails.reportedMetrics" :key="metric.id">
                    <td><strong>{{ financialMetricLabel(metric.metricCode) }}</strong><span class="secondary-table-value">{{ metric.xbrlConcept }}</span></td>
                    <td>{{ financialMetricValue(metric.value, metric.unit) }}</td>
                    <td>{{ displayDate(metric.periodEnd) }}</td>
                    <td>{{ accountingBasisLabel(metric.accountingBasis) }}</td>
                    <td><code>{{ metric.extractionVersion }}</code></td>
                    <td><a v-if="metricSourceUrl(metric.sourceDocumentId)" :href="metricSourceUrl(metric.sourceDocumentId) ?? undefined" target="_blank" rel="noopener noreferrer">Open SEC source</a><span v-else>{{ UiText.unavailable }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="!eventDetails.reportedMetrics.length && !eventDetails.derivedMetrics.length" class="empty-data-message">
              No deterministic financial values are stored for this event.
            </div>
          </template>
        </section>

        <section class="panel source-documents-panel">
          <div class="section-heading">
            <div><p class="eyebrow">Original archived evidence</p><h2>SEC source documents</h2></div>
            <span v-if="eventDetails">{{ eventDetails.documents.length }} documents</span>
          </div>
          <div v-if="isEventDetailsLoading" class="event-details-message" aria-live="polite">
            Loading source documents…
          </div>
          <div v-else-if="eventDetailsLoadError" class="event-details-message evidence-error">
            Source documents are unavailable because the event-detail request failed.
          </div>
          <div v-else-if="eventDetails?.documents.length" class="table-wrap">
            <table>
              <thead><tr><th>Document type</th><th>Published</th><th>First collected</th><th>Archived size</th><th>Fingerprint</th><th>Official source</th></tr></thead>
              <tbody>
                <tr v-for="document in eventDetails.documents" :key="document.id">
                  <td>{{ sourceDocumentTypeLabel(document.documentType) }}</td>
                  <td>{{ displayTimestamp(document.publishedAt) }}</td>
                  <td>{{ displayTimestamp(document.firstSeenAt) }}</td>
                  <td>{{ fileSize(document.contentSizeBytes) }}</td>
                  <td><code class="fingerprint">{{ document.contentSha256 }}</code></td>
                  <td><a :href="document.sourceUrl" target="_blank" rel="noopener noreferrer">Open SEC document</a></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else-if="eventDetails" class="empty-data-message">
            No source documents are linked to this event.
          </div>
        </section>

        <section id="events" class="panel events-panel">
          <div class="section-heading"><div><p class="eyebrow">Frozen forward record</p><h2>Prediction events</h2></div><span>Choose a row to inspect it</span></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Score</th><th>Future outlook</th><th>20-day result vs market</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="event in events" :key="event.id" :class="{ selected: selectedId === event.id }" @click="selectedId = event.id">
                  <td><button class="row-button" type="button" @click.stop="selectedId = event.id"><strong>{{ event.companyName }}</strong><span>{{ event.ticker }} · {{ displayDate(event.periodEnd) }}</span></button></td>
                  <td>{{ predictionScore(event.latestPrediction) }}</td>
                  <td><span class="status-pill" :class="event.latestPrediction?.guidanceDirection">{{ displayValue(event.latestPrediction?.guidanceDirection) }}</span></td>
                  <td>{{ marketComparison(event.latestPrediction) }}</td>
                  <td>{{ researchStatus(event.latestPrediction) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <template v-if="!isLoading && !loadError">
        <section id="unpredicted" class="panel data-panel awaiting-events-panel">
          <div class="section-heading">
            <div><p class="eyebrow">Stored event visibility</p><h2>Events without predictions</h2></div>
            <span>{{ unpredictedEvents.length }} recent events</span>
          </div>
          <div v-if="unpredictedEvents.length === 0" class="empty-data-message">
            No detected events are currently waiting for a prediction.
          </div>
          <div v-else class="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Period</th><th>Detected</th><th>Event status</th><th>Research state</th></tr></thead>
              <tbody>
                <tr v-for="event in unpredictedEvents" :key="event.id">
                  <td><strong>{{ event.companyName }}</strong><span class="secondary-table-value">{{ event.ticker }}</span></td>
                  <td>{{ displayDate(event.periodEnd) }}</td>
                  <td>{{ displayTimestamp(event.detectedAt) }}</td>
                  <td class="capitalize">{{ displayValue(event.status) }}</td>
                  <td><span class="status-pill pending">No frozen prediction</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="companies" class="panel data-panel companies-panel">
          <div class="section-heading">
            <div><p class="eyebrow">Configured research universe</p><h2>Company watchlist</h2></div>
            <span>{{ watchlistCompanies.length }} companies</span>
          </div>
          <div v-if="watchlistCompanies.length === 0" class="empty-data-message">
            No companies are configured in the database.
          </div>
          <div v-else class="table-wrap">
            <table>
              <thead><tr><th>Ticker</th><th>Company</th><th>Sector</th><th>Exchange</th><th>Monitoring</th></tr></thead>
              <tbody>
                <tr v-for="company in watchlistCompanies" :key="company.id">
                  <td><strong>{{ company.ticker }}</strong></td>
                  <td>{{ company.legalName }}</td>
                  <td>{{ company.sector ?? UiText.unavailable }}</td>
                  <td>{{ company.exchange ?? UiText.unavailable }}</td>
                  <td><span class="status-pill" :class="{ inactive: !company.isActive }">{{ company.isActive ? 'Active' : 'Inactive' }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>
