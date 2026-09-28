import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { router } from './app/router'
import { Pill } from './features/dictation/pill'
import { isTauri } from './lib/platform'
import { connectVoxd } from './lib/voxd/state'
import { connectEvents } from './lib/voxd/events'
import { queryClient } from './lib/query'
import './styles/globals.css'

document.documentElement.dataset.nativeGlass = String(isTauri)
connectVoxd()
if (!isPillWindow()) connectEvents()

function isPillWindow() {
  return window.location.hash.startsWith('#/pill')
}


// The dictation pill is a separate window that loads index.html#/pill.
const isPill = window.location.hash.startsWith('#/pill')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>{isPill ? <Pill /> : <RouterProvider router={router} />}</QueryClientProvider>
  </StrictMode>,
)
