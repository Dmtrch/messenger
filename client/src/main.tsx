import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { initLogger, logger } from './lib/logger'

initLogger()

window.onerror = (message, source, lineno, colno, error) => {
  logger.error(String(message), { source, lineno, colno, stack: error?.stack })
}

window.onunhandledrejection = (event) => {
  logger.error('Unhandled promise rejection', {
    reason: event.reason instanceof Error
      ? { message: event.reason.message, stack: event.reason.stack }
      : event.reason,
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
