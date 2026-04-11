import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useMessengerWS } from '@/hooks/useMessengerWS'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useCallHandler } from '@/hooks/useCallHandler'
import { useCallStore } from '@/store/callStore'
import { initServerUrl, hasServerUrl } from '@/config/serverConfig'
import ChatListPage from '@/pages/ChatListPage'
import ChatWindowPage from '@/pages/ChatWindowPage'
import ProfilePage from '@/pages/ProfilePage'
import AuthPage from '@/pages/AuthPage'
import ServerSetupPage from '@/pages/ServerSetupPage'
import AdminPage from '@/pages/AdminPage'
import OfflineIndicator from '@/components/OfflineIndicator/OfflineIndicator'
import CallOverlay from '@/components/CallOverlay/CallOverlay'

// Инициализируем URL сервера при загрузке модуля (если не задан — берём window.location.origin)
initServerUrl()

function AppRoutes() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const role = useAuthStore((s) => s.role)

  // WebSocket подключается глобально при авторизации
  useMessengerWS()
  // Сброс outbox при восстановлении WS-соединения
  useOfflineSync()
  // initiateCall берём из store — зарегистрировано в CallHandlerBridge через useCallHandler
  const initiateCall = useCallStore((s) => s._initiateCall) ?? undefined

  // Если URL сервера не задан — показываем setup
  if (!hasServerUrl()) {
    return (
      <Routes>
        <Route path="/setup" element={<ServerSetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/setup" element={<ServerSetupPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<ChatListPage />} />
      <Route path="/chat/:chatId" element={<ChatWindowPage initiateCall={initiateCall} />} />
      <Route path="/profile" element={<ProfilePage />} />
      {role === 'admin' && <Route path="/admin" element={<AdminPage />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/** Компонент-мост: регистрирует useCallHandler и рендерит CallOverlay вне auth-guard */
function CallHandlerBridge() {
  const { acceptCall, rejectCall, hangUp } = useCallHandler()
  return <CallOverlay onAccept={acceptCall} onReject={rejectCall} onHangUp={hangUp} />
}

export default function App() {
  return (
    <BrowserRouter>
      <OfflineIndicator />
      <AppRoutes />
      <CallHandlerBridge />
    </BrowserRouter>
  )
}
