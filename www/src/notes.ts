/**
 * Per-lot notes for the hoverbox, documenting known anomalies or context.
 * Keyed by "block-lot" (e.g. "26001-47").
 */
const LOT_NOTES: Record<string, string> = {
  "26001-47": "GIS shows 46 sqft sliver (40×2 IRR) but assessor values land at $133K — likely a lot-line-adjustment remnant. Lot 15 (536 Garfield) extends 200ft deep into this lot's expected footprint.",
}

export function getLotNote(block?: string, lot?: string): string | undefined {
  if (!block || !lot) return undefined
  return LOT_NOTES[`${block}-${lot}`]
}
