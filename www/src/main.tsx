import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HotkeysProvider, ShortcutsModal, Omnibar, LookupModal, SequenceModal, SpeedDial, useHotkeysContext } from 'use-kbd'
import 'use-kbd/styles.css'
import './index.css'
import App from './App.tsx'
import { ThemeProvider, useTheme } from './ThemeContext'
import { FaGithub } from 'react-icons/fa'
import { MdDarkMode, MdLightMode, MdKeyboard } from 'react-icons/md'

function AppWithModals() {
  const { isModalOpen, closeModal, openModal } = useHotkeysContext()
  const { actualTheme, toggleTheme } = useTheme()
  return (
    <>
      <App />
      <ShortcutsModal isOpen={isModalOpen} onClose={closeModal} editable />
      <Omnibar />
      <LookupModal />
      <SequenceModal />
      <SpeedDial
        showShortcuts={false}
        actions={[
          {
            key: 'shortcuts',
            label: 'Keyboard shortcuts',
            icon: <MdKeyboard />,
            onClick: openModal,
          },
          {
            key: 'theme',
            label: `Theme: ${actualTheme}`,
            icon: actualTheme === 'dark' ? <MdDarkMode /> : <MdLightMode />,
            onClick: toggleTheme,
          },
          {
            key: 'github',
            label: 'View on GitHub',
            icon: <FaGithub />,
            href: 'https://github.com/runsascoded/jc-taxes',
          },
        ]}
      />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <HotkeysProvider>
        <AppWithModals />
      </HotkeysProvider>
    </ThemeProvider>
  </StrictMode>,
)
