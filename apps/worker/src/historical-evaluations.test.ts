import assert from 'node:assert/strict'
import test from 'node:test'
import { historicalEvaluationExitSession } from './historical-evaluations.js'

const plannedSessions = {
  planned_day_1_session: '2026-10-01',
  planned_day_5_session: '2026-10-07',
  planned_day_20_session: '2026-10-28',
}

test('selects the frozen historical exit session for every supported horizon', () => {
  assert.equal(historicalEvaluationExitSession(plannedSessions, 1), '2026-10-01')
  assert.equal(historicalEvaluationExitSession(plannedSessions, 5), '2026-10-07')
  assert.equal(historicalEvaluationExitSession(plannedSessions, 20), '2026-10-28')
})
