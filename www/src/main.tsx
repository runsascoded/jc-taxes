import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HotkeysProvider, ShortcutsModal, Omnibar, useHotkeysContext } from 'use-kbd'
import 'use-kbd/styles.css'
import './index.css'
import App from './App.tsx'

function AppWithModals() {
  const { isModalOpen, closeModal } = useHotkeysContext()
  return (
    <>
      <App />
      <ShortcutsModal isOpen={isModalOpen} onClose={closeModal} editable />
      <Omnibar />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HotkeysProvider>
      <AppWithModals />
    </HotkeysProvider>
  </StrictMode>,
)
