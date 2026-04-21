import { create } from 'zustand'

interface ServerInfoState {
  allowUsersCreateGroups: boolean
  setAllowUsersCreateGroups: (value: boolean) => void
  maxUploadBytes: number
  setMaxUploadBytes: (value: number) => void
}

export const useServerInfoStore = create<ServerInfoState>()((set) => ({
  allowUsersCreateGroups: true, // по умолчанию разрешено
  setAllowUsersCreateGroups: (value) => set({ allowUsersCreateGroups: value }),
  maxUploadBytes: 100 * 1024 * 1024, // 100 МБ по умолчанию
  setMaxUploadBytes: (value) => set({ maxUploadBytes: value }),
}))
