const defaultQuery = '?v=40.7309-74.0630+12.3+52-28&agg=lot&sel=14507-1'

export default {
  og: {
    query: defaultQuery,
    width: 1200,
    height: 630,
    selector: '#root',
    preScreenshotSleep: 6000,
    path: 'og.png',
  },
  cast: {
    query: '?v=40.7190-74.0440+12.0+52-28&agg=lot',
    width: 800,
    height: 500,
    selector: '#root',
    preScreenshotSleep: 6000,
    path: 'cast.gif',
    fps: 30,
    actions: [
      { type: 'wait', duration: 500 },
      { type: 'animate', frames: 75, eval: '(i, n) => window.__setViewState({ bearing: -28 + (i / (n - 1)) * 100 })' },
      { type: 'wait', duration: 250 },
    ],
  },
}
