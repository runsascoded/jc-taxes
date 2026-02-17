# Roadmap

## Shipped
- [x] 3D choropleth map (deck.gl + maplibre)
- [x] Year selector (2018-2025, 8 years, 24 GeoJSON files)
- [x] $/sqft coloring with interactive gradient editor (draggable stops, linear/sqrt/log scales)
- [x] Lot, unit, and block aggregation levels
- [x] Address and owner display on hover (from cached account data)
- [x] Block-level street summaries (e.g. "HOPKINS AVE 147-179 / ST PAULS AVE 144-174")
- [x] Configurable max height (URL param `mh`)
- [x] Collapsible settings panel
- [x] URL-persisted state for all settings (view, year, aggregation, scale, color stops)
- [x] Dark/light theme with per-theme color gradient defaults
- [x] DVC/DVX integration: GeoJSON tracked via `.dvc` files, served from S3 in production (`vite-plugin-dvc`)
- [x] Census-block and ward aggregation views with $/sqft and $/capita metrics
- [x] Ward labels: screen-space positioning via offscreen rasterization with collision avoidance
- [x] Ward geometry options (merged, blocks, lots, boundary)
- [x] `use-kbd` integration: omnibar parcel search, editable hotkeys, `ShortcutsModal`, `LookupModal`, `SequenceModal`
- [x] Keyboard shortcuts: year/view cycling, pitch/zoom/bearing, max height, theme, settings toggle
- [x] Unified `SpeedDial` FAB (hover-peek + click-to-pin) with search, theme, GitHub, shortcuts
- [x] Mobile UX: two-finger pitch, long-press speed dial, responsive defaults, touch-safe hover
- [x] Clickable parcel selection with URL persistence (`sel` param)
- [x] OG metadata and `scrns` screenshot automation
- [x] GitHub Pages deploy workflow
- [x] Microsoft Building Footprints downloaded (28,201 buildings with heights)

## Data / Infra
- [ ] **Quantized TopoJSON**: 75% smaller for blocks, 25% for lots (vs GeoJSON gzip)
  - Blocks: 0.2M vs 0.8M gzipped
  - Lots: 2.1M vs 2.8M gzipped
  - Units: ~3.5M vs 4.5M gzipped (estimate)
  - Requires `topojson-client` in frontend to convert back to GeoJSON for deck.gl
- [ ] **Remove `parcels.geojson`** (33 MB, unused legacy file)

## Features
- [ ] **Block drill-down**: click a block to load/show individual lots within it
  - Lazy-load lots GeoJSON on first click, filter client-side per block
- [ ] **Street name normalization**: deduplicate variants like "SECAUCUS RD" vs "SECAUCUS RD."
- [ ] **3D building layer**: render MS Building Footprints as a second deck.gl layer
  - Buildings extruded to actual heights, colored by $/sqft
  - Max height 37.8m (MS data caps around 12 stories; tall towers underrepresented)
  - Could supplement with OSM `height`/`building:levels` tags or NJ LIDAR

## Expansion
- [ ] **Hudson County**: NJGIN parcels cover all of Hudson County (`parcels_shp_dbf_Hudson.zip` already downloaded); HLS payment system is county-wide
  - Municipalities: Bayonne, Hoboken, Weehawken, Union City, North Bergen, Kearny, etc.
  - Would need to scrape/enumerate accounts per municipality
  - Consider renaming project from `jc-taxes` to `hudson-taxes` or similar
- [ ] **TaxRecords-NJ enrichment**: land vs building assessed values for LVT analysis
  - Already have 64,821 records with 2023-2026 assessment data
  - Median land ratio 32.3% — useful for showing LVT impact

## References

[dvx]: https://github.com/runsascoded/dvx
[bikejc/maps]: https://github.com/bikejc/maps/blob/main/public/wards.json
[JC Open Data]: https://data.jerseycitynj.gov/
[Census TIGER/Line]: https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html
