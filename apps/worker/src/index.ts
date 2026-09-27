import type { WorkerHealth } from '@chiron/shared'

const health: WorkerHealth = {
  service: 'chiron-worker',
  phase: 'foundation',
  ready: true,
  checkedAt: new Date().toISOString(),
}

console.log(JSON.stringify(health, null, 2))
