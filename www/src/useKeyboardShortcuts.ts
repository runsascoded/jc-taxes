import { useAction } from 'use-kbd'
import type { Dispatch, SetStateAction } from 'react'

const AVAILABLE_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]

export type ViewState = {
  latitude: number
  longitude: number
  zoom: number
  pitch: number
  bearing: number
}

const WARD_GEOMS = ['merged', 'blocks', 'lots', 'boundary'] as const

// Pan increment per step (degrees longitude/latitude at zoom ~12)
const PAN_STEP = 0.005

type Props = {
  year: number
  setYear: (y: number) => void
  aggregateMode: string
  setAggregateMode: (m: string) => void
  hasPopulation: boolean
  metricMode: string
  setMetricMode: (m: string) => void
  settingsOpen: boolean
  setSettingsOpen: (v: boolean | ((v: boolean) => boolean)) => void
  setViewState: Dispatch<SetStateAction<ViewState>>
  maxHeight: number
  setMaxHeightRaw: (v: number | undefined) => void
  modeMaxHeight: number
  toggleTheme: () => void
  wardLabels: boolean
  setWardLabels: (v: boolean) => void
  wardGeom: string
  setWardGeom: (v: string) => void
}

export function useKeyboardShortcuts({
  year,
  setYear,
  aggregateMode,
  setAggregateMode,
  hasPopulation,
  metricMode,
  setMetricMode,
  settingsOpen,
  setSettingsOpen,
  setViewState,
  maxHeight,
  setMaxHeightRaw,
  modeMaxHeight,
  toggleTheme,
  wardLabels,
  setWardLabels,
  wardGeom,
  setWardGeom,
}: Props) {
  const isWardMode = aggregateMode === 'ward'
  const yearIdx = AVAILABLE_YEARS.indexOf(year)

  // Year navigation: [ and ] to avoid arrow-key conflict with viewport panning
  useAction('year:prev', {
    label: 'Previous year',
    group: 'Navigation',
    defaultBindings: ['['],
    enabled: yearIdx > 0,
    handler: () => {
      if (yearIdx > 0) setYear(AVAILABLE_YEARS[yearIdx - 1])
    },
  })

  useAction('year:next', {
    label: 'Next year',
    group: 'Navigation',
    defaultBindings: [']'],
    enabled: yearIdx < AVAILABLE_YEARS.length - 1,
    handler: () => {
      if (yearIdx < AVAILABLE_YEARS.length - 1) setYear(AVAILABLE_YEARS[yearIdx + 1])
    },
  })

  useAction('view:blocks', {
    label: 'Block view',
    group: 'Navigation',
    defaultBindings: ['b'],
    handler: () => setAggregateMode('block'),
  })

  useAction('view:lots', {
    label: 'Lot view',
    group: 'Navigation',
    defaultBindings: ['l'],
    handler: () => setAggregateMode('lot'),
  })

  useAction('view:units', {
    label: 'Unit view',
    group: 'Navigation',
    defaultBindings: ['u'],
    handler: () => setAggregateMode('unit'),
  })

  useAction('theme:toggle', {
    label: 'Toggle theme',
    group: 'UI',
    defaultBindings: ['t'],
    handler: toggleTheme,
  })

  useAction('settings:toggle', {
    label: 'Toggle settings panel',
    group: 'UI',
    defaultBindings: ['s'],
    handler: () => setSettingsOpen((v: boolean) => !v),
  })

  useAction('view:flat', {
    label: 'Flat view (pitch 0)',
    group: 'UI',
    defaultBindings: ['f'],
    handler: () => setViewState(v => ({ ...v, pitch: 0 })),
  })

  useAction('view:census-blocks', {
    label: 'Census block view',
    group: 'Navigation',
    defaultBindings: ['c'],
    handler: () => setAggregateMode('census-block'),
  })

  useAction('view:wards', {
    label: 'Ward view',
    group: 'Navigation',
    defaultBindings: ['w'],
    handler: () => setAggregateMode('ward'),
  })

  useAction('metric:toggle', {
    label: 'Toggle metric ($/sqft ↔ $/capita)',
    group: 'Navigation',
    defaultBindings: ['m'],
    enabled: hasPopulation,
    handler: () => setMetricMode(metricMode === 'per_sqft' ? 'per_capita' : 'per_sqft'),
  })

  useAction('view:3d', {
    label: '3D view (pitch 45)',
    group: 'UI',
    defaultBindings: ['d'],
    handler: () => setViewState(v => ({ ...v, pitch: 45 })),
  })

  // Pitch: p N or N p → set absolute pitch; shift+up/down to nudge
  useAction('view:pitch', {
    label: 'Set pitch (degrees)',
    group: 'Viewport',
    defaultBindings: ['p \\d+', '\\d+ p'],
    handler: (_e, captures) => {
      const deg = Math.min(85, Math.max(0, captures?.[0] ?? 45))
      setViewState(v => ({ ...v, pitch: deg }))
    },
  })

  useAction('view:pitch-up', {
    label: 'Increase pitch (degrees)',
    group: 'Viewport',
    defaultBindings: ['shift+arrowdown', '\\f shift+arrowdown'],
    handler: (_e, captures) => {
      const deg = captures?.[0] ?? 5
      setViewState(v => ({ ...v, pitch: Math.min(85, v.pitch + deg) }))
    },
  })

  useAction('view:pitch-down', {
    label: 'Decrease pitch (degrees)',
    group: 'Viewport',
    defaultBindings: ['shift+arrowup', '\\f shift+arrowup'],
    handler: (_e, captures) => {
      const deg = captures?.[0] ?? 5
      setViewState(v => ({ ...v, pitch: Math.max(0, v.pitch - deg) }))
    },
  })

  // Rotate: shift+left/right (plain = 5°, or N shift+arrow for N degrees)
  useAction('view:rotate-cw', {
    label: 'Rotate CW (degrees)',
    group: 'Viewport',
    defaultBindings: ['shift+arrowleft', '\\f shift+arrowleft'],
    handler: (_e, captures) => {
      const deg = captures?.[0] ?? 5
      setViewState(v => ({ ...v, bearing: v.bearing + deg }))
    },
  })

  useAction('view:rotate-ccw', {
    label: 'Rotate CCW (degrees)',
    group: 'Viewport',
    defaultBindings: ['shift+arrowright', '\\f shift+arrowright'],
    handler: (_e, captures) => {
      const deg = captures?.[0] ?? 5
      setViewState(v => ({ ...v, bearing: v.bearing - deg }))
    },
  })

  // Pan: arrow keys (plain or with N-step prefix)
  useAction('view:pan-left', {
    label: 'Pan left (N steps)',
    group: 'Viewport',
    defaultBindings: ['arrowleft', '\\d+ arrowleft'],
    handler: (_e, captures) => {
      const n = captures?.[0] ?? 1
      setViewState(v => ({ ...v, longitude: v.longitude - PAN_STEP * n }))
    },
  })

  useAction('view:pan-right', {
    label: 'Pan right (N steps)',
    group: 'Viewport',
    defaultBindings: ['arrowright', '\\d+ arrowright'],
    handler: (_e, captures) => {
      const n = captures?.[0] ?? 1
      setViewState(v => ({ ...v, longitude: v.longitude + PAN_STEP * n }))
    },
  })

  useAction('view:pan-up', {
    label: 'Pan up (N steps)',
    group: 'Viewport',
    defaultBindings: ['arrowup', '\\d+ arrowup'],
    handler: (_e, captures) => {
      const n = captures?.[0] ?? 1
      setViewState(v => ({ ...v, latitude: v.latitude + PAN_STEP * n }))
    },
  })

  useAction('view:pan-down', {
    label: 'Pan down (N steps)',
    group: 'Viewport',
    defaultBindings: ['arrowdown', '\\d+ arrowdown'],
    handler: (_e, captures) => {
      const n = captures?.[0] ?? 1
      setViewState(v => ({ ...v, latitude: v.latitude - PAN_STEP * n }))
    },
  })

  // Height: h N or N h → set max height to N km (converted to meters)
  useAction('view:height', {
    label: 'Set max height (km)',
    group: 'Viewport',
    defaultBindings: ['h \\f', '\\f h'],
    handler: (_e, captures) => {
      const km = captures?.[0] ?? Math.round(modeMaxHeight / 1000)
      const m = km * 1000
      setMaxHeightRaw(m === modeMaxHeight ? undefined : m)
    },
  })

  // Zoom: - to zoom out, = to zoom in
  useAction('view:zoom-out', {
    label: 'Zoom out',
    group: 'Viewport',
    defaultBindings: ['-'],
    handler: () => setViewState(v => ({ ...v, zoom: Math.max(0, v.zoom - 0.2) })),
  })

  useAction('view:zoom-in', {
    label: 'Zoom in',
    group: 'Viewport',
    defaultBindings: ['='],
    handler: () => setViewState(v => ({ ...v, zoom: Math.min(24, v.zoom + 0.2) })),
  })

  useAction('ward:labels', {
    label: 'Toggle ward labels',
    group: 'Wards',
    defaultBindings: ['shift+l'],
    enabled: isWardMode,
    handler: () => setWardLabels(!wardLabels),
  })

  useAction('ward:geom', {
    label: 'Cycle ward geometry',
    group: 'Wards',
    defaultBindings: ['g'],
    enabled: isWardMode,
    handler: () => {
      const idx = WARD_GEOMS.indexOf(wardGeom as typeof WARD_GEOMS[number])
      setWardGeom(WARD_GEOMS[(idx + 1) % WARD_GEOMS.length])
    },
  })
}
