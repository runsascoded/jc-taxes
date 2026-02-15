import type { Feature, Polygon, MultiPolygon } from 'geojson'

export type ParcelProperties = {
  block?: string
  lot?: string
  qual?: string
  addr?: string
  owner?: string
  streets?: string
  year?: number
  paid?: number
  billed?: number
  area_sqft?: number
  paid_per_sqft?: number
  geoid?: string
  ward?: string
  council_person?: string
  population?: number
  paid_per_capita?: number
}

export type ParcelFeature = Feature<Polygon | MultiPolygon, ParcelProperties>
