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

      let filtered: ParcelFeature[]
      if (!query.trim()) {
        // No query: show top parcels by $/sqft
        filtered = [...data].sort(
          (a, b) => (b.properties?.paid_per_sqft ?? 0) - (a.properties?.paid_per_sqft ?? 0)
        )
      } else {
        const q = query.toLowerCase()
        filtered = data.filter((f) => {
          const p = f.properties
          if (!p) return false
          const addr = (p.addr || '').toLowerCase()
          const streets = (p.streets || '').toLowerCase()
          const blq = `${p.block || ''}-${p.lot || ''}${p.qual ? `-${p.qual}` : ''}`.toLowerCase()
          const blockOnly = (p.block || '').toLowerCase()
          return addr.includes(q) || streets.includes(q) || blq.includes(q) || blockOnly === q
        }).sort((a, b) => {
          const aAddr = (a.properties?.addr || '').toLowerCase()
          const bAddr = (b.properties?.addr || '').toLowerCase()
          const aStarts = aAddr.startsWith(q)
          const bStarts = bAddr.startsWith(q)
          if (aStarts && !bStarts) return -1
          if (!aStarts && bStarts) return 1
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
