import { useId } from 'react'
import { findNode } from './graph'
import { Trouble } from './Trouble'
import type { GraphNode } from './types'

export type AskState =
  | { phase: 'idle' }
  | { phase: 'asking'; question: string }
  | { phase: 'answered'; question: string; answer: string; cited: string[] }
  | { phase: 'empty-lessons'; question: string }
  | { phase: 'failed'; question: string; raw: string }

/** Cited lesson ids from the host when it sends them (`cited`), else nothing: no guessed citations. */
export function citedNodes(cited: string[], nodes: GraphNode[]) {
  const out: GraphNode[] = []
  for (const ref of cited) {
    const node = nodes.find((item) => item.id === ref) ?? findNode(nodes, ref.replace(/^.*[\\/]/, '').replace(/\.(md|json)$/, ''))
    if (node && !out.includes(node)) out.push(node)
  }
  return out
}

export function AskPanel({ ask, nodes, onOpen, onClose, onStartLearning }: { ask: AskState; nodes: GraphNode[]; onOpen: (id: string) => void; onClose: () => void; onStartLearning: () => void }) {
  const id = useId()
  if (ask.phase === 'idle') return null
  const chips = ask.phase === 'answered' ? citedNodes(ask.cited, nodes) : []
  return (
    <section aria-labelledby={`${id}-q`} className="relative z-20 max-h-[45vh] shrink-0 overflow-auto border-b border-line bg-panel px-4 py-3">
      <div className="mx-auto max-w-[720px]">
        <div className="flex items-start gap-2">
          <h2 id={`${id}-q`} className="min-w-0 flex-1 text-[13px] text-muted">
            You asked: <span className="text-ink">{ask.question}</span>
          </h2>
          <button type="button" aria-label="Close answer" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-field hover:text-ink" onClick={onClose}>
            ×
          </button>
        </div>
        <div aria-live="polite" aria-busy={ask.phase === 'asking'} className="mt-1">
          {ask.phase === 'asking' ? <p className="text-[15px] text-muted">Looking through your lessons…</p> : null}
          {ask.phase === 'answered' && ask.answer.trim() !== '' ? <p className="text-[16px] leading-[1.55] whitespace-pre-wrap text-ink">{ask.answer}</p> : null}
          {ask.phase === 'answered' && ask.answer.trim() === '' ? (
            <p className="text-[15px] text-muted">Sharlie has no lesson about that yet. It will learn more as you work.</p>
          ) : null}
          {ask.phase === 'empty-lessons' ? (
            <div>
              <p className="text-[15px] text-muted">Sharlie has no lessons yet, so there is nothing to answer from.</p>
              <button type="button" className="mt-2 h-9 rounded-[10px] border border-border-input px-3 text-[15px] text-ink hover:bg-field" onClick={onStartLearning}>
                Start learning
              </button>
            </div>
          ) : null}
          {ask.phase === 'failed' ? <Trouble raw={ask.raw} /> : null}
        </div>
        {chips.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-[13px] text-muted">From these lessons</h3>
            <ul className="mt-1 flex flex-wrap gap-2">
              {chips.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    className="inline-flex min-h-9 items-center rounded-full border border-amber/60 bg-field px-3 text-[13px] text-ink hover:border-amber"
                    onClick={() => onOpen(node.id)}
                  >
                    {node.title || node.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}
