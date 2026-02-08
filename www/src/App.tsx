import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Map } from 'react-map-gl/maplibre'
import DeckGL from '@deck.gl/react'
import { GeoJsonLayer } from '@deck.gl/layers'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { useUrlState, intParam, stringParam } from 'use-prms'
import type { Param } from 'use-prms'
import { resolve as dvcResolve } from 'virtual:dvc-data'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useKeyboardShortcuts, type ViewState } from './useKeyboardShortcuts'
import { useParcelSearch } from './useParcelSearch'
import { useTheme } from './ThemeContext'
import GradientEditor, {
  type ScaleType,
  interpolateColor,
} from './GradientEditor'

const DEFAULT_VIEW: ViewState = {
  latitude: 40.7178,
  longitude: -74.0431,
  zoom: 12,
  pitch: 45,
  bearing: 0,
}

function encodeView(v: ViewState): string {
  const parts = [
    v.latitude.toFixed(4),
    v.longitude.toFixed(4),
    v.zoom.toFixed(1),
    String(Math.round(v.pitch)),
    String(Math.round(v.bearing)),
  ]
  let result = parts[0]
  for (let i = 1; i < parts.length; i++) {
    if (!parts[i].startsWith('-')) result += ' '
    result += parts[i]
  }
  return result
}

const DEFAULT_VIEW_ENCODED = encodeView(DEFAULT_VIEW)

const viewParam: Param<ViewState> = {
  encode: (v: ViewState) => {
    const encoded = encodeView(v)
    return encoded === DEFAULT_VIEW_ENCODED ? undefined : encoded
  },
  decode: (s: string | undefined) => {
    if (!s) return DEFAULT_VIEW
    const matches = s.match(/-?\d+\.?\d*/g)
    if (!matches || matches.length < 5) return DEFAULT_VIEW
    const nums = matches.map(Number)
    if (nums.some(isNaN)) return DEFAULT_VIEW
    return {
      latitude: nums[0],
      longitude: nums[1],
      zoom: nums[2],
      pitch: nums[3],
      bearing: nums[4],
    }
  },
}

const AVAILABLE_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
const AGGREGATE_MODES = ['lot', 'unit', 'block'] as const
type AggregateMode = typeof AGGREGATE_MODES[number]

