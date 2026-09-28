import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { router } from './app/router'
import { Pill } from './features/dictation/pill'
import { QuickSpeak } from './features/quick/quick-speak'
import { isTauri } from './lib/platform'
import { connectVoxd } from './lib/voxd/state'
import { connectEvents } from './lib/voxd/events'
import { queryClient } from './lib/query'
import './styles/globals.css'

document.documentElement.dataset.nativeGlass = String(isTauri)
connectVoxd()
// Panels (dictation pill, Quick Speak) are separate windows loading index.html#/pill or #/quick.
const isPill = window.location.hash.startsWith('#/pill')
const isQuick = window.location.hash.startsWith('#/quick')
if (!isPill && !isQuick) connectEvents()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>{isPill ? <Pill /> : isQuick ? <QuickSpeak /> : <RouterProvider router={router} />}</QueryClientProvider>
  </StrictMode>,
)
