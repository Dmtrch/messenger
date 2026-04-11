/**
 * WebSocket клиент.
 *
 * Аутентификация: Bearer JWT в заголовке Authorization.
 * Браузерный WebSocket не поддерживает произвольные заголовки —
 * токен передаётся query-параметром ?token=<JWT> (Go backend читает оба варианта).
 *
 * При получении 401 от WS-эндпоинта выполняется refresh и повторное подключение.
 */

import type { WSFrame, WSSendFrame } from '@/types'
import { setAccessToken, api } from './client'
import { loadDeviceId } from '@/crypto/keystore'

function getWsBase(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host  // включает порт если есть
  return `${protocol}//${host}`
}

type FrameHandler = (frame: WSFrame) => void

export class MessengerWS {
  private ws: WebSocket | null = null
  private reconnectDelay = 1000
  private readonly maxDelay = 30000
  private intentionalClose = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private token: string

  constructor(
    token: string,
    private onFrame: FrameHandler,
    private onConnect?: () => void,
    private onDisconnect?: () => void,
    private onAuthFail?: () => void
  ) {
    this.token = token
  }

  connect(): void {
    this.intentionalClose = false
    this._open()
  }

  disconnect(): void {
    this.intentionalClose = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close(1000, 'intentional')
    this.ws = null
  }

  send(frame: WSSendFrame): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame))
      return true
    }
    return false
  }

  updateToken(token: string): void {
    this.token = token
  }

  private _open(): void {
    // deviceId передаётся асинхронно — подключаем после загрузки
    loadDeviceId().then((deviceId) => {
      const params = new URLSearchParams({ token: this.token })
      if (deviceId) params.set('deviceId', deviceId)
      const url = `${getWsBase()}/ws?${params}`
      this._openUrl(url)
    }).catch(() => {
      const url = `${getWsBase()}/ws?token=${encodeURIComponent(this.token)}`
      this._openUrl(url)
    })
  }

  private _openUrl(url: string): void {
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      this.onConnect?.()
    }

    this.ws.onmessage = (event) => {
      try {
        this.onFrame(JSON.parse(event.data as string) as WSFrame)
      } catch {
        // нераспознанный фрейм — игнорируем
      }
    }

    this.ws.onclose = (event) => {
      this.onDisconnect?.()
      if (this.intentionalClose) return

      // 4001 — кастомный код "unauthorized" от Go сервера (после WS upgrade)
      // 1006 — аномальное закрытие: может быть HTTP 401 до upgrade (старые версии)
      if (event.code === 4001 || (event.code === 1006 && !this._refreshAttempted)) {
        this._refreshAttempted = true
        this._handleAuthFailure()
        return
      }

      this._refreshAttempted = false
      this._scheduleReconnect()
    }

    this.ws.onerror = () => this.ws?.close()
  }

  private _refreshAttempted = false

  private async _handleAuthFailure(): Promise<void> {
    try {
      const res = await api.refresh()
      setAccessToken(res.accessToken)
      this.token = res.accessToken
      this._refreshAttempted = false
      this._scheduleReconnect(0)
    } catch {
      this.onAuthFail?.()
    }
  }

  private _scheduleReconnect(delay?: number): void {
    const ms = delay ?? this.reconnectDelay
    this.reconnectTimer = setTimeout(() => {
      if (delay === undefined) {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay)
      }
      this._open()
    }, ms)
  }
}
