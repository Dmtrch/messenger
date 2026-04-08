import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  isAuthenticated: boolean
  currentUser: User | null
  accessToken: string | null
  login: (user: User, token: string) => void
  logout: () => void
  updateUser: (patch: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      currentUser: null,
      accessToken: null,
      login: (user, token) =>
        set({ isAuthenticated: true, currentUser: user, accessToken: token }),
      logout: () =>
        set({ isAuthenticated: false, currentUser: null, accessToken: null }),
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
      }),
    }
  )
)
