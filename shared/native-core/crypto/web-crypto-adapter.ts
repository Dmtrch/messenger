import type {
  CryptoAdapter,
  DeviceBundle,
  RatchetRuntimeState,
  SenderKeyDistribution,
  SenderKeyRuntimeState,
} from './crypto-runtime'
import type {
  DeviceIdentityKeyPair,
  DeviceKeyPair,
} from '../storage/storage-runtime'
import {
  toBase64,
  generateDHKeyPair,
  generateIdentityKeyPair,
  initSodium,
  signData,
  x3dhInitiatorAgreement,
  x3dhResponderAgreement,
} from './web/x3dh-web'
import {
  deserializeRatchetState,
  initRatchet,
  ratchetDecrypt,
  ratchetEncrypt,
  serializeRatchetState,
  type EncryptedMessage,
} from './web/ratchet-web'
import {
  createSKDistribution,
  deserializeSenderKeyState,
  generateSenderKey,
  importSKDistribution,
  senderKeyDecrypt,
  senderKeyEncrypt,
  serializeSenderKeyState,
  type GroupWirePayload,
  type SenderKeyState,
} from './web/senderkey-web'

export class WebCryptoAdapter implements CryptoAdapter {
  async ready(): Promise<void> {
    await initSodium()
  }

  generateIdentityKeyPair(): DeviceIdentityKeyPair {
    return generateIdentityKeyPair()
  }

  generateSignedPreKey(): DeviceKeyPair {
    return generateDHKeyPair()
  }

