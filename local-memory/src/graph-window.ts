import ForceGraph from 'force-graph'
import { openApp, type Machine } from './app.ts'

type DrawnNode = {
  id: string
  label: string
  color: string
}

type DrawnGraph = {
  canvas: string
  panel: string
  text: string
  accent: string
  nodes: DrawnNode[]
  links: { source: string; target: string }[]
}

type Shown =
  | {
      kind: 'card'
      title: string
      summary: string
      situation: string
      whatToDo: string
      why: string
      apply: string
      synced: boolean
    }
  | {
      kind: 'person'
      username: string
      email: string
      team: string
      cards: string[]
    }
  | {
      kind: 'team' | 'project' | 'source' | 'topic'
      name: string
      cards: string[]
    }

function describe(contents: Shown) {
  if (contents.kind === 'card') {
    return [
      contents.title,
      contents.synced ? 'synced' : 'not synced',
      contents.summary,
      'Situation',
      contents.situation,
      'What to do',
      contents.whatToDo,
      'Why',
      contents.why,
      'How someone who was not in the chat applies it',
      contents.apply,
    ].join('\n')
  }
  if (contents.kind === 'person') {
    return [contents.username, contents.email, contents.team, ...contents.cards].join('\n')
  }
  return [contents.name, ...contents.cards].join('\n')
}

type PlacedNode = DrawnNode & { x?: number; y?: number }

export function drawGraph(host: HTMLElement, graph: DrawnGraph, show: (id: string) => Shown) {
  host.innerHTML = ''
  host.style.display = 'flex'
  host.style.height = '100%'
  host.style.background = graph.canvas
  host.style.color = graph.text
  const surface = host.ownerDocument.createElement('div')
  surface.style.flex = '1'
  surface.style.minWidth = '0'
  const panel = host.ownerDocument.createElement('aside')
  panel.style.flex = '0 0 280px'
  panel.style.overflow = 'auto'
  panel.style.whiteSpace = 'pre-wrap'
  panel.style.padding = '16px'
  panel.style.boxSizing = 'border-box'
  panel.style.background = graph.panel
  panel.style.color = graph.text
  host.append(surface, panel)
  const placed = (node: object) => node as PlacedNode
  new ForceGraph(surface)
    .width(Math.max(host.clientWidth - 280, 1))
    .height(Math.max(host.clientHeight, 1))
    .backgroundColor(graph.canvas)
    .nodeColor((node) => placed(node).color)
    .nodeLabel((node) => placed(node).label)
    .linkColor(() => graph.accent)
    .nodeCanvasObject((node, ctx, globalScale) => {
      const drawn = placed(node)
      const x = drawn.x ?? 0
      const y = drawn.y ?? 0
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, 2 * Math.PI)
      ctx.fillStyle = drawn.color
      ctx.fill()
      const fontSize = 12 / globalScale
      ctx.font = `${fontSize}px sans-serif`
      ctx.fillStyle = graph.text
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(drawn.label, x + 6, y)
    })
    .nodePointerAreaPaint((node, color, ctx) => {
      const drawn = placed(node)
      ctx.beginPath()
      ctx.arc(drawn.x ?? 0, drawn.y ?? 0, 8, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.fill()
    })
    .onNodeClick((node) => {
      panel.textContent = describe(show(placed(node).id))
    })
    .graphData({ nodes: graph.nodes, links: graph.links })
}

export function mountGraph(host: HTMLElement, directory: string, machine?: Machine) {
  const app = openApp(directory, undefined, machine)
  drawGraph(host, app.graph(), (id) => app.show(id))
}
