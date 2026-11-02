import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mockModelEnabled } from '../src/host.ts'
import { runSmokeLearn } from '../src/smoke-learn.ts'

test('SHARLIE_MOCK_MODEL does nothing unless the process was started with --smoke', () => {
  const previous = process.env.SHARLIE_MOCK_MODEL
  process.env.SHARLIE_MOCK_MODEL = '1'
  try {
    assert.equal(process.argv.includes('--smoke'), false)
    assert.equal(mockModelEnabled(), false)
  } finally {
    if (previous === undefined) delete process.env.SHARLIE_MOCK_MODEL
    else process.env.SHARLIE_MOCK_MODEL = previous
  }
})

test('a mock first-run learn writes one card, skips the secret, and does not call the model again', async () => {
  const report = await runSmokeLearn()
  assert.equal(report.reason, undefined)
  assert.equal(report.cards, 1)
  assert.equal(report.calls, 1)
  assert.equal(report.rerunCalls, 0)
  assert.equal(report.secretFound, false)
  assert.equal(report.ok, true)
})
