import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import s from './OfflineIndicator.module.css'

export default function OfflineIndicator() {
  const { isOnline } = useNetworkStatus()
  if (isOnline) return null

  return (
    <div className={s.banner} role="alert" aria-live="assertive">
      <svg className={s.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
      </svg>
      Нет подключения — показаны кэшированные данные
    </div>
  )
}
