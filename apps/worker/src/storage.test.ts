import assert from 'node:assert/strict'
import test from 'node:test'
import { persistImmutableStorageObject } from './storage.js'

test('accepts an identical object created by another worker during upload', async () => {
  const completedSteps: string[] = []

  await persistImmutableStorageObject({
    storageObjectExists: async () => {
      completedSteps.push('check storage object')
      return false
    },
    uploadNewStorageObject: async () => {
      completedSteps.push('upload storage object')
      throw new Error('object already exists')
    },
    verifyExistingStorageObject: async () => {
      completedSteps.push('verify storage object')
    },
  })

  assert.deepEqual(completedSteps, [
    'check storage object',
    'upload storage object',
    'verify storage object',
  ])
})

test('rejects an upload failure when no identical object can be verified', async () => {
  await assert.rejects(
    persistImmutableStorageObject({
      storageObjectExists: async () => false,
      uploadNewStorageObject: async () => {
        throw new Error('upload failed')
      },
      verifyExistingStorageObject: async () => {
        throw new Error('stored object could not be verified')
      },
    }),
    /stored object could not be verified/,
  )
})
