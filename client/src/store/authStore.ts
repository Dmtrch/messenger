import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  isAuthenticated: boolean
  currentUser: User | null
  accessToken: string | null
  role: 'admin' | 'user' | null
  deviceId: string | null
  login: (user: User, token: string, deviceId?: string) => void
  logout: () => void
  updateUser: (patch: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      currentUser: null,
      accessToken: null,
      role: null,
      deviceId: null,
      login: (user, token, deviceId) =>
        set({ isAuthenticated: true, currentUser: user, accessToken: token, role: user.role ?? 'user', deviceId: deviceId ?? null }),
      logout: () =>
        set({ isAuthenticated: false, currentUser: null, accessToken: null, role: null, deviceId: null }),
      updateUser: (patch) =>
        set((s) =>
          s.currentUser ? { currentUser: { ...s.currentUser, ...patch } } : {}
        ),
    }),
    {
      name: 'auth',
      partialize: (s) => ({
        isAuthenticated: s.isAuthenticated,
        currentUser: s.currentUser,
        accessToken: s.accessToken,
        role: s.role,
        deviceId: s.deviceId,
      }),
    }
  )
)
