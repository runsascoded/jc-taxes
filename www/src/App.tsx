import { useState, useEffect, useCallback } from 'react'
import { Map } from 'react-map-gl/maplibre'
import DeckGL from '@deck.gl/react'
import { GeoJsonLayer } from '@deck.gl/layers'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { useUrlState, intParam, stringParam } from 'use-prms'
import 'maplibre-gl/dist/maplibre-gl.css'

const DEFAULT_VIEW = {
  latitude: 40.7178,
  longitude: -74.0431,
  zoom: 12,
  bearing: 0,
}

const AVAILABLE_YEARS = [2023, 2024, 2025]
const COLOR_MODES = ['gradient', 'mono'] as const
type ColorMode = typeof COLOR_MODES[number]
const AGGREGATE_MODES = ['lot', 'unit'] as const
type AggregateMode = typeof AGGREGATE_MODES[number]

// Mono color (blue-ish)
const MONO_COLOR: [number, number, number, number] = [100, 150, 200, 180]
const HIGHLIGHT_COLOR: [number, number, number, number] = [255, 255, 100, 220]

// Color scale for $/sqft - red → orange → yellow → green
function getGradientColor(perSqft: number, max: number): [number, number, number, number] {
  const t = Math.min(perSqft / max, 1)  // 0 to 1

  // Use a multi-stop gradient: red(0) → orange(0.25) → yellow(0.5) → green(1)
  let r: number, g: number, b: number
  if (t < 0.33) {
    // Red to orange
    const s = t / 0.33
    r = 255
    g = Math.floor(100 * s)
    b = 0
  } else if (t < 0.66) {
    // Orange to yellow
    const s = (t - 0.33) / 0.33
    r = 255
    g = Math.floor(100 + 155 * s)
    b = 0
  } else {
    // Yellow to green
    const s = (t - 0.66) / 0.34
    r = Math.floor(255 * (1 - s))
    g = Math.floor(255 - 55 * s)
    b = 0
  }
  return [r, g, b, 180]
}

// Height scale for 3D extrusion ($/sqft)
function getElevation(perSqft: number, max: number): number {
  const capped = Math.min(perSqft, max)
  return capped * 15  // Scaled for reasonable heights
}

type ParcelProperties = {
  block?: string
  lot?: string
  qual?: string
  hadd?: string
  hnum?: string
  year?: number
  paid?: number
  billed?: number
  area_sqft?: number
  paid_per_sqft?: number
}

type ParcelFeature = Feature<Polygon | MultiPolygon, ParcelProperties>

