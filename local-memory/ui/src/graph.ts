import type { GraphData, GraphLink, GraphNode } from './types.ts'

function channels(hex: string) {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]
}

function finiteDegree(degree: number | undefined) {
  return typeof degree === 'number' && Number.isFinite(degree) ? degree : 0
}

function fade(degree: number | undefined) {
  return Math.min(1, Math.max(0, (finiteDegree(degree) - 3) / 13))
}

function hexChannel(value: number) {
  return value.toString(16).padStart(2, '0')
}

const DAY = 24 * 60 * 60 * 1000

/**
 * How "new" a node is, 0..1. Amber means new only: a lesson written within the last 24 hours
 * (by its created_at, newest brightest, fading to neutral at 24h) or, when the host gives no
 * timestamp, a lesson first seen during this session. Everything else is neutral. Sharing state
 * never colours a node.
 */
export function newness(node: GraphNode, sessionNew: ReadonlySet<string>, now: number) {
  if (node.kind !== 'card') return 0
  const at = node.created_at ? Date.parse(node.created_at) : Number.NaN
  if (Number.isFinite(at)) {
    const age = now - at
    if (age < 0) return 1
    if (age >= DAY) return 0
    return Math.max(0.4, 1 - age / DAY)
  }
  return sessionNew.has(node.id) ? 1 : 0
}

/** Neutral (muted token) mixed toward the amber token by t (0 = neutral, 1 = amber). */
export function displayColor(t: number, low = '#a3a9b8', high = '#b89a6a') {
  const GRAY = channels(low)
  const ORANGE = channels(high)
  const k = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
  const r = Math.round(GRAY[0] + (ORANGE[0] - GRAY[0]) * k)
  const g = Math.round(GRAY[1] + (ORANGE[1] - GRAY[1]) * k)
  const b = Math.round(GRAY[2] + (ORANGE[2] - GRAY[2]) * k)
  return `#${hexChannel(r)}${hexChannel(g)}${hexChannel(b)}`
}

/** Labels are kept for hovered, selected, or busy nodes only. */
export function isBusy(degree?: number) {
  return fade(degree) > 0
}

export function displayRadius(degree?: number) {
  return Math.min(16, Math.max(4, 4 + 12 * fade(degree)))
}

export function linkEnd(value: GraphLink['source']) {
  return typeof value === 'string' ? value : value.id
}

export function filterGraph(graph: GraphData, query: string): GraphData {
  const needle = query.trim().toLowerCase()
  if (needle === '') return graph
  const nodes = graph.nodes.filter((node) => {
    const haystack = [node.label, node.title, node.solution, node.id, ...(node.failure_modes ?? [])]
      .filter((part): part is string => Boolean(part))
      .join('\n')
      .toLowerCase()
    return haystack.includes(needle)
  })
  const ids = new Set(nodes.map((node) => node.id))
  const links = graph.links.filter(
    (link) => ids.has(linkEnd(link.source)) && ids.has(linkEnd(link.target)),
  )
  return { ...graph, nodes, links }
}

export function nodeKey(node: GraphNode) {
  const split = node.id.indexOf(':')
  return split === -1 ? node.id : node.id.slice(split + 1)
}

export function findNode(nodes: GraphNode[], target: string) {
  const needle = target.toLowerCase()
  return nodes.find((node) => nodeKey(node).toLowerCase() === needle || node.label.toLowerCase() === needle)
}
