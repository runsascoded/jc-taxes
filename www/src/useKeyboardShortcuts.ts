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
  toggleTheme,
  wardLabels,
  setWardLabels,
  wardGeom,
  setWardGeom,
}: Props) {
  const isWardMode = aggregateMode === 'ward'
  const yearIdx = AVAILABLE_YEARS.indexOf(year)

  useAction('year:prev', {
    label: 'Previous year',
    group: 'Navigation',
    defaultBindings: ['arrowleft'],
    enabled: yearIdx > 0,
    handler: () => {
      if (yearIdx > 0) setYear(AVAILABLE_YEARS[yearIdx - 1])
    },
  })

  useAction('year:next', {
    label: 'Next year',
    group: 'Navigation',
    defaultBindings: ['arrowright'],
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
