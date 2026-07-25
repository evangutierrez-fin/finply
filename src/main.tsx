import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/besley'
import '@fontsource-variable/besley/wght-italic.css'
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/spline-sans-mono'
import './styles/tokens.css'
import './styles/app.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