export default function App() {
  const [data, setData] = useState<ParcelFeature[] | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<ParcelProperties | null>(null)
  const [loading, setLoading] = useState(true)

  // URL-persisted state
  const [year, setYear] = useUrlState('y', intParam(2024))
  const [maxPerSqft, setMaxPerSqft] = useUrlState('max', intParam(20))
  const [colorMode, setColorMode] = useUrlState('color', stringParam('gradient'))
  const [aggregateMode, setAggregateMode] = useUrlState('agg', stringParam('lot'))

  // Track view state locally (not in URL to avoid re-renders)
  const [viewState, setViewState] = useState({
    ...DEFAULT_VIEW,
    pitch: 45,
  })

  useEffect(() => {
    setLoading(true)
    const suffix = aggregateMode === 'unit' ? '-units' : ''
    fetch(`/taxes-${year}${suffix}.geojson`)
      .then((r) => r.json())
      .then((geojson) => {
        setData(geojson.features)
        setLoading(false)
      })
      .catch((e) => {
        console.error('Failed to load parcels:', e)
        setLoading(false)
      })
  }, [year, aggregateMode])

  const getFeatureId = useCallback((f: ParcelFeature) => {
    const p = f.properties
    return `${p?.block}-${p?.lot}-${p?.qual || ''}`
  }, [])

  const getFillColor = useCallback((f: ParcelFeature): [number, number, number, number] => {
    const id = getFeatureId(f)
    if (id === hoveredId) return HIGHLIGHT_COLOR

    if (colorMode === 'mono') return MONO_COLOR
    return getGradientColor(f.properties?.paid_per_sqft ?? 0, maxPerSqft)
  }, [colorMode, maxPerSqft, hoveredId, getFeatureId])

  const layers = [
    new GeoJsonLayer<ParcelFeature>({
      id: 'parcels',
      data: data ?? [],
      filled: true,
      extruded: true,
      wireframe: true,
      getFillColor,
      getElevation: (f) => getElevation(f.properties?.paid_per_sqft ?? 0, maxPerSqft),
      getLineColor: [100, 100, 100, 100],
      lineWidthMinPixels: 1,
      pickable: true,
      onHover: ({ object }) => {
        if (object) {
          setHoveredId(getFeatureId(object))
          setHovered(object.properties ?? null)
        } else {
          setHoveredId(null)
          setHovered(null)
        }
      },
      updateTriggers: {
        getFillColor: [year, maxPerSqft, colorMode, hoveredId, aggregateMode],
        getElevation: [year, maxPerSqft, aggregateMode],
      },
    }),
  ]

  const inputStyle = {
    background: '#333',
    color: 'white',
    border: '1px solid #555',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 14,
  }

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as typeof viewState)}
        controller={{ maxPitch: 85 }}
        layers={layers}
        deviceProps={{ type: 'webgl' }}
      >
        <Map
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
          maxPitch={85}
        />
      </DeckGL>

      {/* Controls */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          background: 'rgba(0,0,0,0.8)',
          color: 'white',
          padding: '10px 15px',
          borderRadius: 4,
          fontSize: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <label>
          Tax Year:{' '}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={inputStyle}
          >
            {AVAILABLE_YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label>
          Max $/sqft:{' '}
          <input
            type="number"
            value={maxPerSqft}
            onChange={(e) => setMaxPerSqft(Number(e.target.value) || 100)}
            style={{ ...inputStyle, width: 70 }}
          />
        </label>
        <label>
          Color:{' '}
          <select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as ColorMode)}
            style={inputStyle}
          >
            <option value="gradient">Gradient (red→green)</option>
            <option value="mono">Mono (blue)</option>
          </select>
        </label>
        <label>
          View:{' '}
          <select
            value={aggregateMode}
            onChange={(e) => setAggregateMode(e.target.value as AggregateMode)}
            style={inputStyle}
          >
            <option value="lot">Lots (dissolved)</option>
            <option value="unit">Units (individual)</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          Pitch: {Math.round(viewState.pitch)}°
          <input
            type="range"
            min={0}
            max={85}
            value={viewState.pitch}
            onChange={(e) => setViewState(v => ({ ...v, pitch: Number(e.target.value) }))}
            style={{ width: 80 }}
          />
        </label>
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            background: 'rgba(0,0,0,0.8)',
            color: 'white',
            padding: '10px 15px',
            borderRadius: 4,
            fontSize: 14,
            maxWidth: 300,
          }}
        >
          <div><strong>{hovered.hnum} {hovered.hadd}</strong></div>
          <div>Block: {hovered.block}-{hovered.lot}{hovered.qual ? `-${hovered.qual}` : ''}</div>
          {hovered.area_sqft !== undefined && hovered.area_sqft > 0 && (
            <div>Area: {hovered.area_sqft.toLocaleString()} sqft</div>
          )}
          {hovered.paid !== undefined && hovered.paid > 0 && (
            <div>Paid ({year}): ${hovered.paid.toLocaleString()}</div>
          )}
          {hovered.paid_per_sqft !== undefined && hovered.paid_per_sqft > 0 && (
            <div style={{ color: '#4ecdc4' }}>${hovered.paid_per_sqft.toFixed(2)}/sqft</div>
          )}
        </div>
      )}

      {/* Status bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          background: 'rgba(0,0,0,0.8)',
          color: 'white',
          padding: '8px 12px',
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        {loading ? 'Loading...' : `${data?.length.toLocaleString()} parcels`}
      </div>
    </div>
  )
}
