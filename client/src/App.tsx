import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useMessengerWS } from '@/hooks/useMessengerWS'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useCallHandler } from '@/hooks/useCallHandler'
import { useCallStore } from '@/store/callStore'
import ChatListPage from '@/pages/ChatListPage'
import ChatWindowPage from '@/pages/ChatWindowPage'
import ProfilePage from '@/pages/ProfilePage'
import AuthPage from '@/pages/AuthPage'
import OfflineIndicator from '@/components/OfflineIndicator/OfflineIndicator'
import CallOverlay from '@/components/CallOverlay/CallOverlay'

function AppRoutes() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  // WebSocket подключается глобально при авторизации
  useMessengerWS()
  // Сброс outbox при восстановлении WS-соединения
  useOfflineSync()
  // initiateCall берём из store — зарегистрировано в CallHandlerBridge через useCallHandler
  const initiateCall = useCallStore((s) => s._initiateCall) ?? ((_chatId: string, _targetId: string, _isVideo: boolean) => {})

  if (!isAuthenticated) {
    return (
      <Routes>
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
