const defaultQuery = '?v=40.7309-74.0630+12.3+52-28&agg=lot&sel=14507-1'

export default {
  og: {
    query: defaultQuery,
    width: 1200,
    height: 710,
    selector: '#root',
    preScreenshotSleep: 5000,
    path: 'og.png',
  },
  hero: {
    query: defaultQuery,
    width: 1200,
    height: 630,
    selector: '#root',
    preScreenshotSleep: 6000,
    path: 'hero.png',
  },
}
