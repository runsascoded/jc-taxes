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

type Props = {
  year: number
  setYear: (y: number) => void
  aggregateMode: string
  setAggregateMode: (m: string) => void
  settingsOpen: boolean
  setSettingsOpen: (v: boolean | ((v: boolean) => boolean)) => void
  setViewState: Dispatch<SetStateAction<ViewState>>
  toggleTheme: () => void
}

export function useKeyboardShortcuts({
  year,
  setYear,
  aggregateMode,
  setAggregateMode,
  settingsOpen,
  setSettingsOpen,
  setViewState,
  toggleTheme,
}: Props) {
  useAction('year:prev', {
    label: 'Previous year',
    group: 'Navigation',
    defaultBindings: ['arrowleft'],
    handler: () => {
      const idx = AVAILABLE_YEARS.indexOf(year)
      if (idx > 0) setYear(AVAILABLE_YEARS[idx - 1])
    },
  })

  useAction('year:next', {
    label: 'Next year',
    group: 'Navigation',
    defaultBindings: ['arrowright'],
    handler: () => {
      const idx = AVAILABLE_YEARS.indexOf(year)
      if (idx < AVAILABLE_YEARS.length - 1) setYear(AVAILABLE_YEARS[idx + 1])
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

  useAction('view:3d', {
    label: '3D view (pitch 45)',
    group: 'UI',
    defaultBindings: ['d'],
    handler: () => setViewState(v => ({ ...v, pitch: 45 })),
  })
}
