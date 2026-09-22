import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './chatMotion.css'
import './navModern.css'
import './profileModern.css'
import './profileDetails.css'
import './authModern.css'
import './logoCreative.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
