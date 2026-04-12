import { describe, expect, it } from 'vitest'

import {
  AuthSessionRuntime,
  CryptoRuntime,
  InMemoryMessageRepository,
  InMemoryStorageRuntime,
  SyncEngine,
  WSConnectionRuntime,
  WebCryptoAdapter,
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
  })
})
