import { useState, useRef, useCallback, useEffect } from 'react'
import { FaGithub, FaSearch } from 'react-icons/fa'
import { MdDarkMode, MdLightMode, MdExpandMore } from 'react-icons/md'
import { useHotkeysContext } from 'use-kbd'
import { useTheme } from './ThemeContext'

const LONG_PRESS_DURATION = 400

const fabBase: React.CSSProperties = {
  borderRadius: '50%',
  border: '1px solid var(--border)',
  background: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 2px 8px var(--shadow)',
}

const primaryStyle: React.CSSProperties = {
  ...fabBase,
  width: 44,
  height: 44,
  fontSize: 20,
}

const secondaryStyle: React.CSSProperties = {
  ...fabBase,
  width: 38,
  height: 38,
  fontSize: 17,
  textDecoration: 'none',
}

export default function MobileSpeedDial() {
  const ctx = useHotkeysContext()
  const { actualTheme, toggleTheme } = useTheme()
  const [isExpanded, setIsExpanded] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress = useRef(false)
  const touchHandledRef = useRef(false)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)

  const handlePrimaryTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    didLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true
      setIsExpanded(prev => !prev)
    }, LONG_PRESS_DURATION)
  }, [])

  const handlePrimaryTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    touchHandledRef.current = true
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (!didLongPress.current) {
      if (isExpanded) {
        setIsExpanded(false)
      } else {
        // Defer to avoid ghost click on omnibar backdrop closing it immediately
        setTimeout(() => ctx?.openOmnibar(), 0)
      }
    }
  }, [ctx, isExpanded])

  const handlePrimaryClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (touchHandledRef.current) {
      touchHandledRef.current = false
      return
    }
    if (isExpanded) {
      setIsExpanded(false)
    } else {
      ctx?.openOmnibar()
    }
  }, [ctx, isExpanded])

  // Non-passive touchstart (React's onTouchStart is passive by default)
  useEffect(() => {
    const button = primaryButtonRef.current
    if (!button) return
    button.addEventListener('touchstart', handlePrimaryTouchStart, { passive: false })
    return () => {
      button.removeEventListener('touchstart', handlePrimaryTouchStart)
    }
  }, [handlePrimaryTouchStart])

  // Close on click outside
  useEffect(() => {
    if (!isExpanded) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.mobile-speed-dial')) {
        setIsExpanded(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('touchend', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('touchend', handleClickOutside)
    }
  }, [isExpanded])

  return (
    <div
      className="mobile-speed-dial"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column-reverse',
        alignItems: 'center',
        gap: 12,
        zIndex: 1000,
      }}
    >
      <button
        ref={primaryButtonRef}
        style={primaryStyle}
        onTouchEnd={handlePrimaryTouchEnd}
        onTouchCancel={() => {
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current)
            longPressTimer.current = null
          }
        }}
        onClick={handlePrimaryClick}
        aria-label={isExpanded ? 'Close menu' : 'Search (hold for more)'}
      >
        {isExpanded ? <MdExpandMore /> : <FaSearch />}
      </button>
      {isExpanded && <>
        <a
          href="https://github.com/runsascoded/jc-taxes"
          target="_blank"
          rel="noopener noreferrer"
          style={secondaryStyle}
          aria-label="View on GitHub"
          onClick={() => setIsExpanded(false)}
        >
          <FaGithub />
        </a>
        <button
          style={secondaryStyle}
          onClick={() => {
            toggleTheme()
            setIsExpanded(false)
          }}
          aria-label={`Theme: ${actualTheme}`}
        >
          {actualTheme === 'dark' ? <MdDarkMode /> : <MdLightMode />}
        </button>
      </>}
    </div>
  )
}
