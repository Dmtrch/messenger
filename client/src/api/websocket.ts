/**
 * Browser WebSocket facade поверх shared realtime transport.
 */

import { setAccessToken, api } from './client'
import { loadDeviceId } from '@/crypto/keystore'
import { getServerUrl } from '@/config/serverConfig'

import {
  createBrowserMessengerWS,
  createBrowserSocketLike,
  cancelBrowserTask,
  resolveBrowserWsBaseUrl,
  scheduleBrowserTask,
  type WSFrame,
  type WSSendFrame,
} from '../../../shared/native-core'

function getWsBase(): string {
  try {
    return resolveBrowserWsBaseUrl(getServerUrl(), window.location)
  } catch {
    return resolveBrowserWsBaseUrl(undefined, window.location)
  }
}

type FrameHandler = (frame: WSFrame) => void

export class MessengerWS {
  private readonly runtime

  constructor(
    token: string,
    onFrame: FrameHandler,
    onConnect?: () => void,
    onDisconnect?: () => void,
    onAuthFail?: () => void,
  ) {
    this.runtime = createBrowserMessengerWS<WSFrame, WSSendFrame>({
      token,
      onFrame,
      onConnect,
      onDisconnect,
      onAuthFail,
      createSocket(url) {
        return createBrowserSocketLike(new WebSocket(url))
      },
      getWsBaseUrl() {
        return getWsBase()
      },
      async loadDeviceId() {
        return loadDeviceId()
      },
      async refreshAuth() {
        return api.refresh()
      },
      setAccessToken(nextToken: string) {
        setAccessToken(nextToken)
      },
      schedule(delayMs, run) {
        return scheduleBrowserTask(window.setTimeout.bind(window), delayMs, run)
      },
      cancelScheduledReconnect(task) {
        cancelBrowserTask((nextTask) => clearTimeout(nextTask as number), task)
      },
    })
  }

  connect(): void {
    void this.runtime.connect()
  }

  disconnect(): void {
    this.runtime.disconnect()
  }

  send(frame: WSSendFrame): boolean {
    return this.runtime.send(frame)
  }

  updateToken(token: string): void {
    this.runtime.updateToken(token)
  }
}
