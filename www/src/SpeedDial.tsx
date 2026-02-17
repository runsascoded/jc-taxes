import { useState, useRef, useCallback, useEffect } from 'react'
import { FaGithub, FaSearch } from 'react-icons/fa'
import { MdDarkMode, MdLightMode, MdExpandLess, MdExpandMore, MdKeyboard } from 'react-icons/md'
import { useHotkeysContext } from 'use-kbd'
import { useTheme } from './ThemeContext'

const LONG_PRESS_DURATION = 400

const isDesktop = window.innerWidth > 768

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

const primarySize = isDesktop ? 48 : 44
const secondarySize = isDesktop ? 40 : 38

const primaryStyle: React.CSSProperties = {
  ...fabBase,
  width: primarySize,
  height: primarySize,
  fontSize: isDesktop ? 22 : 20,
}

const secondaryStyle: React.CSSProperties = {
  ...fabBase,
  width: secondarySize,
  height: secondarySize,
  fontSize: isDesktop ? 18 : 17,
  textDecoration: 'none',
}

const chevronBase: React.CSSProperties = {
  border: 'none',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: isDesktop ? 22 : 20,
  padding: isDesktop ? 4 : 2,
  borderRadius: '50%',
  transition: 'background 0.15s, opacity 0.15s',
}

export default function SpeedDial() {
  const ctx = useHotkeysContext()
  const { actualTheme, toggleTheme } = useTheme()
  const [isSticky, setIsSticky] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const isExpanded = isSticky || isHovered
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didLongPress = useRef(false)
  const touchHandledRef = useRef(false)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const stickyAtRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Long-press on search button toggles sticky (mobile)
  const handleSearchTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    didLongPress.current = false
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true
      stickyAtRef.current = Date.now()
      setIsSticky(prev => !prev)
    }, LONG_PRESS_DURATION)
  }, [])

  const handleSearchTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    touchHandledRef.current = true
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (!didLongPress.current) {
      ctx?.openOmnibar()
    }
  }, [ctx])

  const handleSearchClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (touchHandledRef.current) {
      touchHandledRef.current = false
      return
    }
    ctx?.openOmnibar()
  }, [ctx])

  // Non-passive touchstart (React's onTouchStart is passive by default)
  useEffect(() => {
    const button = searchButtonRef.current
    if (!button) return
    button.addEventListener('touchstart', handleSearchTouchStart, { passive: false })
    return () => {
      button.removeEventListener('touchstart', handleSearchTouchStart)
    }
  }, [handleSearchTouchStart])

  // Close sticky on click outside (using container ref to avoid
  // detached-DOM issues from React re-renders)
  useEffect(() => {
    if (!isSticky) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (Date.now() - stickyAtRef.current < 500) return
      const target = e.target as Node
      if (!document.contains(target)) return
      if (containerRef.current?.contains(target)) return
      setIsSticky(false)
    }
    document.addEventListener('click', handleClickOutside)
    document.addEventListener('touchend', handleClickOutside)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('touchend', handleClickOutside)
    }
  }, [isSticky])

  return (
    <div
      ref={containerRef}
      className="speed-dial"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        display: 'flex',
        flexDirection: 'column-reverse',
        alignItems: 'center',
        gap: 10,
        zIndex: 1000,
      }}
    >
      {/* Primary: search */}
      <button
        ref={searchButtonRef}
        style={primaryStyle}
        onTouchEnd={handleSearchTouchEnd}
        onTouchCancel={() => {
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current)
            longPressTimer.current = null
          }
        }}
        onClick={handleSearchClick}
        aria-label="Search"
      >
        <FaSearch />
      </button>

      {/* Chevron toggle (always visible); filled when sticky */}
      <button
        style={{
          ...chevronBase,
          background: isSticky ? 'var(--bg-secondary)' : 'transparent',
          boxShadow: isSticky ? '0 1px 4px var(--shadow)' : 'none',
          opacity: isSticky ? 1 : 0.7,
        }}
        onClick={(e) => {
          e.stopPropagation()
          stickyAtRef.current = Date.now()
          setIsSticky(prev => !prev)
        }}
        aria-label={isExpanded ? 'Collapse menu' : 'Expand menu'}
      >
        {isExpanded ? <MdExpandMore /> : <MdExpandLess />}
      </button>

      {/* Secondary actions (expanded via hover or sticky) */}
      {isExpanded && <>
        <button
          style={secondaryStyle}
          onClick={toggleTheme}
          aria-label={`Theme: ${actualTheme}`}
        >
          {actualTheme === 'dark' ? <MdDarkMode /> : <MdLightMode />}
        </button>
        <a
          href="https://github.com/runsascoded/jc-taxes"
          target="_blank"
          rel="noopener noreferrer"
          style={secondaryStyle}
          aria-label="View on GitHub"
        >
          <FaGithub />
        </a>
        <button
          style={secondaryStyle}
          onClick={() => ctx?.openModal()}
          aria-label="Keyboard shortcuts"
        >
          <MdKeyboard />
        </button>
      </>}
    </div>
  )
}
