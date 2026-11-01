import type { GraphData, GraphLink, GraphNode } from './types.ts'

const GRAY = [0x9d, 0x9d, 0x9d] as const
const ORANGE = [0xd4, 0x89, 0x4a] as const

function finiteDegree(degree: number | undefined) {
  return typeof degree === 'number' && Number.isFinite(degree) ? degree : 0
}

function fade(degree: number | undefined) {
  return Math.min(1, Math.max(0, (finiteDegree(degree) - 3) / 13))
}

function hexChannel(value: number) {
  return value.toString(16).padStart(2, '0')
}

export function displayColor(degree?: number) {
  const t = fade(degree)
  const r = Math.round(GRAY[0] + (ORANGE[0] - GRAY[0]) * t)
  const g = Math.round(GRAY[1] + (ORANGE[1] - GRAY[1]) * t)
  const b = Math.round(GRAY[2] + (ORANGE[2] - GRAY[2]) * t)
  return `#${hexChannel(r)}${hexChannel(g)}${hexChannel(b)}`
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
