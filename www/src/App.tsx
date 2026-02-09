import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Map } from 'react-map-gl/maplibre'
import DeckGL from '@deck.gl/react'
import { GeoJsonLayer } from '@deck.gl/layers'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import { useUrlState, intParam, stringParam } from 'use-prms'
import type { Param } from 'use-prms'
import { KbdModal, KbdOmnibar, useHotkeysContext } from 'use-kbd'
import { resolve as dvcResolve } from 'virtual:dvc-data'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useKeyboardShortcuts, type ViewState } from './useKeyboardShortcuts'
import { useParcelSearch } from './useParcelSearch'
import { useTheme } from './ThemeContext'
import GradientEditor, {
  type ScaleType,
  interpolateColor,
} from './GradientEditor'

// Responsive default views: interpolated by viewport width
const VIEW_BREAKPOINTS: { width: number, view: ViewState }[] = [
  { width: 390,  view: { latitude: 40.6960, longitude: -74.0641, zoom: 11.5, pitch: 45, bearing: -16 } }, // phone
  { width: 820,  view: { latitude: 40.7197, longitude: -74.0506, zoom: 12.0, pitch: 45, bearing: 0 } },   // iPad
  { width: 1180, view: { latitude: 40.7153, longitude: -74.0605, zoom: 12.6, pitch: 48, bearing: -16 } }, // iPad Pro landscape
  { width: 1440, view: { latitude: 40.7177, longitude: -74.0695, zoom: 12.8, pitch: 54, bearing: -10 } }, // desktop
]

function getDefaultView(width: number): ViewState {
  if (width <= VIEW_BREAKPOINTS[0].width) return VIEW_BREAKPOINTS[0].view
  if (width >= VIEW_BREAKPOINTS[VIEW_BREAKPOINTS.length - 1].width) return VIEW_BREAKPOINTS[VIEW_BREAKPOINTS.length - 1].view
  for (let i = 0; i < VIEW_BREAKPOINTS.length - 1; i++) {
    const lo = VIEW_BREAKPOINTS[i], hi = VIEW_BREAKPOINTS[i + 1]
    if (width >= lo.width && width <= hi.width) {
      const t = (width - lo.width) / (hi.width - lo.width)
      return {
        latitude: lo.view.latitude + t * (hi.view.latitude - lo.view.latitude),
        longitude: lo.view.longitude + t * (hi.view.longitude - lo.view.longitude),
        zoom: lo.view.zoom + t * (hi.view.zoom - lo.view.zoom),
        pitch: lo.view.pitch + t * (hi.view.pitch - lo.view.pitch),
        bearing: lo.view.bearing + t * (hi.view.bearing - lo.view.bearing),
      }
    }
  }
  return VIEW_BREAKPOINTS[VIEW_BREAKPOINTS.length - 1].view
}

const DEFAULT_VIEW = getDefaultView(window.innerWidth)

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

const viewParam: Param<ViewState> = {
  encode: encodeView,
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
  const kbdCtx = useHotkeysContext()
  const [data, setData] = useState<ParcelFeature[] | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<ParcelProperties | null>(null)
  const [selectedId, setSelectedId] = useUrlState('sel', stringParam())
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(() => window.innerWidth > 768)

  // URL-persisted state
  const [year, setYear] = useUrlState('y', intParam(2025))
  const [maxPerSqft, setMaxPerSqft] = useUrlState('max', intParam(300))
  const [heightScale, setHeightScale] = useUrlState('hs', intParam(15))
  const [aggregateMode, setAggregateMode] = useUrlState('agg', stringParam('block'))
  const [colorScale, setColorScale] = useUrlState('scale', scaleParam('log'))

  // URL is source of truth for initial load; local state for smooth rendering
  const [urlView, setUrlView] = useUrlState('v', viewParam)
  const [viewState, setViewState] = useState<ViewState>(urlView)
  // Debounce URL writes whenever viewState changes (from any source).
  // Skip while omnibar is open: the synthetic popstate from replaceState
  // races with use-kbd's history pushState and can close the omnibar.
  const setUrlViewRef = useRef(setUrlView)
  setUrlViewRef.current = setUrlView
  const omnibarOpenRef = useRef(false)
  omnibarOpenRef.current = !!kbdCtx?.isOmnibarOpen
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!omnibarOpenRef.current) setUrlViewRef.current(viewState)
    }, 300)
    return () => clearTimeout(timer)
  }, [viewState])

  const { actualTheme, toggleTheme, colorStops, setColorStops, resetColorStops } = useTheme()

  // Keyboard shortcuts
  useKeyboardShortcuts({
    year, setYear,
    aggregateMode, setAggregateMode,
    settingsOpen, setSettingsOpen,
    setViewState,
    toggleTheme,
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
          setSelectedId(id === selectedIdRef.current ? undefined : id)
          return true  // handled — prevent DeckGL onClick from also firing
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
        onClick={({ object }) => {
          if (!object && !kbdCtx?.isOmnibarOpen) setSelectedId(undefined)
          if (window.innerWidth <= 768) setSettingsOpen(false)
        }}
        controller={{ maxPitch: 85, touchRotate: true }}
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
          zIndex: 1,
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
        {window.innerWidth > 768 && (
          <span style={{ marginLeft: 12, color: 'var(--text-secondary)' }}>
            Press <KbdModal /> for shortcuts, <KbdOmnibar /> to search
          </span>
        )}
      </div>
    </div>
  )
}
