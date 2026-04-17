import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useMessengerWS } from '@/hooks/useMessengerWS'
import { useBrowserWSBindings } from '@/hooks/useBrowserWSBindings'
import { browserApiClient } from '@/api/client'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useCallHandler } from '@/hooks/useCallHandler'
import type { CallWSFrame } from '../../shared/native-core'
import { initServerUrl, hasServerUrl } from '@/config/serverConfig'
import ChatListPage from '@/pages/ChatListPage'
import ChatWindowPage from '@/pages/ChatWindowPage'
import ProfilePage from '@/pages/ProfilePage'
import AuthPage from '@/pages/AuthPage'
import ServerSetupPage from '@/pages/ServerSetupPage'
import AdminPage from '@/pages/AdminPage'
import DownloadsPage from '@/pages/DownloadsPage'
import OfflineIndicator from '@/components/OfflineIndicator/OfflineIndicator'
import CallOverlay from '@/components/CallOverlay/CallOverlay'

// Инициализируем URL сервера при загрузке модуля (если не задан — берём window.location.origin)
initServerUrl()

interface AppRoutesProps {
  initiateCall: (chatId: string, targetId: string, isVideo: boolean) => void
  handleCallFrame: ((frame: CallWSFrame) => void) | null
}

function AppRoutes({ initiateCall, handleCallFrame }: AppRoutesProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const role = useAuthStore((s) => s.role)

  // WebSocket подключается глобально при авторизации
  const bindings = useBrowserWSBindings(handleCallFrame)
  useMessengerWS(browserApiClient, bindings)
  // Сброс outbox при восстановлении WS-соединения
  useOfflineSync()

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
      <Route path="/downloads" element={<DownloadsPage />} />
      {role === 'admin' && <Route path="/admin" element={<AdminPage />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const {
    initiateCall,
    acceptCall,
    rejectCall,
    hangUp,
    handleCallFrame,
  } = useCallHandler(browserApiClient)

  return (
    <BrowserRouter>
      <OfflineIndicator />
      <AppRoutes initiateCall={initiateCall} handleCallFrame={handleCallFrame} />
      <CallOverlay onAccept={acceptCall} onReject={rejectCall} onHangUp={hangUp} />
    </BrowserRouter>
  )
}
