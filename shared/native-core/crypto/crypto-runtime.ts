import type {
  DeviceIdentityKeyPair,
  DeviceKeyPair,
  InMemoryStorageRuntime,
} from '../storage/storage-runtime'

export interface DeviceBundle {
  deviceId: string
  ikPublic: Uint8Array
  spkId: number
  spkPublic: Uint8Array
  spkSignature: Uint8Array
  opkId?: number
  opkPublic?: Uint8Array
}

export interface OutboundBootstrap {
  ephemeralPublicKey: Uint8Array
  usedOpkId?: number
}

export interface InboundPayload {
  ikPublic: Uint8Array
  ekPublic: Uint8Array
  opkId?: number
  ciphertext: Uint8Array
}

export interface RatchetRuntimeState {
  sessionKey: Uint8Array
  sendChainKey: Uint8Array | null
  recvChainKey: Uint8Array | null
}

export interface SenderKeyRuntimeState {
  chainKey: Uint8Array
  iteration: number
  signingPublicKey: Uint8Array
  signingPrivateKey: Uint8Array
}

export interface SenderKeyDistribution {
  senderId: string
  chatId: string
  chainKey: Uint8Array
  iteration: number
  signingPublicKey: Uint8Array
}

export interface CryptoAdapter {
  generateIdentityKeyPair(): DeviceIdentityKeyPair
  generateSignedPreKey(): DeviceKeyPair
  signPreKey(publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array
  generateEphemeralKeyPair(): DeviceKeyPair
  createOutboundSharedSecret(input: {
    identityKeyPair: DeviceIdentityKeyPair
    ephemeralKeyPair: DeviceKeyPair
    bundle: DeviceBundle
  }): {
    sharedSecret: Uint8Array
    ephemeralPublicKey: Uint8Array
    usedOpkId?: number
    ratchetKeyPair: DeviceKeyPair
  }
  createInboundSharedSecret(input: {
    identityKeyPair: DeviceIdentityKeyPair
    signedPreKey: DeviceKeyPair
    oneTimePreKey: DeviceKeyPair | null
    senderIkPublic: Uint8Array
    senderEkPublic: Uint8Array
  }): Uint8Array
  initOutboundRatchet(
    sharedSecret: Uint8Array,
    ourKeyPair: DeviceKeyPair,
    remotePublicKey: Uint8Array,
  ): Promise<RatchetRuntimeState>
  initInboundRatchet(
    sharedSecret: Uint8Array,
    ourKeyPair: DeviceKeyPair,
    remotePublicKey: Uint8Array,
  ): Promise<RatchetRuntimeState>
  decryptMessage(state: RatchetRuntimeState, ciphertext: Uint8Array): Promise<{
    plaintext: string
    nextState: RatchetRuntimeState
  }>
  encryptMessage(state: RatchetRuntimeState, plaintext: string): Promise<{
    ciphertext: Uint8Array
    nextState: RatchetRuntimeState
  }>
  generateSenderKey(): Promise<SenderKeyRuntimeState>
  createSenderKeyDistribution(
    senderId: string,
    chatId: string,
    state: SenderKeyRuntimeState,
  ): SenderKeyDistribution
  importSenderKeyDistribution(distribution: SenderKeyDistribution): SenderKeyRuntimeState
  encryptGroupMessage(
    state: SenderKeyRuntimeState,
    chatId: string,
    plaintext: string,
  ): Promise<{ payload: Uint8Array; nextState: SenderKeyRuntimeState }>
  decryptGroupMessage(
    state: SenderKeyRuntimeState,
    payload: Uint8Array,
  ): Promise<{ plaintext: string; nextState: SenderKeyRuntimeState }>
}

export interface CryptoRuntimeOptions {
  storage: InMemoryStorageRuntime
  adapter: CryptoAdapter
  now?: () => number
}

export class CryptoRuntime {
  private readonly now: () => number

