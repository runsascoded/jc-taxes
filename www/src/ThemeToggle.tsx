import { MdDarkMode, MdLightMode } from 'react-icons/md'
import { useTheme } from './ThemeContext'
import styles from './ThemeToggle.module.css'

export default function ThemeToggle() {
  const { actualTheme, toggleTheme } = useTheme()
  const Icon = actualTheme === 'dark' ? MdDarkMode : MdLightMode
  const label = actualTheme === 'dark' ? 'Dark mode' : 'Light mode'
  return (
    <button
      className={styles.fab}
      onClick={toggleTheme}
      title={label}
      aria-label={label}
    >
      <Icon />
    </button>
  )
}
