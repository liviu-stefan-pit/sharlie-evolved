import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayColor, displayRadius } from '../ui/src/graph.ts'

test('degree 3 is gray and 4px', () => {
  assert.equal(displayColor(3), '#9d9d9d')
  assert.equal(displayRadius(3), 4)
})

test('degree 16 is orange and 16px', () => {
  assert.equal(displayColor(16), '#d4894a')
  assert.equal(displayRadius(16), 16)
})

test('degree 9 mixes only the gray and orange endpoints', () => {
  assert.equal(displayColor(9), '#b69477')
  assert.equal(displayRadius(9), 4 + 12 * (6 / 13))
  const hex = displayColor(9)
  assert.match(hex, /^#[0-9a-f]{6}$/)
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  assert.ok(r >= 0x9d && r <= 0xd4)
  assert.ok(g >= 0x89 && g <= 0x9d)
  assert.ok(b >= 0x4a && b <= 0x9d)
})

test('missing or non-finite degree is treated as 0', () => {
  assert.equal(displayColor(undefined), '#9d9d9d')
  assert.equal(displayColor(Number.NaN), '#9d9d9d')
  assert.equal(displayColor(Number.POSITIVE_INFINITY), '#9d9d9d')
  assert.equal(displayRadius(undefined), 4)
  assert.equal(displayRadius(Number.NaN), 4)
})
