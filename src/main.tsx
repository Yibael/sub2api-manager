import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { queryClient } from './lib/api'
import { router } from './router'
import { PwaProvider } from './components/pwa'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><PwaProvider><RouterProvider router={router} /></PwaProvider></QueryClientProvider></React.StrictMode>,
)
