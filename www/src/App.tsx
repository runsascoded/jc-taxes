import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Map } from 'react-map-gl/maplibre'
import DeckGL from '@deck.gl/react'
import { GeoJsonLayer } from '@deck.gl/layers'
import { useUrlState, intParam, stringParam } from 'use-prms'
import type { Param } from 'use-prms'
import { KbdModal, KbdOmnibar, useHotkeysContext } from 'use-kbd'
import { resolve as dvcResolve } from 'virtual:dvc-data'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useKeyboardShortcuts, type ViewState } from './useKeyboardShortcuts'
import { useTouchPitch } from './useTouchPitch'
import { useParcelSearch } from './useParcelSearch'
import { useTheme } from './ThemeContext'
import GradientEditor, {
  type ScaleType,
  type ColorStop,
  interpolateColor,
} from './GradientEditor'
import type { ParcelProperties, ParcelFeature } from './types'

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
const AGGREGATE_MODES = ['block', 'lot', 'unit', 'census-block', 'ward'] as const
type AggregateMode = typeof AGGREGATE_MODES[number]
const SUFFIX_MAP: Record<string, string> = {
  unit: '-units',
  block: '-blocks',
  lot: '-lots',
  'census-block': '-census-blocks',
  ward: '-wards',
}
type MetricMode = 'per_sqft' | 'per_capita'

// Per-mode defaults for color max and height scale
// hs calibrated so tallest bar ≈ 5000 deck.gl meters
function getModeKey(agg: string, metric: string): string {
  if (agg === 'census-block' || agg === 'ward') return `${agg}:${metric}`
  return agg
}
// Per-mode color stops: values positioned to differentiate actual data distribution
// per_sqft: data skewed near zero → stops at ~1-7% of max
// per_capita: data more spread → stops at ~25-75% of max
type ModeConfig = {
  max: number
  hs: number
  stops?: { dark: ColorStop[], light: ColorStop[] }
}
const MODE_DEFAULTS: Record<string, ModeConfig> = {
  'block':                  { max: 300,   hs: 15 },
  'lot':                    { max: 300,   hs: 15 },
  'unit':                   { max: 300,   hs: 15 },
  'census-block:per_sqft':  { max: 20, hs: 100, stops: {
    dark:  [{ value: 0, color: [96, 96, 96] }, { value: 1.5, color: [255, 0, 0] }, { value: 12, color: [0, 255, 0] }],
    light: [{ value: 0, color: [255, 255, 255] }, { value: 1.5, color: [255, 71, 71] }, { value: 12, color: [0, 214, 0] }],
  }},
  'census-block:per_capita':{ max: 15000, hs: 0.3, stops: {
    dark:  [{ value: 0, color: [96, 96, 96] }, { value: 3000, color: [255, 0, 0] }, { value: 10000, color: [0, 255, 0] }],
    light: [{ value: 0, color: [255, 255, 255] }, { value: 3000, color: [255, 71, 71] }, { value: 10000, color: [0, 214, 0] }],
  }},
  'ward:per_sqft':          { max: 10, hs: 550, stops: {
    dark:  [{ value: 0, color: [96, 96, 96] }, { value: 2.5, color: [255, 0, 0] }, { value: 7, color: [0, 255, 0] }],
    light: [{ value: 0, color: [255, 255, 255] }, { value: 2.5, color: [255, 71, 71] }, { value: 7, color: [0, 214, 0] }],
  }},
  'ward:per_capita':        { max: 9000, hs: 0.6, stops: {
    dark:  [{ value: 0, color: [96, 96, 96] }, { value: 2500, color: [255, 0, 0] }, { value: 7000, color: [0, 255, 0] }],
    light: [{ value: 0, color: [255, 255, 255] }, { value: 2500, color: [255, 71, 71] }, { value: 7000, color: [0, 214, 0] }],
  }},
}
const SS_PREFIX = 'jc-taxes:'

