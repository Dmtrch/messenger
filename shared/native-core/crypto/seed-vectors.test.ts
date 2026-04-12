import { beforeAll, describe, expect, it } from 'vitest'

import { WebCryptoAdapter } from './web-crypto-adapter'
import {
  loadVectorManifest,
  runDoubleRatchetSeedVector,
  runSenderKeySeedVector,
  runX3DHSeedVector,
} from './test-vector-runner'

describe('shared test vectors', () => {
  let adapter: WebCryptoAdapter

  beforeAll(async () => {
    adapter = new WebCryptoAdapter()
    await adapter.ready()
  })

  it('manifest перечисляет все crypto suites', async () => {
    const manifest = await loadVectorManifest()
    expect(manifest.vectors.map((entry) => entry.id)).toEqual([
      'x3dh-handshake',
      'double-ratchet-sequence',
      'sender-key-group',
    ])
  })

  it('x3dh seed vector проходит на реальном adapter', async () => {
    const result = await runX3DHSeedVector(adapter)
    expect(result.matchesSharedSecret).toBe(true)
    expect(result.deviceScoped).toBe(true)
  })

  it('double-ratchet seed vector проходит на реальном adapter', async () => {
    const result = await runDoubleRatchetSeedVector(adapter)
    expect(result.decryptedOrder).toEqual(['message-1', 'message-3', 'message-2'])
    expect(result.outOfOrderSupported).toBe(true)
  })

  it('sender-key seed vector проходит на реальном adapter', async () => {
    const result = await runSenderKeySeedVector(adapter)
    expect(result.decryptedPayload).toBe('group-message-1')
    expect(result.distributionCompatible).toBe(true)
  })
})
