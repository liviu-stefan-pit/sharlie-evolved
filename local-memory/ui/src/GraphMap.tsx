import { Graph } from '@cosmos.gl/graph'
import { useEffect, useRef, useState } from 'react'
import { displayColor, displayRadius, linkEnd } from './graph'
import type { GraphData, GraphNode } from './types'

type LabelItem = { id: string; label: string; x: number; y: number }

type SharlieGraphApi = {
  screenCoords(id: string): { x: number; y: number } | null
  inspect?: () => {
    running: boolean
    sizes: number[]
    colors: number[]
    positions: number[]
    labels: number
  }
}

const LABEL_CAP = 48
const LABEL_SIZE_FLOOR = 3.5
const HOVER_ALPHA = 0.28
const RING = '#cccccc'
const LINK = '#5c5c5c'

function webgl2Ok() {
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('webgl2') != null
  } catch {
    return false
  }
}

function jitter(id: string, axis: 0 | 1) {
  let hash = axis + 1
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0
  return ((hash % 21) - 10) * 1.2
}

function rgba(hex: string, alpha: number) {
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
    alpha,
  ] as const
}

function pinOf(node: GraphNode, e2e: boolean) {
  if (node.fx != null && node.fy != null) return [node.fx, node.fy] as const
  if (e2e && node.x != null && node.y != null) return [node.x, node.y] as const
  return null
}

