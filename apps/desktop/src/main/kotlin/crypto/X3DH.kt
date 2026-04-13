package crypto

import com.goterl.lazysodium.LazySodiumJava

/**
 * X3DH (Extended Triple Diffie-Hellman) — установка сессии для Signal Protocol.
 * Реализует роль инициатора (Alice).
 * Совместим с TypeScript-реализацией на libsodium-wrappers.
 */
class X3DH(private val sodium: LazySodiumJava) {

    /**
     * Вычисляет shared secret по схеме X3DH (Alice-initiator).
     * Маппинг с TypeScript libsodium-wrappers:
     *   crypto_sign_ed25519_sk_to_curve25519  → convertSecretKeyEd25519ToCurve25519
     *   crypto_scalarmult                     → cryptoScalarMult
     *   crypto_generichash                    → cryptoGenericHash
     *
     * @param aliceIKPrivEd 64-байтовый ed25519 секретный ключ Alice (identity key)
     * @param aliceSPKPriv  32-байтовый curve25519 приватный ключ Alice (signed pre-key)
     * @param aliceOPKPriv  32-байтовый curve25519 приватный ключ Alice (one-time pre-key)
     * @param bobIKPubEd    32-байтовый ed25519 публичный ключ Bob (identity key)
     * @param bobSPKPub     32-байтовый curve25519 публичный ключ Bob (signed pre-key)
     * @return 32-байтовый shared secret
     */
    fun computeSharedSecret(
        aliceIKPrivEd: ByteArray,
        aliceSPKPriv: ByteArray,
        aliceOPKPriv: ByteArray,
        bobIKPubEd: ByteArray,
        bobSPKPub: ByteArray,
    ): ByteArray {
        // Конвертируем ed25519 ключи в curve25519
        val aliceIKCurvePriv = ed25519SkToCurve25519(aliceIKPrivEd)
        val bobIKCurvePub = ed25519PkToCurve25519(bobIKPubEd)

        // Четыре DH-обмена по спецификации X3DH
        val dh1 = scalarmult(aliceIKCurvePriv, bobSPKPub)
        val dh2 = scalarmult(aliceSPKPriv, bobIKCurvePub)
        val dh3 = scalarmult(aliceSPKPriv, bobSPKPub)
        val dh4 = scalarmult(aliceOPKPriv, bobSPKPub)

        // Конкатенируем и хешируем через BLAKE2b (crypto_generichash)
        val combined = dh1 + dh2 + dh3 + dh4
        return genericHash(combined, 32)
    }

    private fun scalarmult(priv: ByteArray, pub: ByteArray): ByteArray {
        val out = ByteArray(32)
        check(sodium.cryptoScalarMult(out, priv, pub)) { "cryptoScalarMult failed" }
        return out
    }

    private fun genericHash(input: ByteArray, outLen: Int): ByteArray {
        val out = ByteArray(outLen)
        check(sodium.cryptoGenericHash(out, outLen, input, input.size.toLong(), null, 0)) {
            "cryptoGenericHash failed"
        }
        return out
    }

    private fun ed25519PkToCurve25519(edPk: ByteArray): ByteArray {
        val out = ByteArray(32)
        check(sodium.convertPublicKeyEd25519ToCurve25519(out, edPk)) {
            "ed25519PkToCurve25519 failed"
        }
        return out
    }

    private fun ed25519SkToCurve25519(edSk: ByteArray): ByteArray {
        val out = ByteArray(32)
        check(sodium.convertSecretKeyEd25519ToCurve25519(out, edSk)) {
            "ed25519SkToCurve25519 failed"
        }
        return out
    }
}
