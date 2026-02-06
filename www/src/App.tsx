import { useState, useEffect, useCallback } from 'react'
import { Map } from 'react-map-gl/maplibre'
import DeckGL from '@deck.gl/react'
import { GeoJsonLayer } from '@deck.gl/layers'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { useUrlState, intParam, stringParam } from 'use-prms'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useParcelSearch } from './useParcelSearch'
import GradientEditor, {
  type ColorStop,
  type ScaleType,
  interpolateColor,
  encodeStops,
  decodeStops,
  DEFAULT_STOPS,
} from './GradientEditor'

const DEFAULT_VIEW = {
  latitude: 40.7178,
  longitude: -74.0431,
  zoom: 12,
  bearing: 0,
}

const AVAILABLE_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
const AGGREGATE_MODES = ['lot', 'unit', 'block'] as const
type AggregateMode = typeof AGGREGATE_MODES[number]

const HIGHLIGHT_COLOR: [number, number, number, number] = [255, 255, 100, 220]

// Custom param for color stops
const stopsParam = (defaultVal: ColorStop[]) => ({
  decode: (s: string | null) => (s ? decodeStops(s) : null) ?? defaultVal,
  encode: (v: ColorStop[]) => encodeStops(v),
})

const scaleParam = (defaultVal: ScaleType) => ({
  decode: (s: string | null) => (s as ScaleType) ?? defaultVal,
  encode: (v: ScaleType) => v,
})

// Height scale for 3D extrusion ($/sqft)
function getElevation(perSqft: number, max: number, scale: number): number {
  const capped = Math.min(perSqft, max)
  return capped * scale
}

type ParcelProperties = {
  block?: string
  lot?: string
  qual?: string
  addr?: string
  streets?: string
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
  const [settingsOpen, setSettingsOpen] = useState(true)

  // URL-persisted state
  const [year, setYear] = useUrlState('y', intParam(2025))
  const [maxPerSqft, setMaxPerSqft] = useUrlState('max', intParam(300))
  const [heightScale, setHeightScale] = useUrlState('hs', intParam(15))
  const [aggregateMode, setAggregateMode] = useUrlState('agg', stringParam('block'))
  const [colorStops, setColorStops] = useUrlState('stops', stopsParam(DEFAULT_STOPS))
  const [colorScale, setColorScale] = useUrlState('scale', scaleParam('log'))

  // Track view state locally (not in URL to avoid re-renders)
  const [viewState, setViewState] = useState({
    ...DEFAULT_VIEW,
    pitch: 45,
  })

  // Keyboard shortcuts
  useKeyboardShortcuts({
    year, setYear,
    aggregateMode, setAggregateMode,
    settingsOpen, setSettingsOpen,
  })

  // Omnibar search over parcels
  const onParcelSelect = useCallback((f: ParcelFeature) => {
    const p = f.properties
    setHoveredId(`${p?.block || ''}-${p?.lot || ''}-${p?.qual || ''}`)
    setHovered(p ?? null)
    // Pan to the selected parcel
    if (f.geometry) {
      const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
      const lngs = coords.map(c => c[0])
      const lats = coords.map(c => c[1])
      const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2
      const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2
      setViewState(v => ({ ...v, longitude: centerLng, latitude: centerLat, zoom: Math.max(v.zoom, 15) }))
    }
  }, [])
  useParcelSearch({ data, onSelect: onParcelSelect })

  // Listen for pitch changes from keyboard shortcuts
  useEffect(() => {
    const handler = (e: Event) => {
      const pitch = (e as CustomEvent).detail
      setViewState(v => ({ ...v, pitch }))
    }
    window.addEventListener('set-pitch', handler)
    return () => window.removeEventListener('set-pitch', handler)
  }, [])

  useEffect(() => {
    setLoading(true)
    const suffix = aggregateMode === 'unit' ? '-units' : aggregateMode === 'block' ? '-blocks' : '-lots'
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
    return `${p?.block || ''}-${p?.lot || ''}-${p?.qual || ''}`
  }, [])

  const getFillColor = useCallback((f: ParcelFeature): [number, number, number, number] => {
    const id = getFeatureId(f)
    if (id === hoveredId) return HIGHLIGHT_COLOR

    const perSqft = f.properties?.paid_per_sqft ?? 0
    return interpolateColor(perSqft, colorStops, maxPerSqft, colorScale)
  }, [colorStops, colorScale, maxPerSqft, hoveredId, getFeatureId])

  const layers = [
    new GeoJsonLayer<ParcelFeature>({
      id: 'parcels',
      data: data ?? [],
      filled: true,
      extruded: true,
      wireframe: true,
      getFillColor,
      getElevation: (f) => getElevation(f.properties?.paid_per_sqft ?? 0, maxPerSqft, heightScale),
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
        getFillColor: [year, maxPerSqft, colorStops, colorScale, hoveredId, aggregateMode],
        getElevation: [year, maxPerSqft, heightScale, aggregateMode],
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
          borderRadius: 4,
          fontSize: 14,
          minWidth: settingsOpen ? 240 : undefined,
          maxWidth: '90vw',
        }}
      >
        <div
          onClick={() => setSettingsOpen(v => !v)}
          style={{
            padding: '8px 15px',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            userSelect: 'none',
          }}
        >
          <span style={{ fontWeight: 'bold' }}>Settings</span>
          <span style={{ fontSize: 10 }}>{settingsOpen ? '\u25B2' : '\u25BC'}</span>
        </div>
        {settingsOpen && (
          <div style={{ padding: '0 15px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
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
            <div style={{ borderTop: '1px solid #444', paddingTop: 8, marginTop: 4 }}>
              <div style={{ marginBottom: 6, fontSize: 12, color: '#aaa' }}>Color Gradient</div>
              <GradientEditor
                stops={colorStops}
                setStops={setColorStops}
                scale={colorScale}
                setScale={setColorScale}
                max={maxPerSqft}
              />
            </div>
            <label>
              View:{' '}
              <select
                value={aggregateMode}
                onChange={(e) => setAggregateMode(e.target.value as AggregateMode)}
                style={inputStyle}
              >
                <option value="block">Blocks</option>
                <option value="lot">Lots (dissolved)</option>
                <option value="unit">Units (individual)</option>
              </select>
            </label>
            <label>
              Height scale:{' '}
              <input
                type="number"
                value={heightScale}
                onChange={(e) => setHeightScale(Number(e.target.value) || 15)}
                style={{ ...inputStyle, width: 60 }}
                min={1}
                step={5}
              />
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
        )}
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
          {hovered.addr && <div><strong>{hovered.addr}</strong></div>}
          {hovered.streets && !hovered.addr && <div><strong>{hovered.streets}</strong></div>}
          <div>Block{hovered.lot ? ': ' : ' '}{hovered.block}{hovered.lot ? `-${hovered.lot}` : ''}{hovered.qual ? `-${hovered.qual}` : ''}</div>
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
        <span style={{ marginLeft: 12, color: '#888' }}>Press <kbd style={{ background: '#444', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>?</kbd> for shortcuts, <kbd style={{ background: '#444', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>{navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl+'}K</kbd> to search</span>
      </div>
    </div>
  )
}
