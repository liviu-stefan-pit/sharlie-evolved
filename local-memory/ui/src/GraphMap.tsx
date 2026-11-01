import { useEffect, useRef, useState } from 'react'
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d'
import type { GraphData, GraphNode } from './types'

type PaintNode = GraphNode & { x?: number; y?: number }

export function GraphMap({
  graph,
  selectedId,
  onSelect,
}: {
  graph: GraphData
  selectedId: string
  onSelect: (id: string) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const chart = useRef<ForceGraphMethods<PaintNode> | undefined>(undefined)
  const [size, setSize] = useState({ width: 1, height: 1 })

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const measure = () => {
      setSize({
        width: Math.max(element.clientWidth, 1),
        height: Math.max(element.clientHeight, 1),
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const e2e = import.meta.env.VITE_E2E === '1'

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const plot = chart.current
      if (!plot) return
      if (e2e) {
        if (size.width < 100 || size.height < 100) return
        plot.d3Force('charge', null)
        plot.d3Force('link', null)
        plot.d3Force('center', null)
        plot.zoomToFit(0, 40)
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            ;(window as Window & { __sharlieReady?: boolean }).__sharlieReady = true
          })
        })
        return
      }
      plot.zoomToFit(400, 24)
    }, e2e ? 50 : 500)
    return () => window.clearTimeout(timer)
  }, [e2e, graph.nodes, graph.links, size.width, size.height])

  useEffect(() => {
    if (!e2e) return
    const api = {
      screenCoords(id: string) {
        const plot = chart.current
        const canvas = frame.current?.querySelector('canvas')
        if (!plot || !canvas) return null
        const rect = canvas.getBoundingClientRect()
        if (rect.width < 100 || rect.height < 100) return null
        if (!(window as Window & { __sharlieReady?: boolean }).__sharlieReady) return null
        const node = graph.nodes.find((item) => item.id === id)
        const gx = node?.x
        const gy = node?.y
        if (gx == null || gy == null) return null
        const point = plot.graph2ScreenCoords(gx, gy)
        if (point.x < 4 || point.y < 4 || point.x > rect.width - 4 || point.y > rect.height - 4) return null
        return { x: point.x, y: point.y }
      },
    }
    ;(window as Window & { __sharlieGraph?: typeof api }).__sharlieGraph = api
  }, [e2e, graph])

  return (
    <div ref={frame} data-graph className="relative min-h-0 flex-1" style={{ background: graph.canvas }}>
      <ForceGraph2D<PaintNode>
        ref={chart}
        width={size.width}
        height={size.height}
        graphData={graph}
        backgroundColor={graph.canvas}
        {...(import.meta.env.VITE_E2E === '1'
          ? { cooldownTicks: 0, warmupTicks: 0, autoPauseRedraw: false, enableNodeDrag: false, enablePanInteraction: false }
          : {})}
        nodeRelSize={4}
        linkColor={() => graph.accent}
        nodeLabel={(node) => node.label}
        nodeColor={(node) => node.color}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const x = node.x ?? 0
          const y = node.y ?? 0
          const selected = node.id === selectedId
          ctx.beginPath()
          ctx.arc(x, y, selected ? 5 : 3.5, 0, 2 * Math.PI)
          ctx.fillStyle = selected ? graph.text : node.color
          ctx.fill()
          const fontSize = 12 / globalScale
          ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
          ctx.fillStyle = selected ? graph.text : graph.muted
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(node.label, x + 8, y)
        }}
        nodePointerAreaPaint={(node, color, ctx) => {
          ctx.beginPath()
          ctx.arc(node.x ?? 0, node.y ?? 0, import.meta.env.VITE_E2E === '1' ? 24 : 8, 0, 2 * Math.PI)
          ctx.fillStyle = color
          ctx.fill()
        }}
        onNodeClick={(node) => onSelect(node.id)}
        onBackgroundClick={() => onSelect('')}
      />
    </div>
  )
}