  constructor(private readonly options: CryptoRuntimeOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  async generateIdentityBundle(deviceId = 'current-device'): Promise<{
    deviceIdentity: DeviceBundle
  }> {
    const identityKeyPair = this.options.adapter.generateIdentityKeyPair()
    const signedPreKey = this.options.adapter.generateSignedPreKey()
    const signature = this.options.adapter.signPreKey(
      signedPreKey.publicKey,
      identityKeyPair.privateKey,
    )

    await this.options.storage.saveIdentityKey(identityKeyPair)
    await this.options.storage.saveSignedPreKey(signedPreKey)

    return {
      deviceIdentity: {
        deviceId,
        ikPublic: identityKeyPair.publicKey,
        spkId: signedPreKey.id,
        spkPublic: signedPreKey.publicKey,
        spkSignature: signature,
      },
    }
  }

  async createOutboundSession(
    peerUserId: string,
    peerDeviceId: string,
    bundle: DeviceBundle,
  ): Promise<{
    sessionId: string
    bootstrap: OutboundBootstrap
    serializedState: Uint8Array
  }> {
    const identityKeyPair = await this.options.storage.loadIdentityKey()
    if (!identityKeyPair) throw new Error('Identity key not found')

    const ephemeralKeyPair = this.options.adapter.generateEphemeralKeyPair()
    const bootstrap = this.options.adapter.createOutboundSharedSecret({
      identityKeyPair,
      ephemeralKeyPair,
      bundle,
    })
    const state = await this.options.adapter.initOutboundRatchet(
      bootstrap.sharedSecret,
      bootstrap.ratchetKeyPair,
      bundle.spkPublic,
    )

    const sessionId = this.buildSessionId(peerUserId, peerDeviceId)
    const serializedState = this.serializeState(state)
    await this.persistSession(sessionId, serializedState)

    return {
      sessionId,
      bootstrap: {
        ephemeralPublicKey: bootstrap.ephemeralPublicKey,
        usedOpkId: bootstrap.usedOpkId,
      },
      serializedState,
    }
  }

  async decryptInboundSessionMessage(
    senderUserId: string,
    senderDeviceId: string,
    payload: InboundPayload,
  ): Promise<{
    plaintext: string
    serializedState: Uint8Array
  }> {
    const sessionId = this.buildSessionId(senderUserId, senderDeviceId)
    let state = await this.loadState(sessionId)

    if (!state) {
      const identityKeyPair = await this.options.storage.loadIdentityKey()
      const signedPreKey = await this.options.storage.loadSignedPreKey()
      if (!identityKeyPair || !signedPreKey) {
        throw new Error('Local identity bundle not found')
      }

      const oneTimePreKey = payload.opkId !== undefined
        ? await this.options.storage.consumeOneTimePreKey(payload.opkId)
        : null

      const sharedSecret = this.options.adapter.createInboundSharedSecret({
        identityKeyPair,
        signedPreKey,
        oneTimePreKey,
        senderIkPublic: payload.ikPublic,
        senderEkPublic: payload.ekPublic,
      })
      state = await this.options.adapter.initInboundRatchet(
        sharedSecret,
        signedPreKey,
        payload.ekPublic,
      )
    }

    const decrypted = await this.options.adapter.decryptMessage(state, payload.ciphertext)
    const serializedState = this.serializeState(decrypted.nextState)
    await this.persistSession(sessionId, serializedState)

    return {
      plaintext: decrypted.plaintext,
      serializedState,
    }
  }

  async encryptForDevices(
    _chatId: string,
    recipients: Array<{ userId: string; bundle: DeviceBundle }>,
    plaintext: string,
  ): Promise<Array<{
    userId: string
    deviceId: string
    ciphertext: Uint8Array
    bootstrap?: OutboundBootstrap
    serializedState: Uint8Array
  }>> {
    const results = []

    for (const recipient of recipients) {
      const sessionId = this.buildSessionId(recipient.userId, recipient.bundle.deviceId)
      let state = await this.loadState(sessionId)
      let bootstrap: OutboundBootstrap | undefined

      if (!state) {
        const created = await this.createOutboundSession(
          recipient.userId,
          recipient.bundle.deviceId,
          recipient.bundle,
        )
        state = this.deserializeState(created.serializedState)
        bootstrap = created.bootstrap
      }

      const encrypted = await this.options.adapter.encryptMessage(state, plaintext)
      const serializedState = this.serializeState(encrypted.nextState)
      await this.persistSession(sessionId, serializedState)

      results.push({
        userId: recipient.userId,
        deviceId: recipient.bundle.deviceId,
        ciphertext: encrypted.ciphertext,
        bootstrap,
        serializedState,
      })
    }

    return results
  }

  async encryptGroupMessage(
    chatId: string,
    senderId: string,
    members: string[],
    plaintext: string,
  ): Promise<{
    payload: Uint8Array
    distributions: Array<{ userId: string; distribution: SenderKeyDistribution }>
  }> {
    let state = await this.loadMySenderKeyState(chatId)
    const distributions: Array<{ userId: string; distribution: SenderKeyDistribution }> = []

    if (!state) {
      state = await this.options.adapter.generateSenderKey()
      const distribution = this.options.adapter.createSenderKeyDistribution(senderId, chatId, state)
      for (const memberId of members) {
        if (memberId === senderId) continue
        distributions.push({ userId: memberId, distribution })
      }
    }

    const encrypted = await this.options.adapter.encryptGroupMessage(state, chatId, plaintext)
    await this.options.storage.saveMySenderKey(chatId, this.serializeSenderKeyState(encrypted.nextState))

    return {
      payload: encrypted.payload,
      distributions,
    }
  }

  async handleIncomingSenderKeyDistribution(
    chatId: string,
    senderId: string,
    distribution: SenderKeyDistribution,
  ): Promise<void> {
    const state = this.options.adapter.importSenderKeyDistribution(distribution)
    await this.options.storage.savePeerSenderKey(
      chatId,
      senderId,
      this.serializeSenderKeyState(state),
    )
  }

  async decryptGroupMessage(
    chatId: string,
    senderId: string,
    payload: Uint8Array,
  ): Promise<string> {
    const serialized = await this.options.storage.loadPeerSenderKey(chatId, senderId)
    if (!serialized) throw new Error('Peer sender key not found')

    const state = this.deserializeSenderKeyState(serialized)
    const decrypted = await this.options.adapter.decryptGroupMessage(state, payload)
    await this.options.storage.savePeerSenderKey(
      chatId,
      senderId,
      this.serializeSenderKeyState(decrypted.nextState),
    )
    return decrypted.plaintext
  }

  private buildSessionId(peerUserId: string, peerDeviceId: string): string {
    return `${peerUserId}:${peerDeviceId}`
  }

  private async loadState(sessionId: string): Promise<RatchetRuntimeState | null> {
    const stored = await this.options.storage.loadRatchetSession(sessionId)
    if (!stored) return null
    return this.deserializeState(stored.state)
  }

  private async persistSession(sessionId: string, serializedState: Uint8Array): Promise<void> {
    await this.options.storage.saveRatchetSession({
      sessionKey: sessionId,
      state: serializedState,
      updatedAt: this.now(),
    })
  }

  private serializeState(state: RatchetRuntimeState): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({
      sessionKey: Array.from(state.sessionKey),
      sendChainKey: state.sendChainKey ? Array.from(state.sendChainKey) : null,
      recvChainKey: state.recvChainKey ? Array.from(state.recvChainKey) : null,
    }))
  }

