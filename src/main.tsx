import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { router } from './app/router'
import { isTauri } from './lib/platform'
import { connectVoxd } from './lib/voxd/state'
import { connectEvents } from './lib/voxd/events'
import { queryClient } from './lib/query'
import './styles/globals.css'

document.documentElement.dataset.nativeGlass = String(isTauri)
connectVoxd()
connectEvents()


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