function ssSave(key: string, max: number, hs: number) {
  sessionStorage.setItem(`${SS_PREFIX}${key}:max`, String(max))
  sessionStorage.setItem(`${SS_PREFIX}${key}:hs`, String(hs))
}
function ssLoad(key: string): { max: number, hs: number } | null {
  const m = sessionStorage.getItem(`${SS_PREFIX}${key}:max`)
  const h = sessionStorage.getItem(`${SS_PREFIX}${key}:hs`)
  if (m == null || h == null) return null
  return { max: Number(m), hs: Number(h) }
}

const HOVER_COLOR: [number, number, number, number] = [255, 255, 100, 220]
const SELECTED_COLOR: [number, number, number, number] = [100, 200, 255, 230]

const scaleParam = (defaultVal: ScaleType) => ({
  decode: (s: string | null) => (s as ScaleType) ?? defaultVal,
  encode: (v: ScaleType) => v,
})

const optNumParam: Param<number | undefined> = {
  decode: (s: string | undefined) => {
    if (s == null) return undefined
    const n = Number(s)
    return isNaN(n) ? undefined : n
  },
  encode: (v: number | undefined) => v == null ? undefined as unknown as string : String(v),
}

export default function App() {
  const kbdCtx = useHotkeysContext()
  const [data, setData] = useState<ParcelFeature[] | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hovered, setHovered] = useState<ParcelProperties | null>(null)
  const suppressHoverRef = useRef(false)
  const [webglError, setWebglError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useUrlState('sel', stringParam())
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(() => window.innerWidth > 768)

  // URL-persisted state (max/hs are optional; absent = use mode defaults)
  const [year, setYear] = useUrlState('y', intParam(2025))
  const [maxValRaw, setMaxValRaw] = useUrlState('max', optNumParam)
  const [heightScaleRaw, setHeightScaleRaw] = useUrlState('hs', optNumParam)
  const [aggregateMode, setAggregateModeRaw] = useUrlState('agg', stringParam('block'))
  const [colorScale, setColorScale] = useUrlState('scale', scaleParam('log'))
  const [metricMode, setMetricModeRaw] = useUrlState('metric', stringParam('per_sqft'))

  const hasPopulation = aggregateMode === 'census-block' || aggregateMode === 'ward'
  const modeKey = getModeKey(aggregateMode, metricMode)
  const modeConf = MODE_DEFAULTS[modeKey] ?? MODE_DEFAULTS['block']

  // Effective max/hs: URL value if explicitly set, else mode default
  const maxVal = maxValRaw ?? modeConf.max
  const heightScale = heightScaleRaw ?? modeConf.hs
  // Setters: write to URL only when value differs from mode default
  const setMaxVal = useCallback((v: number) => {
    setMaxValRaw(v === modeConf.max ? undefined : v)
  }, [modeConf.max, setMaxValRaw])
  const setHeightScale = useCallback((v: number) => {
    setHeightScaleRaw(v === modeConf.hs ? undefined : v)
  }, [modeConf.hs, setHeightScaleRaw])

  // Color stops: use custom (from URL `c`) → mode-specific → theme defaults
  const { actualTheme, toggleTheme, colorStops: themeStops, hasCustomStops, setColorStops, resetColorStops: resetColorStopsRaw } = useTheme()
  const modeStops = useMemo(() => {
    if (modeConf.stops) return actualTheme === 'light' ? modeConf.stops.light : modeConf.stops.dark
    return null
  }, [modeConf, actualTheme])
  const colorStops = hasCustomStops ? themeStops : (modeStops ?? themeStops)

  // Reset: clear custom stops from URL; mode stops or theme defaults will apply
  const resetColorStops = useCallback(() => {
    resetColorStopsRaw()
  }, [resetColorStopsRaw])

  // Mode-aware switching: save customizations to SS, clear URL params for new mode
  const switchToMode = useCallback((newAgg: string, newMetric: string) => {
    // Save current customizations to SS (only if user changed from defaults)
    if (maxValRaw != null || heightScaleRaw != null) {
      const oldKey = getModeKey(aggregateMode, metricMode)
      ssSave(oldKey, maxVal, heightScale)
    }

    // Reset metric to per_sqft for non-census modes
    const effectiveMetric = (newAgg === 'census-block' || newAgg === 'ward') ? newMetric : 'per_sqft'
    const newKey = getModeKey(newAgg, effectiveMetric)

    // Restore from SS if user previously customized this mode, else clear (use defaults)
    const saved = ssLoad(newKey)
    setMaxValRaw(saved ? saved.max : undefined)
    setHeightScaleRaw(saved ? saved.hs : undefined)

    // Clear custom color stops; mode stops or theme defaults will apply
    if (hasCustomStops) resetColorStopsRaw()
  }, [aggregateMode, metricMode, maxVal, heightScale, maxValRaw, heightScaleRaw, hasCustomStops, resetColorStopsRaw])

  const setAggregateMode = useCallback((newAgg: string) => {
    const newMetric = (newAgg === 'census-block' || newAgg === 'ward') ? metricMode : 'per_sqft'
    switchToMode(newAgg, newMetric)
    setAggregateModeRaw(newAgg)
    if (!(newAgg === 'census-block' || newAgg === 'ward') && metricMode === 'per_capita') {
      setMetricModeRaw('per_sqft')
    }
  }, [switchToMode, metricMode])

  const setMetricMode = useCallback((newMetric: string) => {
    switchToMode(aggregateMode, newMetric)
    setMetricModeRaw(newMetric)
  }, [switchToMode, aggregateMode])

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

  // Keyboard shortcuts
  useKeyboardShortcuts({
    year, setYear,
    aggregateMode, setAggregateMode,
    hasPopulation, metricMode, setMetricMode,
    settingsOpen, setSettingsOpen,
    setViewState,
    toggleTheme,
  })

  // Two-finger pitch gesture for mobile (deck.gl's built-in multipan is broken)
  const isPitchingRef = useTouchPitch({ setViewState, maxPitch: 85 })

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
    const suffix = SUFFIX_MAP[aggregateMode] ?? '-lots'
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
    if (p?.geoid) return p.geoid
    if (p?.ward && !p?.block) return `ward-${p.ward}`
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

  const getMetricValue = useCallback((f: ParcelFeature): number => {
    const p = f.properties
    if (metricMode === 'per_capita') return p?.paid_per_capita ?? 0
    return p?.paid_per_sqft ?? 0
  }, [metricMode])

  const getFillColor = useCallback((f: ParcelFeature): [number, number, number, number] => {
    const id = getFeatureId(f)
    if (id === selectedId) return SELECTED_COLOR
    if (id === hoveredId) return HOVER_COLOR

    return interpolateColor(getMetricValue(f), colorStops, maxVal, colorScale, fillAlpha)
  }, [colorStops, colorScale, maxVal, hoveredId, selectedId, getFeatureId, fillAlpha, getMetricValue])

  const layers = [
    new GeoJsonLayer<ParcelFeature>({
      id: 'parcels',
      data: data ?? [],
      filled: true,
      extruded: true,
      wireframe: true,
      getFillColor,
      getElevation: (f) => getMetricValue(f) * heightScale,
      getLineColor: lineColor,
      lineWidthMinPixels: 1,
      pickable: true,
      onHover: ({ object }) => {
        if (suppressHoverRef.current) return
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
          suppressHoverRef.current = true
          setHoveredId(null)
          setHovered(null)
          setTimeout(() => { suppressHoverRef.current = false }, 100)
          return true
        }
      },
      updateTriggers: {
        getFillColor: [year, maxVal, colorStops, colorScale, hoveredId, selectedId, aggregateMode, actualTheme, metricMode],
        getElevation: [year, heightScale, aggregateMode, metricMode],
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
          if (isPitchingRef.current) return
          const { latitude, longitude, zoom, pitch, bearing } = vs as ViewState
          setViewState({ latitude, longitude, zoom, pitch, bearing })
        }}
        onClick={({ object }) => {
          if (!object && !kbdCtx?.isOmnibarOpen) {
            setSelectedId(undefined)
            suppressHoverRef.current = true
            setHoveredId(null)
            setHovered(null)
            setTimeout(() => { suppressHoverRef.current = false }, 100)
          }
          if (window.innerWidth <= 768) setSettingsOpen(false)
        }}
        onError={(error: Error) => {
          console.error('DeckGL error:', error)
          setWebglError(error.message)
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
              Max ${metricMode === 'per_capita' ? '/capita' : '/sqft'}:{' '}
              <input
                type="number"
                value={maxVal}
                onChange={(e) => setMaxVal(Number(e.target.value) || 100)}
                style={{ ...inputStyle, width: 80 }}
              />
            </label>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
              <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--text-secondary)' }}>Color Gradient</div>
              <GradientEditor
                stops={colorStops}
                setStops={setColorStops}
                scale={colorScale}
                setScale={setColorScale}
                max={maxVal}
                onReset={resetColorStops}
                metricLabel={metricMode === 'per_capita' ? '/capita' : '/sqft'}
              />
            </div>
            <label>
              View:{' '}
              <select
                value={aggregateMode}
                onChange={(e) => setAggregateMode(e.target.value as AggregateMode)}
                style={inputStyle}
              >
                <option value="ward">Wards</option>
                <option value="census-block">Census Blocks</option>
                <option value="block">Blocks</option>
                <option value="lot">Lots (dissolved)</option>
                <option value="unit">Units (individual)</option>
              </select>
            </label>
            {hasPopulation && (
              <label>
                Metric:{' '}
                <select
                  value={metricMode}
                  onChange={(e) => setMetricMode(e.target.value as MetricMode)}
                  style={inputStyle}
                >
                  <option value="per_sqft">$/sqft</option>
                  <option value="per_capita">$/capita</option>
                </select>
              </label>
            )}
            <label>
              Height scale:{' '}
              <input
                type="number"
                value={heightScale}
                onChange={(e) => setHeightScale(Number(e.target.value) || 1)}
                style={{ ...inputStyle, width: 70 }}
                min={0.01}
                step={heightScale < 1 ? 0.1 : heightScale < 10 ? 1 : 5}
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
        const isCensus = !!info.geoid || (!!info.ward && !info.block)
        const sqftActive = metricMode === 'per_sqft'
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
            {isCensus ? (
              <>
                {info.ward && !info.block && (
                  <div><strong>Ward {info.ward}{info.council_person ? ` (${info.council_person})` : ''}</strong></div>
                )}
                {info.geoid && (
                  <div><strong>Census Block {info.geoid}</strong></div>
                )}
                {info.geoid && info.ward && <div>Ward {info.ward}</div>}
                {info.population !== undefined && (
                  <div>Population: {info.population.toLocaleString()}</div>
                )}
              </>
            ) : (
              <>
                {info.addr && <div><strong>{info.addr}</strong></div>}
                {info.streets && !info.addr && <div><strong>{info.streets}</strong></div>}
                <div>Block{info.lot ? ': ' : ' '}{info.block}{info.lot ? `-${info.lot}` : ''}{info.qual ? `-${info.qual}` : ''}</div>
              </>
            )}
            {info.area_sqft !== undefined && info.area_sqft > 0 && (
              <div>Area: {info.area_sqft.toLocaleString()} sqft</div>
            )}
            {info.paid !== undefined && info.paid > 0 && (
              <div>Paid ({year}): ${info.paid.toLocaleString()}</div>
            )}
            {info.paid_per_sqft !== undefined && info.paid_per_sqft > 0 && (
              <div style={{ color: sqftActive ? 'var(--text-accent)' : undefined }}>
                ${info.paid_per_sqft.toFixed(2)}/sqft
              </div>
            )}
            {info.paid_per_capita !== undefined && info.paid_per_capita > 0 && (
              <div style={{ color: !sqftActive ? 'var(--text-accent)' : undefined }}>
                ${info.paid_per_capita.toLocaleString()}/capita
              </div>
            )}
          </div>
        )
      })()}

      {webglError && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'rgba(0,0,0,0.9)', color: '#ff6b6b', padding: '20px 30px',
          borderRadius: 8, fontSize: 16, maxWidth: '80vw', zIndex: 9999, textAlign: 'center',
        }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>WebGL Error</div>
          <div style={{ fontSize: 14, color: '#ccc' }}>{webglError}</div>
        </div>
      )}

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
