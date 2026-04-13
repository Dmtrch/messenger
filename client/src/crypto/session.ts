import { api, type DeviceBundle } from '@/api/client'
import * as keystore from '@/crypto/keystore'

import {
  createSessionWebRuntime,
  createSessionWebStoreAdapter,
  type SessionWebRuntime,
} from '../../../shared/native-core/crypto/web/session-web'

const runtime: SessionWebRuntime = createSessionWebRuntime({
  api,
  store: createSessionWebStoreAdapter(keystore),
})

export function encryptForAllDevices(
  recipientId: string,
  bundles: DeviceBundle[],
  plaintext: string,
) {
  return runtime.encryptForAllDevices(recipientId, bundles, plaintext)
}

export function encryptMessage(
  recipientId: string,
  plaintext: string,
) {
  return runtime.encryptMessage(recipientId, plaintext)
}

export function encryptGroupMessage(
  chatId: string,
  myUserId: string,
  members: string[],
  plaintext: string,
) {
  return runtime.encryptGroupMessage(chatId, myUserId, members, plaintext)
}

export function decryptGroupMessage(
  chatId: string,
  senderId: string,
  encodedPayload: string,
) {
  return runtime.decryptGroupMessage(chatId, senderId, encodedPayload)
}

export function handleIncomingSKDM(
  chatId: string,
  senderId: string,
  senderDeviceId: string,
  encodedSkdm: string,
) {
  return runtime.handleIncomingSKDM(chatId, senderId, senderDeviceId, encodedSkdm)
}

export function decryptMessage(
  senderId: string,
  senderDeviceId: string,
  encodedPayload: string,
) {
  return runtime.decryptMessage(senderId, senderDeviceId, encodedPayload)
}

export function invalidateGroupSenderKey(chatId: string) {
  return runtime.invalidateGroupSenderKey(chatId)
}

export function tryDecryptPreview(
  chatType: 'direct' | 'group',
  chatId: string,
  senderId: string,
  senderDeviceId: string,
  encryptedPayload: string,
) {
  return runtime.tryDecryptPreview(chatType, chatId, senderId, senderDeviceId, encryptedPayload)
}
