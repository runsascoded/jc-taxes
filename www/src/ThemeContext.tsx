import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react'
import { useUrlState } from 'use-prms'
import {
  type ColorStop,
  DEFAULT_STOPS_DARK,
  DEFAULT_STOPS_LIGHT,
  decodeStops,
  encodeStops,
} from './GradientEditor'

type ThemeStops = {
  light: boolean
  stops: ColorStop[] | null
}

interface ThemeContextType {
  actualTheme: 'light' | 'dark'
  toggleTheme: () => void
  colorStops: ColorStop[]
  hasCustomStops: boolean
  setColorStops: (stops: ColorStop[]) => void
  resetColorStops: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const cParam = {
  decode: (s: string | undefined): ThemeStops => {
    if (!s) return { light: false, stops: null }
    if (s.startsWith('l')) {
      const rest = s.slice(1)
      return { light: true, stops: rest ? decodeStops(rest) : null }
    }
    return { light: false, stops: decodeStops(s) }
  },
  encode: (v: ThemeStops): string | undefined => {
    if (!v.light && !v.stops) return undefined
    const stopsStr = v.stops ? encodeStops(v.stops) : ''
    return v.light ? 'l' + stopsStr : stopsStr
  },
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [{ light, stops: customStops }, setThemeStops] = useUrlState('c', cParam)
  const actualTheme = light ? 'light' as const : 'dark' as const

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', actualTheme)
  }, [actualTheme])

  const colorStops = customStops ?? (light ? DEFAULT_STOPS_LIGHT : DEFAULT_STOPS_DARK)

  const toggleTheme = useCallback(() => {
    const newLight = !light
    // Save current custom stops for current theme
    if (customStops) {
      localStorage.setItem(`jc-taxes-stops-${actualTheme}`, encodeStops(customStops))
    }
    // Load other theme's custom stops from localStorage
    const otherTheme = newLight ? 'light' : 'dark'
    const saved = localStorage.getItem(`jc-taxes-stops-${otherTheme}`)
    const otherStops = saved ? decodeStops(saved) : null
    setThemeStops({ light: newLight, stops: otherStops })
  }, [light, customStops, actualTheme, setThemeStops])

  const setColorStops = useCallback((stops: ColorStop[]) => {
    setThemeStops({ light, stops })
  }, [light, setThemeStops])

  const resetColorStops = useCallback(() => {
    localStorage.removeItem(`jc-taxes-stops-${actualTheme}`)
    setThemeStops({ light, stops: null })
  }, [light, actualTheme, setThemeStops])

  return (
    <ThemeContext.Provider value={{ actualTheme, toggleTheme, colorStops, hasCustomStops: customStops !== null, setColorStops, resetColorStops }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