const HIGHLIGHT_COLOR: [number, number, number, number] = [255, 255, 100, 220]

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
  const [selectedId, setSelectedId] = useUrlState('sel', stringParam())
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(true)

  // URL-persisted state
  const [year, setYear] = useUrlState('y', intParam(2025))
  const [maxPerSqft, setMaxPerSqft] = useUrlState('max', intParam(300))
  const [heightScale, setHeightScale] = useUrlState('hs', intParam(15))
  const [aggregateMode, setAggregateMode] = useUrlState('agg', stringParam('block'))
  const [colorScale, setColorScale] = useUrlState('scale', scaleParam('log'))

  // URL is source of truth for initial load; local state for smooth rendering
  const [urlView, setUrlView] = useUrlState('v', viewParam)
  const [viewState, setViewState] = useState<ViewState>(urlView)
  // Debounce URL writes whenever viewState changes (from any source)
  const setUrlViewRef = useRef(setUrlView)
  setUrlViewRef.current = setUrlView
  useEffect(() => {
    const timer = setTimeout(() => setUrlViewRef.current(viewState), 300)
    return () => clearTimeout(timer)
  }, [viewState])

  // Keyboard shortcuts
  useKeyboardShortcuts({
    year, setYear,
    aggregateMode, setAggregateMode,
    settingsOpen, setSettingsOpen,
    setViewState,
  })

  // Omnibar search over parcels
  const onParcelSelect = useCallback((f: ParcelFeature) => {
    setSelectedId(getFeatureId(f))
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

  useEffect(() => {
    setLoading(true)
    const suffix = aggregateMode === 'unit' ? '-units' : aggregateMode === 'block' ? '-blocks' : '-lots'
    fetch(dvcResolve(`taxes-${year}${suffix}.geojson`))
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
    return `${p?.block || ''}-${p?.lot || ''}-${p?.qual || ''}`.replace(/-+$/, '')
  }, [])

  const selected = useMemo(() => {
    if (!selectedId || !data) return null
    const feature = data.find(f => getFeatureId(f) === selectedId)
    return feature?.properties ?? null
  }, [selectedId, data, getFeatureId])

  const { actualTheme, colorStops, setColorStops, resetColorStops } = useTheme()
  const mapStyle = actualTheme === 'dark'
    ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
    : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

  const fillAlpha = actualTheme === 'dark' ? 180 : 220
  const lineColor: [number, number, number, number] = actualTheme === 'dark'
    ? [100, 100, 100, 100]
    : [60, 60, 60, 160]

  const getFillColor = useCallback((f: ParcelFeature): [number, number, number, number] => {
    const id = getFeatureId(f)
    if (id === selectedId || id === hoveredId) return HIGHLIGHT_COLOR

    const perSqft = f.properties?.paid_per_sqft ?? 0
    return interpolateColor(perSqft, colorStops, maxPerSqft, colorScale, fillAlpha)
  }, [colorStops, colorScale, maxPerSqft, hoveredId, selectedId, getFeatureId, fillAlpha])

  const layers = [
    new GeoJsonLayer<ParcelFeature>({
      id: 'parcels',
      data: data ?? [],
      filled: true,
      extruded: true,
      wireframe: true,
      getFillColor,
      getElevation: (f) => getElevation(f.properties?.paid_per_sqft ?? 0, maxPerSqft, heightScale),
      getLineColor: lineColor,
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
      onClick: ({ object }) => {
        if (object) {
          const id = getFeatureId(object)
          setSelectedId(id === selectedId ? undefined : id)
        } else {
          setSelectedId(undefined)
        }
      },
      updateTriggers: {
        getFillColor: [year, maxPerSqft, colorStops, colorScale, hoveredId, selectedId, aggregateMode, actualTheme],
        getElevation: [year, maxPerSqft, heightScale, aggregateMode],
        getLineColor: [actualTheme],
      },
    }),
  ]

  const inputStyle = {
    background: 'var(--input-bg)',
    color: 'var(--text-primary)',
    border: '1px solid var(--input-border)',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 14,
  }

  return (
    <div style={{ width: '100vw', height: '100vh', WebkitTouchCallout: 'none' }} onContextMenu={e => e.preventDefault()}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => {
          const { latitude, longitude, zoom, pitch, bearing } = vs as ViewState
          setViewState({ latitude, longitude, zoom, pitch, bearing })
        }}
        controller={{ maxPitch: 85 }}
        layers={layers}
        deviceProps={{ type: 'webgl' }}
      >
        <Map
          mapStyle={mapStyle}
          maxPitch={85}
        />
      </DeckGL>

      {/* Controls */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          background: 'var(--panel-bg)',
          color: 'var(--text-primary)',
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
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
              <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--text-secondary)' }}>Color Gradient</div>
              <GradientEditor
                stops={colorStops}
                setStops={setColorStops}
                scale={colorScale}
                setScale={setColorScale}
                max={maxPerSqft}
                onReset={resetColorStops}
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

      {/* Hover/selected tooltip */}
      {(hovered || selected) && (() => {
        const info = hovered ?? selected!
        return (
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              background: 'var(--panel-bg)',
              color: 'var(--text-primary)',
              padding: '10px 15px',
              borderRadius: 4,
              fontSize: 14,
              maxWidth: 300,
            }}
          >
            {info.addr && <div><strong>{info.addr}</strong></div>}
            {info.streets && !info.addr && <div><strong>{info.streets}</strong></div>}
            <div>Block{info.lot ? ': ' : ' '}{info.block}{info.lot ? `-${info.lot}` : ''}{info.qual ? `-${info.qual}` : ''}</div>
            {info.area_sqft !== undefined && info.area_sqft > 0 && (
              <div>Area: {info.area_sqft.toLocaleString()} sqft</div>
            )}
            {info.paid !== undefined && info.paid > 0 && (
              <div>Paid ({year}): ${info.paid.toLocaleString()}</div>
            )}
            {info.paid_per_sqft !== undefined && info.paid_per_sqft > 0 && (
              <div style={{ color: 'var(--text-accent)' }}>${info.paid_per_sqft.toFixed(2)}/sqft</div>
            )}
          </div>
        )
      })()}

      {/* Status bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          background: 'var(--panel-bg)',
          color: 'var(--text-primary)',
          padding: '8px 12px',
          borderRadius: 4,
          fontSize: 12,
        }}
      >
        {loading ? 'Loading...' : `${data?.length.toLocaleString()} parcels`}
        <span style={{ marginLeft: 12, color: 'var(--text-secondary)' }}>Press <kbd style={{ background: 'var(--input-bg)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>?</kbd> for shortcuts, <kbd style={{ background: 'var(--input-bg)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>{navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl+'}K</kbd> to search</span>
      </div>
    </div>
  )
}