  signPreKey(publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array {
    return signData(publicKey, privateKey)
  }

  generateEphemeralKeyPair(): DeviceKeyPair {
    return generateDHKeyPair()
  }

  createOutboundSharedSecret(input: {
    identityKeyPair: DeviceIdentityKeyPair
    ephemeralKeyPair: DeviceKeyPair
    bundle: DeviceBundle
  }): {
    sharedSecret: Uint8Array
    ephemeralPublicKey: Uint8Array
    usedOpkId?: number
    ratchetKeyPair: DeviceKeyPair
  } {
    const result = x3dhInitiatorAgreement(
      input.identityKeyPair,
      input.ephemeralKeyPair,
      {
        ikPublic: input.bundle.ikPublic,
        spkId: input.bundle.spkId,
        spkPublic: input.bundle.spkPublic,
        spkSignature: input.bundle.spkSignature,
        opkId: input.bundle.opkId,
        opkPublic: input.bundle.opkPublic,
      },
    )

    return {
      sharedSecret: result.sharedSecret,
      ephemeralPublicKey: result.ephemeralKeyPublic,
      usedOpkId: result.usedOpkId,
      ratchetKeyPair: input.ephemeralKeyPair,
    }
  }

  createInboundSharedSecret(input: {
    identityKeyPair: DeviceIdentityKeyPair
    signedPreKey: DeviceKeyPair
    oneTimePreKey: DeviceKeyPair | null
    senderIkPublic: Uint8Array
    senderEkPublic: Uint8Array
  }): Uint8Array {
    return x3dhResponderAgreement(
      input.identityKeyPair,
      input.signedPreKey,
      input.oneTimePreKey ?? undefined,
      input.senderIkPublic,
      input.senderEkPublic,
    )
  }

  async initOutboundRatchet(
    sharedSecret: Uint8Array,
    ourKeyPair: DeviceKeyPair,
    remotePublicKey: Uint8Array,
  ): Promise<RatchetRuntimeState> {
    const state = await initRatchet(sharedSecret, ourKeyPair, remotePublicKey, true)
    return this.toRuntimeState(state)
  }

  async initInboundRatchet(
    sharedSecret: Uint8Array,
    ourKeyPair: DeviceKeyPair,
    remotePublicKey: Uint8Array,
  ): Promise<RatchetRuntimeState> {
    const state = await initRatchet(sharedSecret, ourKeyPair, remotePublicKey, false)
    return this.toRuntimeState(state)
  }

  async encryptMessage(state: RatchetRuntimeState, plaintext: string): Promise<{
    ciphertext: Uint8Array
    nextState: RatchetRuntimeState
  }> {
    const encrypted = await ratchetEncrypt(this.fromRuntimeState(state), plaintext)
    return {
      ciphertext: new TextEncoder().encode(JSON.stringify(encrypted.message)),
      nextState: this.toRuntimeState(encrypted.nextState),
    }
  }

  async decryptMessage(state: RatchetRuntimeState, ciphertext: Uint8Array): Promise<{
    plaintext: string
    nextState: RatchetRuntimeState
  }> {
    const message = JSON.parse(new TextDecoder().decode(ciphertext)) as EncryptedMessage
    const decrypted = await ratchetDecrypt(this.fromRuntimeState(state), message)
    return {
      plaintext: decrypted.plaintext,
      nextState: this.toRuntimeState(decrypted.nextState),
    }
  }

  async generateSenderKey(): Promise<SenderKeyRuntimeState> {
    return this.toSenderKeyRuntimeState(await generateSenderKey())
  }

  createSenderKeyDistribution(
    senderId: string,
    chatId: string,
    state: SenderKeyRuntimeState,
  ): SenderKeyDistribution {
    return {
      ...createSKDistribution(
        senderId,
        chatId,
        this.fromSenderKeyRuntimeState(state),
      ),
      chainKey: this.fromSenderKeyRuntimeState(state).chainKey,
      signingPublicKey: this.fromSenderKeyRuntimeState(state).signingKeyPair.publicKey,
    }
  }

  importSenderKeyDistribution(distribution: SenderKeyDistribution): SenderKeyRuntimeState {
    return this.toSenderKeyRuntimeState(importSKDistribution({
      senderId: distribution.senderId,
      chatId: distribution.chatId,
      chainKey: toBase64(distribution.chainKey),
      iteration: distribution.iteration,
      signingPublicKey: toBase64(distribution.signingPublicKey),
    }))
  }

  async encryptGroupMessage(
    state: SenderKeyRuntimeState,
    chatId: string,
    plaintext: string,
  ): Promise<{ payload: Uint8Array; nextState: SenderKeyRuntimeState }> {
    const encrypted = await senderKeyEncrypt(this.fromSenderKeyRuntimeState(state), chatId, plaintext)
    return {
      payload: new TextEncoder().encode(JSON.stringify(encrypted.payload)),
      nextState: this.toSenderKeyRuntimeState(encrypted.nextState),
    }
  }

  async decryptGroupMessage(
    state: SenderKeyRuntimeState,
    payload: Uint8Array,
  ): Promise<{ plaintext: string; nextState: SenderKeyRuntimeState }> {
    const wirePayload = JSON.parse(new TextDecoder().decode(payload)) as GroupWirePayload
    const decrypted = await senderKeyDecrypt(this.fromSenderKeyRuntimeState(state), wirePayload)
    return {
      plaintext: decrypted.plaintext,
      nextState: this.toSenderKeyRuntimeState(decrypted.nextState),
    }
  }

  private toRuntimeState(state: Awaited<ReturnType<typeof initRatchet>>): RatchetRuntimeState {
    return {
      sessionKey: serializeRatchetState(state),
      sendChainKey: state.sendChainKey,
      recvChainKey: state.recvChainKey,
    }
  }

  private fromRuntimeState(state: RatchetRuntimeState) {
    return deserializeRatchetState(state.sessionKey)
  }

  private toSenderKeyRuntimeState(state: SenderKeyState): SenderKeyRuntimeState {
    return {
      chainKey: state.chainKey,
      iteration: state.iteration,
      signingPublicKey: state.signingKeyPair.publicKey,
      signingPrivateKey: state.signingKeyPair.privateKey,
    }
  }

  private fromSenderKeyRuntimeState(state: SenderKeyRuntimeState): SenderKeyState {
    return deserializeSenderKeyState(serializeSenderKeyState({
      chainKey: state.chainKey,
      iteration: state.iteration,
      signingKeyPair: {
        publicKey: state.signingPublicKey,
        privateKey: state.signingPrivateKey,
      },
    }))
  }
}
