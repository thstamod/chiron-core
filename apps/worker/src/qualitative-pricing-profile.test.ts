import assert from 'node:assert/strict'
import test from 'node:test'
import { parseQualitativePricingProfile } from './qualitative-pricing-profile.js'

const validProfile = {
  name: 'OpenAI standard pricing 2026-11-11',
  asOfDate: '2026-11-11',
  sourceUrl: 'https://developers.openai.com/api/docs/pricing',
  modelPricing: {
    'gpt-6-luna': {
      ordinaryInputUsdPerMillionTokens: 0.1,
      cachedInputUsdPerMillionTokens: 0.01,
      cacheWriteUsdPerMillionTokens: 0.125,
      outputUsdPerMillionTokens: 0.5,
    },
  },
}

test('accepts explicit dated model pricing', () => {
  assert.deepEqual(parseQualitativePricingProfile(validProfile), validProfile)
})

test('rejects missing models, invalid dates, and negative rates', () => {
  assert.throws(
    () => parseQualitativePricingProfile({ ...validProfile, modelPricing: {} }),
    /At least one model price is required/,
  )
  assert.throws(
    () => parseQualitativePricingProfile({ ...validProfile, asOfDate: 'today' }),
    /asOfDate/,
  )
  assert.throws(
    () => parseQualitativePricingProfile({
      ...validProfile,
      modelPricing: {
        'gpt-6-luna': {
          ...validProfile.modelPricing['gpt-6-luna'],
          outputUsdPerMillionTokens: -1,
        },
      },
    }),
    /outputUsdPerMillionTokens/,
  )
})
