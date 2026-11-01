import { findNode, linkEnd } from './graph'
import type { GraphLink, GraphNode } from './types'

function stamp(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function chipsFor(node: GraphNode, nodes: GraphNode[], links: GraphLink[]) {
  if (node.relations && node.relations.length > 0) {
    return node.relations.map((relation) => ({
      key: `${relation.relation}:${relation.target_entity}`,
      label: `${relation.relation} ${relation.target_entity}`,
      target: findNode(nodes, relation.target_entity)?.id ?? '',
    }))
  }
  const seen = new Set<string>()
  const chips: { key: string; label: string; target: string }[] = []
  for (const link of links) {
    const source = linkEnd(link.source)
    const target = linkEnd(link.target)
    const otherId = source === node.id ? target : target === node.id ? source : ''
    if (otherId === '' || seen.has(otherId)) continue
    seen.add(otherId)
    const other = nodes.find((item) => item.id === otherId)
    if (!other) continue
    chips.push({ key: other.id, label: other.label, target: other.id })
  }
  return chips
}

export function Drawer({
  node,
  nodes,
  links,
  onOpen,
  onClose,
}: {
  node: GraphNode
  nodes: GraphNode[]
  links: GraphLink[]
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const chips = chipsFor(node, nodes, links)
  return (
    <aside className="absolute top-0 right-0 z-20 flex h-full w-[280px] flex-col rounded-l-xl border-l border-line bg-elevated text-ink">
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[13px] font-semibold">{node.title || node.label}</h2>
        <button
          type="button"
          className="shrink-0 rounded-lg px-1.5 py-0.5 text-xs text-muted transition-colors duration-[120ms] hover:bg-white/[0.05] hover:text-ink"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3 text-[13px]">
        <p className="mb-3 text-xs text-faint">{stamp(node.created_at)}</p>
        <h3 className="mb-1 text-xs text-muted">What worked</h3>
        <p className="mb-3 whitespace-pre-wrap">{node.solution ?? ''}</p>
        <h3 className="mb-1 text-xs text-muted">What failed</h3>
        {node.failure_modes && node.failure_modes.length > 0 ? (
          <ul className="mb-3 list-disc pl-4">
            {node.failure_modes.map((mode) => (
              <li key={mode}>{mode}</li>
            ))}
          </ul>
        ) : (
          <p className="mb-3" />
        )}
        <h3 className="mb-2 text-xs text-muted">Relationships</h3>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="rounded-full border border-line bg-field px-2 py-0.5 text-xs text-ink transition-colors duration-[120ms] hover:bg-white/[0.05]"
              onClick={() => {
                if (chip.target !== '') onOpen(chip.target)
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
