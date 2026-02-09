import { useCallback } from 'react'
import { useOmnibarEndpoint } from 'use-kbd'
import type { Feature, Polygon, MultiPolygon } from 'geojson'

type ParcelProperties = {
  block?: string
  lot?: string
  qual?: string
  addr?: string
  streets?: string
  paid?: number
  paid_per_sqft?: number
  area_sqft?: number
}

type ParcelFeature = Feature<Polygon | MultiPolygon, ParcelProperties>

type Props = {
  data: ParcelFeature[] | null
  onSelect: (feature: ParcelFeature) => void
}

export function useParcelSearch({ data, onSelect }: Props) {
  const filter = useCallback(
    (query: string, pagination: { offset: number; limit: number }) => {
      if (!data) return { entries: [], total: 0, hasMore: false }

      const searchText = (f: ParcelFeature) => {
        const p = f.properties
        if (!p) return ''
        return [
          p.addr || '',
          p.streets || '',
          `${p.block || ''}-${p.lot || ''}${p.qual ? `-${p.qual}` : ''}`,
          p.block || '',
        ].join(' ').toLowerCase()
      }

      let filtered: ParcelFeature[]
      if (!query.trim()) {
        // No query: show top parcels by $/sqft
        filtered = [...data].sort(
          (a, b) => (b.properties?.paid_per_sqft ?? 0) - (a.properties?.paid_per_sqft ?? 0)
        )
      } else {
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
        filtered = data.filter((f) => {
          const text = searchText(f)
          return tokens.every(t => text.includes(t))
        }).sort((a, b) => {
          // Score by how many tokens prefix-match a word boundary
          const text = (f: ParcelFeature) => searchText(f)
          const words = (t: string) => t.split(/[\s/,.-]+/)
          const prefixHits = (f: ParcelFeature) =>
            tokens.reduce((s, t) => s + (words(text(f)).some(w => w.startsWith(t)) ? 1 : 0), 0)
          const diff = prefixHits(b) - prefixHits(a)
          if (diff !== 0) return diff
          return (b.properties?.paid_per_sqft ?? 0) - (a.properties?.paid_per_sqft ?? 0)
        })
      }

      const total = filtered.length
      const paginated = filtered.slice(pagination.offset, pagination.offset + pagination.limit)

      return {
        entries: paginated.map((f) => {
          const p = f.properties!
          const blq = `${p.block || ''}${p.lot ? `-${p.lot}` : ''}${p.qual ? `-${p.qual}` : ''}`
          const label = p.addr || p.streets || `Block ${blq}`
          const paid = p.paid ? `$${p.paid.toLocaleString()}` : ''
          const perSqft = p.paid_per_sqft ? `$${p.paid_per_sqft.toFixed(2)}/sqft` : ''
          const description = [blq, paid, perSqft].filter(Boolean).join(' · ')
          return {
            id: `parcel:${blq}`,
            label,
            description,
            group: 'Parcels',
            handler: () => onSelect(f),
          }
        }),
        total,
        hasMore: pagination.offset + paginated.length < total,
      }
    },
    [data, onSelect],
  )

  useOmnibarEndpoint('parcels', {
    filter,
    group: 'Parcels',
    priority: 100,
    pageSize: 10,
    pagination: 'scroll',
    minQueryLength: 0,
    enabled: !!data,
  })
}
