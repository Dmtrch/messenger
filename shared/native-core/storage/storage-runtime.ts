export interface DeviceIdentityKeyPair {
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface DeviceKeyPair {
  id: number
  publicKey: Uint8Array
  privateKey: Uint8Array
}

export interface RatchetSessionRecord {
  sessionKey: string
  state: Uint8Array
  updatedAt: number
}

export interface DeviceRecord {
  id: string
  userId: string
  deviceName: string
  platform: 'desktop' | 'android' | 'ios' | 'web'
  createdAt: number
  lastSeenAt?: number
  isCurrentDevice: boolean
}

export interface AttachmentRecord {
  mediaId: string
  chatId?: string
  originalName?: string
  contentType?: string
  mediaKey?: string
  kind: 'image' | 'file' | 'video' | 'audio'
}

export class InMemoryStorageRuntime {
  private identityKey: DeviceIdentityKeyPair | null = null
  private signedPreKey: DeviceKeyPair | null = null
  private oneTimePreKeys: DeviceKeyPair[] = []
  private readonly ratchetSessions = new Map<string, RatchetSessionRecord>()
  private readonly mySenderKeys = new Map<string, string>()
  private readonly peerSenderKeys = new Map<string, string>()
  private currentDevice: DeviceRecord | null = null
  private deviceId: string | null = null
  private readonly attachments = new Map<string, AttachmentRecord>()
  private readonly settings = new Map<string, unknown>()
  private pushSubscription: PushSubscriptionJSON | null = null

  async saveIdentityKey(pair: DeviceIdentityKeyPair): Promise<void> {
    this.identityKey = pair
  }

  async loadIdentityKey(): Promise<DeviceIdentityKeyPair | null> {
    return this.identityKey
  }

  async saveSignedPreKey(pair: DeviceKeyPair): Promise<void> {
    this.signedPreKey = pair
  }

  async loadSignedPreKey(): Promise<DeviceKeyPair | null> {
    return this.signedPreKey
  }

  async saveOneTimePreKeys(keys: DeviceKeyPair[]): Promise<void> {
    this.oneTimePreKeys = [...keys]
  }

  async loadOneTimePreKeys(): Promise<DeviceKeyPair[]> {
    return [...this.oneTimePreKeys]
  }

  async consumeOneTimePreKey(id: number): Promise<DeviceKeyPair | null> {
    const key = this.oneTimePreKeys.find((candidate) => candidate.id === id) ?? null
    if (!key) return null

    this.oneTimePreKeys = this.oneTimePreKeys.filter((candidate) => candidate.id !== id)
    return key
  }

  async appendOneTimePreKeys(
    keys: Array<Omit<DeviceKeyPair, 'id'>>,
  ): Promise<DeviceKeyPair[]> {
    const maxId = this.oneTimePreKeys.reduce((current, key) => Math.max(current, key.id), 0)
    const appended = keys.map((key, index) => ({
      ...key,
      id: maxId + index + 1,
    }))
    this.oneTimePreKeys = [...this.oneTimePreKeys, ...appended]
    return appended
  }

  async saveRatchetSession(record: RatchetSessionRecord): Promise<void> {
    this.ratchetSessions.set(record.sessionKey, record)
  }

  async loadRatchetSession(sessionKey: string): Promise<RatchetSessionRecord | null> {
    return this.ratchetSessions.get(sessionKey) ?? null
  }

  async deleteRatchetSession(sessionKey: string): Promise<void> {
    this.ratchetSessions.delete(sessionKey)
  }

  async saveMySenderKey(chatId: string, serialized: string): Promise<void> {
    this.mySenderKeys.set(chatId, serialized)
  }

  async loadMySenderKey(chatId: string): Promise<string | null> {
    return this.mySenderKeys.get(chatId) ?? null
  }

  async deleteMySenderKey(chatId: string): Promise<void> {
    this.mySenderKeys.delete(chatId)
  }

  async savePeerSenderKey(chatId: string, senderId: string, serialized: string): Promise<void> {
    this.peerSenderKeys.set(`${chatId}:${senderId}`, serialized)
  }

  async loadPeerSenderKey(chatId: string, senderId: string): Promise<string | null> {
    return this.peerSenderKeys.get(`${chatId}:${senderId}`) ?? null
  }

  async saveCurrentDevice(device: DeviceRecord): Promise<void> {
    this.currentDevice = device
  }

  async loadCurrentDevice(): Promise<DeviceRecord | null> {
    return this.currentDevice
  }

  async saveDeviceId(deviceId: string): Promise<void> {
    this.deviceId = deviceId
  }

  async loadDeviceId(): Promise<string | null> {
    return this.deviceId
  }

  async saveAttachmentMetadata(attachment: AttachmentRecord): Promise<void> {
    this.attachments.set(attachment.mediaId, attachment)
  }

  async getAttachment(mediaId: string): Promise<AttachmentRecord | null> {
    return this.attachments.get(mediaId) ?? null
  }

  async bindAttachment(mediaId: string, chatId: string): Promise<void> {
    const current = this.attachments.get(mediaId)
    if (!current) return

    this.attachments.set(mediaId, {
      ...current,
      chatId,
    })
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.settings.set(key, value)
  }

  async getSetting<T>(key: string): Promise<T | null> {
    return (this.settings.get(key) as T | undefined) ?? null
  }

  async removeSetting(key: string): Promise<void> {
    this.settings.delete(key)
  }

  async savePushSubscription(subscription: PushSubscriptionJSON): Promise<void> {
    this.pushSubscription = subscription
  }

  async loadPushSubscription(): Promise<PushSubscriptionJSON | null> {
    return this.pushSubscription
  }
}