export function GraphMap({
  graph,
  selectedId,
  onSelect,
  learningActive = false,
  onUnsupported,
}: {
  graph: GraphData
  selectedId: string
  onSelect: (id: string) => void
  learningActive?: boolean
  /** Called once when this PC cannot draw the map (no WebGL2), so the caller can show the list. */
  onUnsupported?: () => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<Graph | null>(null)
  const ids = useRef<string[]>([])
  const indexOf = useRef(new Map<string, number>())
  const placed = useRef(new Map<string, [number, number]>())
  const seen = useRef(new Set<string>())
  const syncGen = useRef(0)
  const hovered = useRef<number | undefined>(undefined)
  const fittedDuringRun = useRef(false)
  const sawActiveRun = useRef(false)
  const everFitted = useRef(false)
  const uploadTimer = useRef(0)
  const labelRaf = useRef(0)
  const graphRef = useRef(graph)
  const selectedRef = useRef(selectedId)
  const onSelectRef = useRef(onSelect)
  const onUnsupportedRef = useRef(onUnsupported)
  onUnsupportedRef.current = onUnsupported
  const learningRef = useRef(learningActive)
  const e2e = import.meta.env.VITE_E2E === '1'
  const [blocked, setBlocked] = useState(false)
  const [labels, setLabels] = useState<LabelItem[]>([])

  graphRef.current = graph
  selectedRef.current = selectedId
  onSelectRef.current = onSelect
  learningRef.current = learningActive

  useEffect(() => {
    return () => {
      window.clearTimeout(uploadTimer.current)
      window.cancelAnimationFrame(labelRaf.current)
      engine.current?.destroy()
      engine.current = null
      const win = window as Window & { __sharlieReady?: boolean; __sharlieGraph?: SharlieGraphApi }
      win.__sharlieReady = false
      delete win.__sharlieGraph
    }
  }, [])

  useEffect(() => {
    if (graph.nodes.length === 0 && !engine.current) return
    window.clearTimeout(uploadTimer.current)
    uploadTimer.current = window.setTimeout(() => {
      void syncEngine()
    }, 150)
    return () => window.clearTimeout(uploadTimer.current)
  }, [graph, learningActive, e2e])

  useEffect(() => {
    const g = engine.current
    if (!g) return
    paintRings(g)
    scheduleLabels()
  }, [selectedId])

  function visibleCanvas() {
    const canvases = [...(frame.current?.querySelectorAll('canvas') ?? [])]
    return canvases.find((item) => item.offsetWidth > 0 && item.offsetHeight > 0) ?? canvases[0]
  }

  function screenCoords(id: string) {
    const g = engine.current
    const canvas = visibleCanvas()
    const win = window as Window & { __sharlieReady?: boolean }
    if (!g || !canvas || !win.__sharlieReady) return null
    const index = indexOf.current.get(id)
    if (index == null) return null
    const positions = g.getPointPositions()
    const x = positions[index * 2]
    const y = positions[index * 2 + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    const point = g.spaceToScreenPosition([x, y])
    const rect = canvas.getBoundingClientRect()
    if (point[0] < 4 || point[1] < 4 || point[0] > rect.width - 4 || point[1] > rect.height - 4) {
      return null
    }
    return { x: point[0], y: point[1] }
  }

  function expose() {
    const win = window as Window & { __sharlieGraph?: SharlieGraphApi }
    win.__sharlieGraph = {
      screenCoords,
      inspect() {
        const g = engine.current
        return {
          running: g?.isSimulationRunning === true,
          sizes: g ? [...g.getPointSizes()] : [],
          colors: g ? [...g.getPointColors()] : [],
          positions: g ? g.getPointPositions() : [],
          labels: frame.current?.querySelectorAll('[data-graph-label]').length ?? 0,
        }
      },
    }
  }

  function shouldFit(count: number) {
    if (count === 0) return false
    if (learningRef.current) {
      sawActiveRun.current = true
      if (fittedDuringRun.current) return false
      fittedDuringRun.current = true
      return true
    }
    if (sawActiveRun.current) {
      sawActiveRun.current = false
      fittedDuringRun.current = false
      return true
    }
    return !everFitted.current
  }

  function place(node: GraphNode, data: GraphData) {
    const pinned = pinOf(node, e2e)
    if (pinned) return [pinned[0], pinned[1]] as [number, number]
    const cached = placed.current.get(node.id)
    if (cached) return cached
    if (node.x != null && node.y != null) return [node.x, node.y] as [number, number]
    for (const link of data.links) {
      const source = linkEnd(link.source)
      const target = linkEnd(link.target)
      const other = source === node.id ? target : target === node.id ? source : ''
      if (other === '') continue
      const neighbor = placed.current.get(other) ?? pinOf(data.nodes.find((item) => item.id === other) ?? node, e2e)
      if (neighbor) {
        return [neighbor[0] + jitter(node.id, 0), neighbor[1] + jitter(node.id, 1)] as [number, number]
      }
    }
    return [jitter(node.id, 0) * 12, jitter(node.id, 1) * 12] as [number, number]
  }

  function paintColors(g: Graph, hover?: number) {
    const nodes = graphRef.current.nodes
    const colors = new Float32Array(nodes.length * 4)
    const keep = new Set<number>()
    const selected = indexOf.current.get(selectedRef.current)
    if (hover != null) {
      keep.add(hover)
      for (const neighbor of g.getNeighboringPointIndices(hover)) keep.add(neighbor)
    }
    if (selected != null) keep.add(selected)
    for (let i = 0; i < nodes.length; i++) {
      const [r, gch, b] = rgba(displayColor(nodes[i]?.degree), 1)
      const alpha = hover == null || keep.has(i) ? 1 : HOVER_ALPHA
      colors[i * 4] = r
      colors[i * 4 + 1] = gch
      colors[i * 4 + 2] = b
      colors[i * 4 + 3] = alpha
    }
    g.setPointColors(colors)
  }

  function paintRings(g: Graph) {
    const outlined: number[] = []
    if (hovered.current != null) outlined.push(hovered.current)
    const selected = indexOf.current.get(selectedRef.current)
    if (selected != null && !outlined.includes(selected)) outlined.push(selected)
    g.setConfigPartial({
      outlinedPointIndices: outlined,
      focusedPointIndex: selected,
    })
  }

  function applyHover(index?: number) {
    if (index === hovered.current) return
    hovered.current = index
    const g = engine.current
    if (!g) return
    paintColors(g, index)
    paintRings(g)
    g.render(undefined, 0)
    scheduleLabels()
  }

  function scheduleLabels() {
    window.cancelAnimationFrame(labelRaf.current)
    labelRaf.current = window.requestAnimationFrame(refreshLabels)
  }

  function refreshLabels() {
    const g = engine.current
    const data = graphRef.current
    if (!g || data.nodes.length === 0) {
      setLabels([])
      return
    }
    const chosen = new Set<number>()
    if (hovered.current != null) chosen.add(hovered.current)
    const selected = indexOf.current.get(selectedRef.current)
    if (selected != null) chosen.add(selected)
    const sampled = [...g.getSampledPointPositionsMap().keys()]
    sampled.sort((a, b) => (data.nodes[b]?.degree ?? 0) - (data.nodes[a]?.degree ?? 0))
    for (const index of sampled) {
      if (chosen.size >= LABEL_CAP) break
      if (chosen.has(index)) continue
      if (g.spaceToScreenRadius(displayRadius(data.nodes[index]?.degree)) < LABEL_SIZE_FLOOR) continue
      chosen.add(index)
    }
    g.trackPointPositionsByIndices([...chosen])
    const tracked = g.getTrackedPointPositionsMap({ nonBlocking: true })
    const next: LabelItem[] = []
    for (const index of chosen) {
      const node = data.nodes[index]
      const space = tracked.get(index)
      if (!node || !space) continue
      const screen = g.spaceToScreenPosition(space)
      next.push({ id: node.id, label: node.label, x: screen[0], y: screen[1] })
    }
    setLabels(next)
  }

  async function remember(g: Graph) {
    if (ids.current.length === 0) return
    const positions = await g.getPointPositionsAsync()
    for (let i = 0; i < ids.current.length; i++) {
      const x = positions[i * 2]
      const y = positions[i * 2 + 1]
      if (Number.isFinite(x) && Number.isFinite(y)) placed.current.set(ids.current[i]!, [x, y])
    }
  }

  function applyData(g: Graph, data: GraphData) {
    const nextIds = data.nodes.map((node) => node.id)
    const nextIndex = new Map(nextIds.map((id, index) => [id, index]))
    const added = nextIds.some((id) => !seen.current.has(id))
    const positions = new Float32Array(data.nodes.length * 2)
    const sizes = new Float32Array(data.nodes.length)
    const pinned: number[] = []
    for (let i = 0; i < data.nodes.length; i++) {
      const node = data.nodes[i]!
      const point = place(node, data)
      positions[i * 2] = point[0]
      positions[i * 2 + 1] = point[1]
      placed.current.set(node.id, point)
      sizes[i] = displayRadius(node.degree)
      if (pinOf(node, e2e)) pinned.push(i)
    }
    const pairs: number[] = []
    for (const link of data.links) {
      const source = nextIndex.get(linkEnd(link.source))
      const target = nextIndex.get(linkEnd(link.target))
      if (source == null || target == null || source === target) continue
      pairs.push(source, target)
    }
    ids.current = nextIds
    indexOf.current = nextIndex
    for (const id of nextIds) seen.current.add(id)
    hovered.current = undefined
    g.setPointPositions(positions, true)
    g.setPointSizes(sizes)
    g.setLinks(new Float32Array(pairs))
    paintColors(g)
    g.setPinnedPoints(pinned.length > 0 ? pinned : null)
    g.render(e2e ? 0 : undefined, 0)
    paintRings(g)
    return added
  }

  async function syncEngine() {
    const generation = ++syncGen.current
    const data = graphRef.current
    const mount = host.current
    if (!mount) return
    if (data.nodes.length === 0 && !engine.current) return
    if (!engine.current) {
      if (!webgl2Ok()) {
        setBlocked(true)
        onUnsupportedRef.current?.()
        return
      }
      engine.current = new Graph(mount, {
        backgroundColor: data.canvas,
        pointDefaultColor: '#9d9d9d',
        pointDefaultSize: 4,
        pointOpacity: 1,
        linkDefaultColor: LINK,
        linkDefaultWidth: 1,
        curvedLinks: false,
        scalePointsOnZoom: false,
        scaleLinksOnZoom: false,
        enableDrag: !e2e,
        enableZoom: true,
        enableSimulation: !e2e,
        enableSimulationDuringZoom: false,
        fitViewOnInit: false,
        attribution: '',
        renderHoveredPointRing: true,
        hoveredPointRingColor: RING,
        focusedPointRingColor: RING,
        outlinedPointRingColor: RING,
        hoveredPointCursor: 'pointer',
        simulationCollision: 1,
        simulationCollisionPadding: 2,
        pointSamplingDistance: 72,
        linkVisibilityMinTransparency: 1,
        rescalePositions: false,
        onSimulationEnd: () => engine.current?.pause(),
        onPointClick: (index) => onSelectRef.current(ids.current[index] ?? ''),
        onBackgroundClick: () => onSelectRef.current(''),
        onPointMouseOver: (index) => applyHover(index),
        onPointMouseOut: () => applyHover(undefined),
        onZoom: () => scheduleLabels(),
        onSimulationTick: () => scheduleLabels(),
      })
    }
    const g = engine.current
    await g.ready
    if (generation !== syncGen.current) return
    if (ids.current.length > 0) await remember(g)
    if (generation !== syncGen.current) return
    const added = applyData(g, data)
    if (e2e) {
      g.pause()
      g.setPinnedPoints(ids.current.map((_, index) => index))
    }
    if (shouldFit(data.nodes.length)) {
      g.fitView(e2e ? 0 : 400, 0.1, false)
      everFitted.current = true
    }
    if (e2e) {
      g.pause()
      ;(window as Window & { __sharlieReady?: boolean }).__sharlieReady = true
    } else if (added) {
      if (learningRef.current) g.start(0.2)
      else if (!g.isSimulationRunning) g.start()
    }
    expose()
    scheduleLabels()
  }

  return (
    <div ref={frame} data-graph className="relative min-h-0 flex-1" style={{ background: graph.canvas }}>
      <div ref={host} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {labels.map((item) => (
          <div
            key={item.id}
            data-graph-label={item.id}
            className="absolute whitespace-nowrap text-[12px]"
            style={{ left: item.x, top: item.y, transform: 'translate(10px, -50%)', color: '#cccccc' }}
          >
            {item.label}
          </div>
        ))}
      </div>
      {blocked ? (
        <p className="absolute inset-0 flex items-center justify-center text-[13px] text-muted">This map needs WebGL2</p>
      ) : null}
    </div>
  )
}
