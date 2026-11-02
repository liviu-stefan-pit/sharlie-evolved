import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayColor, displayRadius, newness } from '../ui/src/graph.ts'
import type { GraphNode } from '../ui/src/types.ts'

const HOUR = 60 * 60 * 1000
const now = Date.parse('2026-11-02T12:00:00.000Z')
const card = (overrides: Partial<GraphNode> = {}): GraphNode => ({ id: 'card:a', kind: 'card', label: 'A', color: '#9d9d9d', ...overrides })
const at = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString()

test('displayColor(0) is the neutral token and displayColor(1) the amber token', () => {
  assert.equal(displayColor(0), '#a3a9b8')
  assert.equal(displayColor(1), '#b89a6a')
})

test('displayColor always returns a 6-digit hex, clamping out-of-range and non-finite t', () => {
  for (const t of [0, 0.25, 0.5, 0.75, 1, 3, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.match(displayColor(t), /^#[0-9a-f]{6}$/, `t=${t}`)
  }
  assert.equal(displayColor(3), '#b89a6a')
  assert.equal(displayColor(-1), '#a3a9b8')
  assert.equal(displayColor(Number.NaN), '#a3a9b8')
})

test('displayColor mixes only between the two endpoints', () => {
  const hex = displayColor(0.5)
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  assert.ok(r! >= 0xa3 && r! <= 0xb8)
  assert.ok(g! >= 0x9a && g! <= 0xa9)
  assert.ok(b! >= 0x6a && b! <= 0xb8)
})

test('displayRadius grows with degree from 4px to 16px', () => {
  assert.equal(displayRadius(3), 4)
  assert.equal(displayRadius(16), 16)
  assert.equal(displayRadius(9), 4 + 12 * (6 / 13))
  assert.equal(displayRadius(undefined), 4)
  assert.equal(displayRadius(Number.NaN), 4)
})

test('newness: under 24h is at least 0.4, 24h or older is 0', () => {
  const none = new Set<string>()
  for (const hours of [0, 1, 12, 23.9]) assert.ok(newness(card({ created_at: at(hours) }), none, now) >= 0.4, `${hours}h`)
  assert.equal(newness(card({ created_at: at(24) }), none, now), 0)
  assert.equal(newness(card({ created_at: at(72) }), none, now), 0)
})

test('newness: without a timestamp only a session-new id is new', () => {
  assert.equal(newness(card(), new Set(['card:a']), now), 1)
  assert.equal(newness(card(), new Set<string>(), now), 0)
  assert.equal(newness(card({ kind: 'tool', id: 'tool:a' }), new Set(['tool:a']), now), 0)
})
