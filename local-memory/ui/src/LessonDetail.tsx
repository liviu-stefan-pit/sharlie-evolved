import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { linkEnd } from './graph'
import type { GraphLink, GraphNode } from './types'

const kindName: Record<string, string> = { tool: 'Tool', topic: 'Topic', issue: 'Project', team: 'Team', developer: 'Person', card: 'Lesson' }

/** "2 Nov" (en-GB day month, the user's local day). */
export function shortDate(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function neighbours(node: GraphNode, nodes: GraphNode[], links: GraphLink[]) {
  const out: GraphNode[] = []
  for (const link of links) {
    const a = linkEnd(link.source)
    const b = linkEnd(link.target)
    const other = a === node.id ? b : b === node.id ? a : ''
    const found = other ? nodes.find((item) => item.id === other) : undefined
    if (found && !out.includes(found)) out.push(found)
  }
  return out
}

export type ShareState = 'local' | 'waiting' | 'shared'

/**
 * Sharing state is text only, in this panel, and only when the host sends `scope`. Personal lessons stay on the PC;
 * a work lesson waits while sharing is on until the host reports it copied (`synced`).
 */
export function shareState(node: GraphNode, share: boolean): ShareState | null {
  // No scope on the node means the host doesn't know yet: show no badge rather than guess.
  if (node.scope === undefined || node.scope === null || node.scope === '') return null
  if (node.scope !== 'work') return 'local'
  if (node.synced === true) return 'shared'
  return share ? 'waiting' : 'local'
}

const shareText: Record<ShareState, string> = { local: 'Only on this PC', waiting: 'Waiting to share', shared: 'Shared' }

function ShareBadge({ state }: { state: ShareState }) {
  return (
    <p data-share-badge={state} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[13px] text-muted">
      <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {state === 'local' ? (
          <>
            <rect x="3" y="7" width="10" height="7" rx="1.5" />
            <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
          </>
        ) : state === 'waiting' ? (
          <>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M8 5v3l2 1.5" />
          </>
        ) : (
          <path d="M3.5 8.5l3 3 6-7" />
        )}
      </svg>
      {shareText[state]}
    </p>
  )
}

function Chip({ node, onOpen }: { node: GraphNode; onOpen: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        className={`inline-flex min-h-9 items-center rounded-full border bg-field px-3 text-[13px] text-ink hover:bg-panel ${node.kind === 'card' ? 'border-amber/60' : 'border-line'}`}
        onClick={() => onOpen(node.id)}
      >
        {node.title || node.label}
      </button>
    </li>
  )
}

/**
 * One lesson (or tool/topic). A bottom sheet under 760px, otherwise a side panel beside the map.
 * Dialog semantics, Escape closes, focus moves in on open and back to where it came from.
 */
export function LessonDetail({
  node,
  nodes,
  links,
  sheet,
  share,
  onOpen,
  onClose,
}: {
  node: GraphNode
  nodes: GraphNode[]
  links: GraphLink[]
  sheet: boolean
  /** docs/HOST_ACTIONS.md `share`: the team-Drive switch. */
  share: boolean
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const back = useRef<Element | null>(null)

  // Remember where focus was when the panel first opened, return it on close.
  useLayoutEffect(() => {
    back.current = document.activeElement
    return () => {
      const target = back.current as HTMLElement | null
      if (target && target.isConnected && typeof target.focus === 'function') target.focus()
    }
  }, [])
  useEffect(() => {
    heading.current?.focus()
  }, [node.id])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const related = neighbours(node, nodes, links)
  const isCard = node.kind === 'card'
  const from = related.filter((item) => item.kind === 'tool').map((item) => item.label)
  const day = shortDate(node.created_at)
  const fromLine = [from.join(', '), day].filter(Boolean).join(' · ')
  const lessons = related.filter((item) => item.kind === 'card')
  const others = related.filter((item) => item.kind !== 'card' && item.kind !== 'developer')

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={`${id}-title`}
      data-lesson-detail={sheet ? 'sheet' : 'panel'}
      className={
        sheet
          ? 'absolute inset-x-0 bottom-0 z-30 flex max-h-[60%] flex-col rounded-t-[14px] border-t border-line bg-panel text-ink shadow-[0_-8px_24px_rgba(0,0,0,0.35)]'
          : 'relative z-20 flex h-full w-[clamp(280px,34vw,400px)] shrink-0 flex-col border-l border-line bg-panel text-ink'
      }
    >
      {sheet ? <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-line" /> : null}
      <div className="flex items-start gap-2 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          {!isCard ? <p className="text-[13px] text-muted">{kindName[node.kind] ?? node.kind}</p> : null}
          <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className="text-[18px] leading-snug font-semibold text-ink">
            {node.title || node.label}
          </h2>
        </div>
        <button type="button" className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-[10px] border border-line px-3 text-[15px] text-ink hover:bg-field" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {isCard ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              {fromLine ? <p>From: {fromLine}</p> : null}
              {shareState(node, share) ? <ShareBadge state={shareState(node, share)!} /> : null}
            </div>
            {node.summary ? <p className="mt-3 text-[16px] leading-[1.55] text-ink">{node.summary}</p> : null}
            {node.solution ? (
              <section className="mt-4">
                <h3 className="text-[13px] font-semibold text-muted">What to do</h3>
                <p className="mt-1 text-[16px] leading-[1.55] whitespace-pre-wrap text-ink">{node.solution}</p>
              </section>
            ) : null}
            {node.why ? (
              <section className="mt-4">
                <h3 className="text-[13px] font-semibold text-muted">Why it works</h3>
                <p className="mt-1 text-[15px] whitespace-pre-wrap text-ink">{node.why}</p>
              </section>
            ) : null}
            {node.failure_modes && node.failure_modes.length > 0 ? (
              <section className="mt-4">
                <h3 className="text-[13px] font-semibold text-muted">What went wrong</h3>
                <ul className="mt-1 list-disc pl-5 text-[15px] text-ink">
                  {node.failure_modes.map((mode) => (
                    <li key={mode}>{mode}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
        {others.length > 0 ? (
          <section className="mt-4">
            <h3 className="text-[13px] font-semibold text-muted">{isCard ? 'About' : 'Related'}</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {others.map((item) => (
                <Chip key={item.id} node={item} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ) : null}
        {lessons.length > 0 ? (
          <section className="mt-4">
            <h3 className="text-[13px] font-semibold text-muted">{isCard ? 'Related lessons' : `Lessons (${lessons.length})`}</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {lessons.map((item) => (
                <Chip key={item.id} node={item} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  )
}
