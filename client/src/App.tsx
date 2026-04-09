import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useMessengerWS } from '@/hooks/useMessengerWS'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useCallHandler } from '@/hooks/useCallHandler'
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
  // Обработчик WebRTC-звонков
  const { initiateCall, acceptCall, rejectCall, hangUp } = useCallHandler()

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    )
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<ChatListPage />} />
        <Route path="/chat/:chatId" element={<ChatWindowPage initiateCall={initiateCall} />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CallOverlay onAccept={acceptCall} onReject={rejectCall} onHangUp={hangUp} />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <OfflineIndicator />
      <AppRoutes />
    </BrowserRouter>
  )
}
