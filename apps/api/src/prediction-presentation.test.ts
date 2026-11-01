import assert from 'node:assert/strict'
import test from 'node:test'
import { presentQualitativePrediction } from './prediction-presentation.js'

test('presents the reviewed qualitative output stored in a prediction snapshot', () => {
  const presentation = presentQualitativePrediction({
    qualitative: {
      effectiveExtraction: {
        effective: {
          output: {
            summary: 'Demand improved while spending remained a risk.',
            guidance: {
              status: 'provided',
              summary: 'Revenue guidance increased.',
              items: [{ direction: 'raised' }],
            },
            marginDirection: { direction: 'improving' },
            managementTone: { currentTone: 'positive' },
            keyRisks: [{ statement: 'Capital spending remains high.' }],
          },
        },
      },
    },
  })

  assert.deepEqual(presentation, {
    summary: 'Demand improved while spending remained a risk.',
    guidanceDirection: 'raised',
    guidanceSummary: 'Revenue guidance increased.',
    marginDirection: 'improving',
    managementTone: 'positive',
    mainRisk: 'Capital spending remains high.',
  })
})

test('returns explicit unavailable values for an older or malformed snapshot', () => {
  assert.deepEqual(presentQualitativePrediction(null), {
    summary: null,
    guidanceDirection: 'unavailable',
    guidanceSummary: null,
    marginDirection: 'unavailable',
    managementTone: 'unavailable',
    mainRisk: null,
  })
})
