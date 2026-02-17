import { useAction } from 'use-kbd'
import { LinearInterpolator } from '@deck.gl/core'
import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

const AVAILABLE_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]

export type ViewState = {
  latitude: number
  longitude: number
  zoom: number
  pitch: number
  bearing: number
  transitionDuration?: number
  transitionInterpolator?: object
}

const WARD_GEOMS = ['merged', 'blocks', 'lots', 'boundary'] as const

// Zoom-dependent pan step: constant screen distance across zoom levels
const panStep = (zoom: number) => 0.01 * Math.pow(2, 12 - zoom)

const interpolators: Record<string, LinearInterpolator> = {}
const transition = (props: string[]) => {
  const key = props.join(',')
  interpolators[key] ??= new LinearInterpolator(props)
  return { transitionDuration: 60, transitionInterpolator: interpolators[key] }
}

// Continuous movement speeds (for press-and-hold)
const PAN_SPEED = 16       // pan steps per second
const ZOOM_SPEED = 2.0     // zoom levels per second
const ROTATE_SPEED = 60    // degrees per second
const PITCH_SPEED = 60     // degrees per second

const MOVEMENT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '-', '=', 'Shift'])

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

  // Continuous movement for press-and-hold
  const activeMovements = useRef(new Set<string>())
  const rafRef = useRef(0)
  const lastTimeRef = useRef(0)

  const rafTick = useCallback((time: number) => {
    if (activeMovements.current.size === 0) {
      rafRef.current = 0
      lastTimeRef.current = 0
      return
    }
    const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.05) : 1 / 60
    lastTimeRef.current = time
    if (dt > 0) {
      setViewState(v => {
        let { latitude, longitude, zoom, pitch, bearing } = v
        const p = panStep(zoom) * PAN_SPEED * dt
        const bearingRad = bearing * Math.PI / 180
        const cosB = Math.cos(bearingRad)
        const sinB = Math.sin(bearingRad)
        if (activeMovements.current.has('pan-left'))  { longitude -= p * cosB; latitude += p * sinB }
        if (activeMovements.current.has('pan-right')) { longitude += p * cosB; latitude -= p * sinB }
        if (activeMovements.current.has('pan-up'))    { longitude += p * sinB; latitude += p * cosB }
        if (activeMovements.current.has('pan-down'))  { longitude -= p * sinB; latitude -= p * cosB }
        if (activeMovements.current.has('zoom-in')) zoom = Math.min(24, zoom + ZOOM_SPEED * dt)
        if (activeMovements.current.has('zoom-out')) zoom = Math.max(0, zoom - ZOOM_SPEED * dt)
        if (activeMovements.current.has('pitch-up')) pitch = Math.min(85, pitch + PITCH_SPEED * dt)
        if (activeMovements.current.has('pitch-down')) pitch = Math.max(0, pitch - PITCH_SPEED * dt)
        if (activeMovements.current.has('rotate-cw')) bearing += ROTATE_SPEED * dt
        if (activeMovements.current.has('rotate-ccw')) bearing -= ROTATE_SPEED * dt
        return { latitude, longitude, zoom, pitch, bearing }
      })
    }
    rafRef.current = requestAnimationFrame(rafTick)
  }, [setViewState])

  const startMovement = useCallback((direction: string) => {
    activeMovements.current.add(direction)
    if (!rafRef.current) {
      lastTimeRef.current = 0
      rafRef.current = requestAnimationFrame(rafTick)
    }
  }, [rafTick])

  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (MOVEMENT_KEYS.has(e.key)) {
        activeMovements.current.clear()
      }
    }
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keyup', onKeyUp)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

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
    handler: () => setViewState(v => ({ ...v, pitch: 0, ...transition(['pitch']) })),
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
    handler: () => setViewState(v => ({ ...v, pitch: 45, ...transition(['pitch']) })),
  })

  useAction('view:bearing', {
    label: 'Set bearing (degrees)',
    group: 'Viewport',
    defaultBindings: ['n', 'n \\f', '\\f n'],
    handler: (_e, captures) => {
      const deg = captures?.[0] ?? 0
      setViewState(v => ({ ...v, bearing: deg, ...transition(['bearing']) }))
    },
  })

  // Pitch: p N or N p → set absolute pitch; shift+up/down to nudge
  useAction('view:pitch', {
    label: 'Set pitch (degrees)',
    group: 'Viewport',
    defaultBindings: ['p \\d+', '\\d+ p'],
    handler: (_e, captures) => {
      const deg = Math.min(85, Math.max(0, captures?.[0] ?? 45))
      setViewState(v => ({ ...v, pitch: deg, ...transition(['pitch']) }))
    },
  })

  useAction('view:pitch-up', {
    label: 'Increase pitch',
    group: 'Viewport',
    defaultBindings: ['shift+arrowdown', '\\f shift+arrowdown'],
    handler: (e, captures) => {
      if (e?.repeat) return
      const deg = captures?.[0]
      if (deg) {
        setViewState(v => ({ ...v, pitch: Math.min(85, v.pitch + deg) }))
      } else {
        startMovement('pitch-up')
      }
    },
  })

  useAction('view:pitch-down', {
    label: 'Decrease pitch',
    group: 'Viewport',
    defaultBindings: ['shift+arrowup', '\\f shift+arrowup'],
    handler: (e, captures) => {
      if (e?.repeat) return
      const deg = captures?.[0]
      if (deg) {
        setViewState(v => ({ ...v, pitch: Math.max(0, v.pitch - deg) }))
      } else {
        startMovement('pitch-down')
      }
    },
  })

  // Rotate: shift+left/right
  useAction('view:rotate-cw', {
    label: 'Rotate CW',
    group: 'Viewport',
    defaultBindings: ['shift+arrowleft', '\\f shift+arrowleft'],
    handler: (e, captures) => {
      if (e?.repeat) return
      const deg = captures?.[0]
      if (deg) {
        setViewState(v => ({ ...v, bearing: v.bearing + deg }))
      } else {
        startMovement('rotate-cw')
      }
    },
  })

  useAction('view:rotate-ccw', {
    label: 'Rotate CCW',
    group: 'Viewport',
    defaultBindings: ['shift+arrowright', '\\f shift+arrowright'],
    handler: (e, captures) => {
      if (e?.repeat) return
      const deg = captures?.[0]
      if (deg) {
        setViewState(v => ({ ...v, bearing: v.bearing - deg }))
      } else {
        startMovement('rotate-ccw')
      }
    },
  })

  // Pan: arrow keys (or N arrow for N discrete steps)
  useAction('view:pan-left', {
    label: 'Pan left',
    group: 'Viewport',
    defaultBindings: ['arrowleft', '\\d+ arrowleft'],
    handler: (e, captures) => {
      if (e?.repeat) return
      const n = captures?.[0]
      if (n) {
        setViewState(v => {
          const step = panStep(v.zoom) * n
          const rad = v.bearing * Math.PI / 180
          return { ...v, longitude: v.longitude - step * Math.cos(rad), latitude: v.latitude + step * Math.sin(rad) }
        })
      } else {
        startMovement('pan-left')
      }
    },
  })

  useAction('view:pan-right', {
    label: 'Pan right',
    group: 'Viewport',
    defaultBindings: ['arrowright', '\\d+ arrowright'],
    handler: (e, captures) => {
      if (e?.repeat) return
      const n = captures?.[0]
      if (n) {
        setViewState(v => {
          const step = panStep(v.zoom) * n
          const rad = v.bearing * Math.PI / 180
          return { ...v, longitude: v.longitude + step * Math.cos(rad), latitude: v.latitude - step * Math.sin(rad) }
        })
      } else {
        startMovement('pan-right')
      }
    },
  })

  useAction('view:pan-up', {
    label: 'Pan up',
    group: 'Viewport',
    defaultBindings: ['arrowup', '\\d+ arrowup'],
    handler: (e, captures) => {
      if (e?.repeat) return
      const n = captures?.[0]
      if (n) {
        setViewState(v => {
          const step = panStep(v.zoom) * n
          const rad = v.bearing * Math.PI / 180
          return { ...v, longitude: v.longitude + step * Math.sin(rad), latitude: v.latitude + step * Math.cos(rad) }
        })
      } else {
        startMovement('pan-up')
      }
    },
  })

  useAction('view:pan-down', {
    label: 'Pan down',
    group: 'Viewport',
    defaultBindings: ['arrowdown', '\\d+ arrowdown'],
    handler: (e, captures) => {
      if (e?.repeat) return
      const n = captures?.[0]
      if (n) {
        setViewState(v => {
          const step = panStep(v.zoom) * n
          const rad = v.bearing * Math.PI / 180
          return { ...v, longitude: v.longitude - step * Math.sin(rad), latitude: v.latitude - step * Math.cos(rad) }
        })
      } else {
        startMovement('pan-down')
      }
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
    handler: (e) => {
      if (e?.repeat) return
      startMovement('zoom-out')
    },
  })

  useAction('view:zoom-in', {
    label: 'Zoom in',
    group: 'Viewport',
    defaultBindings: ['='],
    handler: (e) => {
      if (e?.repeat) return
      startMovement('zoom-in')
    },
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
