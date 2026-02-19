import { useEffect, useRef, useState } from 'react'

type Stroke = {
  x0: number
  y0: number
  x1: number
  y1: number
  color: string
  size: number
  tool: 'brush' | 'eraser'
}

type Props = {
  enabled: boolean
  color: string
  size: number
  tool: 'brush' | 'eraser'
  strokes: Stroke[]
  onStroke: (stroke: Stroke) => void
}

export function DrawingCanvas({ enabled, color, size, tool, strokes, onStroke }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(stroke.x0, stroke.y0)
    ctx.lineTo(stroke.x1, stroke.y1)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = stroke.size
    ctx.strokeStyle = stroke.tool === 'eraser' ? '#0f172a' : stroke.color
    ctx.stroke()
    ctx.restore()
  }

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return

    canvas.width = canvas.clientWidth
    canvas.height = canvas.clientHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    strokes.forEach((stroke) => drawStroke(ctx, stroke))
  }, [strokes])

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const pointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enabled) return
    setIsDrawing(true)
    lastPoint.current = getPoint(e)
  }

  const pointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!enabled || !isDrawing || !lastPoint.current) return
    const current = getPoint(e)
    const stroke: Stroke = {
      x0: lastPoint.current.x,
      y0: lastPoint.current.y,
      x1: current.x,
      y1: current.y,
      color,
      size,
      tool
    }

    const ctx = ref.current?.getContext('2d')
    if (ctx) drawStroke(ctx, stroke)

    onStroke(stroke)
    lastPoint.current = current
  }

  const pointerUp = () => {
    setIsDrawing(false)
    lastPoint.current = null
  }

  return (
    <canvas
      ref={ref}
      className="h-[52vh] w-full touch-none rounded-xl border border-slate-700 bg-slate-900"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerLeave={pointerUp}
    />
  )
}
