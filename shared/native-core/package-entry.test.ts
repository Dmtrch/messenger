import { describe, expect, it } from 'vitest'

import {
  AuthSessionRuntime,
  CALL_WS_SIGNAL_TYPES,
  CryptoRuntime,
  InMemoryMessageRepository,
  InMemoryStorageRuntime,
  SyncEngine,
  WS_MESSAGE_KINDS,
  WS_MESSAGE_STATUSES,
  WS_FRAME_TYPES,
  WSConnectionRuntime,
  WebCryptoAdapter,
  cancelBrowserTask,
  mapChatSummariesToRealtimeChats,
  mapChatSummaryToRealtimeChat,
  createCallController,
  createBrowserPeerConnectionAdapter,
  createBrowserSocketLike,
  createInitialCallSession,
  createBrowserWebRTCRuntime,
  createBrowserUserMediaGetter,
  createCallHandlerOrchestrator,
  resolveBrowserWsBaseUrl,
  scheduleBrowserRealtimeTask,
  scheduleBrowserTask,
} from './index'

describe('shared/native-core package entry', () => {
  it('переэкспортирует основные runtime-модули', () => {
    expect(AuthSessionRuntime).toBeTypeOf('function')
    expect(WSConnectionRuntime).toBeTypeOf('function')
    expect(InMemoryMessageRepository).toBeTypeOf('function')
    expect(SyncEngine).toBeTypeOf('function')
    expect(InMemoryStorageRuntime).toBeTypeOf('function')
    expect(CryptoRuntime).toBeTypeOf('function')
    expect(WebCryptoAdapter).toBeTypeOf('function')
    expect(createCallController).toBeTypeOf('function')
    expect(createInitialCallSession).toBeTypeOf('function')
    expect(createBrowserWebRTCRuntime).toBeTypeOf('function')
    expect(createBrowserPeerConnectionAdapter).toBeTypeOf('function')
    expect(createBrowserUserMediaGetter).toBeTypeOf('function')
    expect(createCallHandlerOrchestrator).toBeTypeOf('function')
    expect(createBrowserSocketLike).toBeTypeOf('function')
    expect(resolveBrowserWsBaseUrl).toBeTypeOf('function')
    expect(mapChatSummaryToRealtimeChat).toBeTypeOf('function')
    expect(mapChatSummariesToRealtimeChats).toBeTypeOf('function')
    expect(scheduleBrowserRealtimeTask).toBeTypeOf('function')
    expect(scheduleBrowserTask).toBeTypeOf('function')
    expect(cancelBrowserTask).toBeTypeOf('function')
    expect(CALL_WS_SIGNAL_TYPES).toContain('call_offer')
    expect(CALL_WS_SIGNAL_TYPES).toContain('ice_candidate')
    expect(WS_FRAME_TYPES).toContain('message')
    expect(WS_FRAME_TYPES).toContain('typing')
    expect(WS_MESSAGE_KINDS).toContain('text')
    expect(WS_MESSAGE_STATUSES).toContain('delivered')
  })
})
