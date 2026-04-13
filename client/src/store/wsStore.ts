import { create } from 'zustand'
import type { WSSendFrame } from '../../../shared/native-core'

interface WsState {
  send: ((frame: WSSendFrame) => boolean) | null
  setSend: (fn: ((frame: WSSendFrame) => boolean) | null) => void
}

export const useWsStore = create<WsState>((set) => ({
  send: null,
  setSend: (fn) => set({ send: fn }),
}))
