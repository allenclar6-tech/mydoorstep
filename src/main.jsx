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
import './visualDepth.css'
import './accountEntry.css'
import './map/mapExperience.css'
import './parcel/parcel.css'
import './polish.css'
import './theme.css'
import './home/mobileHome.css'
import './mobile/mobileApp.css'
import './mobile/authMobile.css'
import './notifications/notifications.css'
import './auth/altSignIn.css'
import './support/helpChat.css'
import './finance/finance.css'
import './orders/orderActions.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
