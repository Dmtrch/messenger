export {
  fromBase64,
  generateDHKeyPair,
  generateIdentityKeyPair,
  initSodium,
  signData,
  toBase64,
  verifySignature,
  x3dhInitiatorAgreement,
  x3dhResponderAgreement,
} from '../../../shared/native-core/crypto/web/x3dh-web'

export type {
  DHKeyPair,
  IdentityKeyPair,
  PublicKeyBundle,
  X3DHResult,
} from '../../../shared/native-core/crypto/web/x3dh-web'
