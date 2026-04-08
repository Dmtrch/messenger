import { useAuthStore } from '@/store/authStore'
import s from './Profile.module.css'

interface Props { onBack: () => void }

export default function Profile({ onBack }: Props) {
  const user = useAuthStore((st) => st.currentUser)
  const logout = useAuthStore((st) => st.logout)

  if (!user) return null

  return (
    <div className={s.root}>
      <header className={s.header}>
        <button className={s.backBtn} onClick={onBack} aria-label="Назад">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <h1 className={s.title}>Профиль</h1>
      </header>

      <div className={s.hero}>
        <div className={s.avatar}>
          {user.avatarPath
            ? <img src={user.avatarPath} alt={user.displayName} />
            : <span>{user.displayName.charAt(0).toUpperCase()}</span>}
        </div>
        <h2 className={s.displayName}>{user.displayName}</h2>
        <p className={s.username}>@{user.username}</p>
      </div>

      <section className={s.section}>
        <Field label="Имя" value={user.displayName} />
        <Field label="Логин" value={`@${user.username}`} />
        <div className={s.field}>
          <span className={s.label}>Публичный ключ (Ed25519)</span>
          <span className={s.mono} title={user.identityKeyPublic}>
            {user.identityKeyPublic.slice(0, 32)}…
          </span>
        </div>
      </section>

      <section className={s.section}>
        <button className={s.dangerBtn} onClick={logout}>Выйти</button>
      </section>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.field}>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{value}</span>
    </div>
  )
}
