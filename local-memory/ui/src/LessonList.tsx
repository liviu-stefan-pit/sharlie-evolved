import type { GraphNode } from './types'

/** The list view of what Sharlie knows: lessons first, then the tools and topics they touch. */
export function LessonList({ nodes, selectedId, onSelect, note }: { nodes: GraphNode[]; selectedId: string; onSelect: (id: string) => void; note?: string }) {
  const lessons = nodes.filter((node) => node.kind === 'card')
  const others = nodes.filter((node) => node.kind !== 'card')
  const row = (node: GraphNode) => (
    <li key={node.id}>
      <button
        type="button"
        aria-current={node.id === selectedId ? 'true' : undefined}
        className={`flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[15px] text-ink hover:bg-field ${node.id === selectedId ? 'bg-field' : ''}`}
        onClick={() => onSelect(node.id)}
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: node.color }} />
        <span className="min-w-0 flex-1 truncate">{node.title || node.label}</span>
        {node.kind !== 'card' ? <span className="text-[13px] text-muted">{node.kind}</span> : null}
      </button>
    </li>
  )
  return (
    <div data-lesson-list className="min-h-0 flex-1 overflow-auto px-3 py-3">
      <div className="mx-auto max-w-[720px]">
        {note ? <p className="mb-2 text-[13px] text-muted">{note}</p> : null}
        <h2 className="px-3 text-[18px] font-semibold text-ink">Lessons</h2>
        {lessons.length > 0 ? <ul className="mt-1">{lessons.map(row)}</ul> : <p className="px-3 py-2 text-[15px] text-muted">No lessons yet.</p>}
        {others.length > 0 ? (
          <>
            <h2 className="mt-4 px-3 text-[18px] font-semibold text-ink">Tools and topics</h2>
            <ul className="mt-1">{others.map(row)}</ul>
          </>
        ) : null}
      </div>
    </div>
  )
}
