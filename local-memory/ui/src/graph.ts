import type { GraphData, GraphLink, GraphNode } from './types'

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
