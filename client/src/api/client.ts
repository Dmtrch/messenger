import { getServerUrl } from '@/config/serverConfig'

import {
  ApiError,
  createBrowserApiClient,
  type AuthLoginReq,
  type AuthLoginRes,
  type AuthRegisterReq,
  type AuthRegisterRes,
  type ChatSummary,
  type DeviceBundle,
  type LastMessageSummary,
  type MediaUploadRes,
  type MessageRecord,
  type MessagesPage,
  type PreKeyBundleResponse,
  type RegisterKeysReq,
  type RegisterKeysRes,
} from '../../../shared/native-core/api/web/browser-api-client'

const client = createBrowserApiClient({
  getBaseUrl() {
    try {
      return getServerUrl() || ''
    } catch {
      return ''
    }
  },
})

export const api = client.api
export const browserApiClient = client
export const setAccessToken = client.setAccessToken
export const uploadEncryptedMedia = client.api.uploadEncryptedMedia

export { ApiError }

export type {
  AuthLoginReq,
  AuthLoginRes,
  AuthRegisterReq,
  AuthRegisterRes,
  ChatSummary,
  DeviceBundle,
  LastMessageSummary,
  MediaUploadRes,
  MessageRecord,
  MessagesPage,
  PreKeyBundleResponse,
  RegisterKeysReq,
  RegisterKeysRes,
}
