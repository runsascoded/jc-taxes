import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  values: number[]
  percentile: number | undefined
  max: number
  prefix: string
  metricLabel: string
}

const NUM_BINS = 40
const W = 220
const H = 80
const PAD = { top: 4, right: 28, bottom: 16, left: 4 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

type BinData = { lo: number; hi: number; count: number; cumPct: number }

export default function DistributionChart({ values, percentile, max, prefix, metricLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const n = values.length
  const [hoverBin, setHoverBin] = useState<number | null>(null)

  const bins = useMemo((): BinData[] => {
    if (n === 0) return []
    const binWidth = max / NUM_BINS
    const counts = new Array(NUM_BINS).fill(0)
    for (const v of values) {
      counts[Math.min(Math.floor(v / binWidth), NUM_BINS - 1)]++
    }
    let cum = 0
    return counts.map((count, i) => {
      cum += count
      return { lo: i * binWidth, hi: (i + 1) * binWidth, count, cumPct: cum / n * 100 }
    })
  }, [values, n, max])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || bins.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)

    const maxBin = Math.max(...bins.map(b => b.count))
    if (maxBin === 0) return

    const style = getComputedStyle(canvas)
    const textSecondary = style.getPropertyValue('color') || 'rgba(150,150,150,0.6)'

    // Histogram bars
    for (let i = 0; i < NUM_BINS; i++) {
      if (bins[i].count === 0) continue
      const x = PAD.left + (i / NUM_BINS) * PLOT_W
      const barW = PLOT_W / NUM_BINS - 0.5
      const barH = (bins[i].count / maxBin) * PLOT_H
      ctx.fillStyle = i === hoverBin ? '#ff9800' : textSecondary
      ctx.globalAlpha = i === hoverBin ? 0.7 : 0.35
      ctx.fillRect(x, PAD.top + PLOT_H - barH, barW, barH)
    }
    ctx.globalAlpha = 1

    // CDF line
    ctx.strokeStyle = '#4fc3f7'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i < NUM_BINS; i++) {
      const x = PAD.left + ((i + 0.5) / NUM_BINS) * PLOT_W
      const y = PAD.top + PLOT_H - (bins[i].cumPct / 100) * PLOT_H
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // CDF axis labels (right side)
    ctx.fillStyle = '#4fc3f7'
    ctx.globalAlpha = 0.7
    ctx.font = '9px system-ui'
    ctx.textAlign = 'left'
    ctx.fillText('100%', PAD.left + PLOT_W + 2, PAD.top + 8)
    ctx.fillText('0%', PAD.left + PLOT_W + 2, PAD.top + PLOT_H)
    ctx.globalAlpha = 1

    // Percentile marker
    if (percentile != null && percentile < 100) {
      const pctIdx = Math.floor(n * percentile / 100)
      const pctVal = values[Math.min(pctIdx, n - 1)]
      const x = PAD.left + Math.min(pctVal / max, 1) * PLOT_W
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = '#ff9800'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x, PAD.top)
      ctx.lineTo(x, PAD.top + PLOT_H)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // X-axis tick labels
    ctx.fillStyle = textSecondary
    ctx.globalAlpha = 0.7
    ctx.font = '9px system-ui'
    ctx.textAlign = 'center'
    const ticks = [0, max / 2, max]
    for (const tick of ticks) {
      const x = PAD.left + (tick / max) * PLOT_W
      const label = `${prefix}${tick < 10 ? tick.toFixed(1) : Math.round(tick)}`
      ctx.fillText(label, x, H - 2)
    }
    ctx.globalAlpha = 1
  }, [values, bins, n, percentile, max, prefix, metricLabel, hoverBin])

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const binIdx = Math.floor(((x - PAD.left) / PLOT_W) * NUM_BINS)
    setHoverBin(binIdx >= 0 && binIdx < NUM_BINS ? binIdx : null)
  }, [])

  const onMouseLeave = useCallback(() => setHoverBin(null), [])

  if (n === 0) return null

  const hovered = hoverBin != null ? bins[hoverBin] : null

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ width: W, height: H, display: 'block', color: 'var(--text-secondary)', cursor: 'crosshair' }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      />
      {hovered && hovered.count > 0 && (
        <div style={{
          position: 'absolute',
          left: PAD.left + ((hoverBin! + 0.5) / NUM_BINS) * PLOT_W,
          top: 0,
          transform: 'translateX(-50%)',
          background: 'var(--panel-bg)',
          border: '1px solid var(--input-border)',
          borderRadius: 3,
          padding: '2px 5px',
          fontSize: 10,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          lineHeight: 1.4,
        }}>
          <div>{prefix}{hovered.lo.toFixed(1)}–{prefix}{hovered.hi.toFixed(1)}{metricLabel}</div>
          <div>{hovered.count.toLocaleString()} parcels ({hovered.cumPct.toFixed(0)}%)</div>
        </div>
      )}
    </div>
  )
}
