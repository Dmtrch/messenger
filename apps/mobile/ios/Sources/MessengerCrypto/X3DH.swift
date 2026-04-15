// X3DH.swift — Extended Triple Diffie-Hellman (Signal Protocol, Alice-initiator).
// Совместим с TypeScript-реализацией (web client) и Kotlin-реализацией (Desktop/Android).
//
// Порядок DH (Signal X3DH):
//   dh1 = Alice_IK_curve × Bob_SPK
//   dh2 = Alice_EK     × Bob_IK_curve
//   dh3 = Alice_EK     × Bob_SPK
//   dh4 = Alice_EK     × Bob_OPK   (если OPK присутствует)
// Результат: BLAKE2b-хеш конкатенации dh1‖dh2‖dh3[‖dh4]

import Sodium
import Clibsodium

enum X3DHError: Error {
    case scalarmultFailed
    case conversionFailed
    case hashFailed
}

final class X3DH {
    private let sodium = Sodium()

    /// Вычисляет shared secret по стандартной схеме X3DH.
    ///
    /// - Parameters:
    ///   - aliceIKPrivEd:  64-байтовый ed25519 secret key Alice (identity key)
    ///   - aliceEKPriv:    32-байтовый curve25519 private key Alice (ephemeral key)
    ///   - bobIKPubEd:     32-байтовый ed25519 public key Bob (identity key)
    ///   - bobSPKPub:      32-байтовый curve25519 public key Bob (signed pre-key)
    ///   - bobOPKPub:      32-байтовый curve25519 public key Bob (one-time pre-key, опционально)
    /// - Returns: 32-байтовый shared secret
    func computeSharedSecret(
        aliceIKPrivEd: Bytes,
        aliceEKPriv: Bytes,
        bobIKPubEd: Bytes,
        bobSPKPub: Bytes,
        bobOPKPub: Bytes? = nil
    ) throws -> Bytes {
        precondition(aliceIKPrivEd.count == 64, "ed25519 secret key must be 64 bytes")
        precondition(aliceEKPriv.count == 32, "curve25519 ephemeral key must be 32 bytes")
        precondition(bobIKPubEd.count == 32, "ed25519 public key must be 32 bytes")
        precondition(bobSPKPub.count == 32, "curve25519 SPK must be 32 bytes")

        let aliceIKCurvePriv = try ed25519SkToCurve25519(aliceIKPrivEd)
        let bobIKCurvePub    = try ed25519PkToCurve25519(bobIKPubEd)

        let dh1 = try scalarmult(priv: aliceIKCurvePriv, pub: bobSPKPub)
        let dh2 = try scalarmult(priv: aliceEKPriv,     pub: bobIKCurvePub)
        let dh3 = try scalarmult(priv: aliceEKPriv,     pub: bobSPKPub)

        var combined = dh1 + dh2 + dh3
        if let opk = bobOPKPub {
            precondition(opk.count == 32, "curve25519 OPK must be 32 bytes")
            let dh4 = try scalarmult(priv: aliceEKPriv, pub: opk)
            combined += dh4
        }

        guard let hash = sodium.genericHash.hash(message: combined, outputLength: 32) else {
            throw X3DHError.hashFailed
        }
        return hash
    }

    // MARK: - Private helpers

    private func scalarmult(priv: Bytes, pub: Bytes) throws -> Bytes {
        var out = Bytes(repeating: 0, count: 32)
        let rc = crypto_scalarmult_curve25519(&out, priv, pub)
        guard rc == 0 else { throw X3DHError.scalarmultFailed }
        return out
    }

    private func ed25519PkToCurve25519(_ pk: Bytes) throws -> Bytes {
        var out = Bytes(repeating: 0, count: 32)
        let rc = crypto_sign_ed25519_pk_to_curve25519(&out, pk)
        guard rc == 0 else { throw X3DHError.conversionFailed }
        return out
    }

    private func ed25519SkToCurve25519(_ sk: Bytes) throws -> Bytes {
        // ed25519 secret key (64 bytes) → первые 32 байта — seed;
        // crypto_sign_ed25519_sk_to_curve25519 принимает полный 64-байтовый sk
        var out = Bytes(repeating: 0, count: 32)
        let rc = crypto_sign_ed25519_sk_to_curve25519(&out, sk)
        guard rc == 0 else { throw X3DHError.conversionFailed }
        return out
    }
}