  private deserializeState(data: Uint8Array): RatchetRuntimeState {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as {
      sessionKey: number[]
      sendChainKey: number[] | null
      recvChainKey: number[] | null
    }

    return {
      sessionKey: new Uint8Array(parsed.sessionKey),
      sendChainKey: parsed.sendChainKey ? new Uint8Array(parsed.sendChainKey) : null,
      recvChainKey: parsed.recvChainKey ? new Uint8Array(parsed.recvChainKey) : null,
    }
  }

  private async loadMySenderKeyState(chatId: string): Promise<SenderKeyRuntimeState | null> {
    const serialized = await this.options.storage.loadMySenderKey(chatId)
    return serialized ? this.deserializeSenderKeyState(serialized) : null
  }

  private serializeSenderKeyState(state: SenderKeyRuntimeState): string {
    return JSON.stringify({
      chainKey: Array.from(state.chainKey),
      iteration: state.iteration,
      signingPublicKey: Array.from(state.signingPublicKey),
      signingPrivateKey: Array.from(state.signingPrivateKey),
    })
  }

  private deserializeSenderKeyState(data: string): SenderKeyRuntimeState {
    const parsed = JSON.parse(data) as {
      chainKey: number[]
      iteration: number
      signingPublicKey: number[]
      signingPrivateKey: number[]
    }

    return {
      chainKey: new Uint8Array(parsed.chainKey),
      iteration: parsed.iteration,
      signingPublicKey: new Uint8Array(parsed.signingPublicKey),
      signingPrivateKey: new Uint8Array(parsed.signingPrivateKey),
    }
  }
}
