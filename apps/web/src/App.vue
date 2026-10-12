<script setup lang="ts">
import { computed, ref } from 'vue'
import { ScoreFormat, UiText } from './constants'
import { demoEvents } from './demo-data'

const selectedId = ref(demoEvents[0]?.id ?? '')
const selectedEvent = computed(() => demoEvents.find((event) => event.id === selectedId.value) ?? demoEvents[0])

function scoreLabel(score: number): string {
  return score > 0 ? `${ScoreFormat.positivePrefix}${score}` : String(score)
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand"><span class="brand-mark">C</span><span>Chiron Research</span></div>
      <div class="system-state"><span class="state-dot"></span>Demo mode</div>
    </header>

    <aside class="sidebar">
      <p class="nav-heading">Workspace</p>
      <nav aria-label="Main navigation">
        <a class="active" href="#overview">Overview</a>
        <a href="#events">Earnings events</a>
        <a href="#companies">Companies</a>
        <a href="#review">Review queue</a>
        <a href="#results">Results</a>
        <a href="#method">Method</a>
      </nav>
      <p class="research-note">Research tool only.<br />No buy or sell recommendations.</p>
    </aside>

    <main id="overview" class="content">
      <div class="page-heading">
        <div>
          <p class="eyebrow">Public demonstration</p>
          <h1>Earnings research, with evidence</h1>
          <p class="subtitle">Understand what changed, why it received a score, and what happened afterward.</p>
        </div>
        <button type="button">Manage watchlist</button>
      </div>

      <div v-if="selectedEvent" class="overview-grid">
        <section class="panel feature-panel">
          <p class="eyebrow">Selected earnings event · Example data</p>
          <div class="company-row">
            <div class="company-identity">
              <span class="company-mark">{{ selectedEvent.ticker.slice(0, 2) }}</span>
              <div><h2>{{ selectedEvent.company }}</h2><p>{{ selectedEvent.ticker }} · {{ selectedEvent.period }}</p></div>
            </div>
            <div class="score"><strong>{{ scoreLabel(selectedEvent.score) }}</strong><span>research score</span></div>
          </div>
          <p class="summary">{{ selectedEvent.summary }}</p>
          <div class="signal-grid">
            <article><h3>Revenue</h3><p>Growth improved</p></article>
            <article><h3>Profit margin</h3><p>Improving</p></article>
            <article><h3>Future outlook</h3><p class="capitalize">{{ selectedEvent.guidance }}</p></article>
          </div>
          <p class="risk"><strong>Main risk:</strong> {{ selectedEvent.mainRisk }}</p>
        </section>

        <section class="panel process-panel">
          <h2>What happens next?</h2>
          <ol class="process-list">
            <li class="complete"><strong>Report saved</strong><span>Original SEC document stored</span></li>
            <li class="complete"><strong>Information extracted</strong><span>Numbers and management language</span></li>
            <li class="complete"><strong>Prediction frozen</strong><span>Cannot be edited afterward</span></li>
            <li><strong>Measure results</strong><span>After 1, 5 and 20 market days</span></li>
          </ol>
        </section>
      </div>

      <section id="events" class="panel events-panel">
        <div class="section-heading"><div><p class="eyebrow">Demonstration dataset</p><h2>Recent earnings reports</h2></div><span>Choose a row to inspect it</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Company</th><th>Score</th><th>Future outlook</th><th>20-day result vs market</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="event in demoEvents" :key="event.id" :class="{ selected: selectedId === event.id }" @click="selectedId = event.id">
                <td><button class="row-button" type="button" @click.stop="selectedId = event.id"><strong>{{ event.company }}</strong><span>{{ event.ticker }}</span></button></td>
                <td>{{ scoreLabel(event.score) }}</td>
                <td><span class="status-pill" :class="event.guidance">{{ event.guidance }}</span></td>
                <td>{{ event.marketComparison === null ? UiText.waitingForResult : `${event.marketComparison > 0 ? ScoreFormat.positivePrefix : ''}${event.marketComparison}%` }}</td>
                <td class="capitalize">{{ event.status }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
</template>
