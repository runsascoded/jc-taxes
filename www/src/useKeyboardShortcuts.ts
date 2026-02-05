import { useAction } from 'use-kbd'

const AVAILABLE_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]
const AGGREGATE_MODES = ['block', 'lot', 'unit'] as const

type Props = {
  year: number
  setYear: (y: number) => void
  aggregateMode: string
  setAggregateMode: (m: string) => void
  settingsOpen: boolean
  setSettingsOpen: (v: boolean | ((v: boolean) => boolean)) => void
}

export function useKeyboardShortcuts({
  year,
  setYear,
  aggregateMode,
  setAggregateMode,
  settingsOpen,
  setSettingsOpen,
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

  useAction('view:cycle', {
    label: 'Cycle view (block/lot/unit)',
    group: 'Navigation',
    defaultBindings: ['v'],
    handler: () => {
      const idx = AGGREGATE_MODES.indexOf(aggregateMode as typeof AGGREGATE_MODES[number])
      const next = AGGREGATE_MODES[(idx + 1) % AGGREGATE_MODES.length]
      setAggregateMode(next)
    },
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
    handler: () => {
      // Dispatch a custom event that App.tsx listens for
      window.dispatchEvent(new CustomEvent('set-pitch', { detail: 0 }))
    },
  })

  useAction('view:3d', {
    label: '3D view (pitch 45)',
    group: 'UI',
    defaultBindings: ['d'],
    handler: () => {
      window.dispatchEvent(new CustomEvent('set-pitch', { detail: 45 }))
    },
  })
}
