package crypto

import com.goterl.lazysodium.LazySodiumJava

/**
 * X3DH (Extended Triple Diffie-Hellman) — установка сессии для Signal Protocol.
 * Реализует роль инициатора (Alice).
 * Совместим с TypeScript-реализацией на libsodium-wrappers (web client).
 *
 * Стандартный Signal X3DH порядок DH:
 *   dh1 = Alice_IK_curve × Bob_SPK
 *   dh2 = Alice_EK × Bob_IK_curve
 *   dh3 = Alice_EK × Bob_SPK
 *   dh4 = Alice_EK × Bob_OPK (если OPK присутствует)
 */
class X3DH(private val sodium: LazySodiumJava) {

    /**
     * Вычисляет shared secret по стандартной схеме X3DH (Signal Protocol, Alice-initiator).
     *
     * @param aliceIKPrivEd  64-байтовый ed25519 секретный ключ Alice (identity key)
     * @param aliceEKPriv    32-байтовый curve25519 приватный ключ Alice (ephemeral key)
     * @param bobIKPubEd     32-байтовый ed25519 публичный ключ Bob (identity key)
     * @param bobSPKPub      32-байтовый curve25519 публичный ключ Bob (signed pre-key)
     * @param bobOPKPub      32-байтовый curve25519 публичный ключ Bob (one-time pre-key, опционально)
     * @return 32-байтовый shared secret
     */
    fun computeSharedSecret(
        aliceIKPrivEd: ByteArray,
        aliceEKPriv: ByteArray,
        bobIKPubEd: ByteArray,
        bobSPKPub: ByteArray,
        bobOPKPub: ByteArray? = null,
    ): ByteArray {
        // Конвертируем ed25519 ключи в curve25519
        val aliceIKCurvePriv = ed25519SkToCurve25519(aliceIKPrivEd)
        val bobIKCurvePub = ed25519PkToCurve25519(bobIKPubEd)

        // dh1 = Alice_IK_curve × Bob_SPK
        val dh1 = scalarmult(aliceIKCurvePriv, bobSPKPub)
        // dh2 = Alice_EK × Bob_IK_curve
        val dh2 = scalarmult(aliceEKPriv, bobIKCurvePub)
        // dh3 = Alice_EK × Bob_SPK
        val dh3 = scalarmult(aliceEKPriv, bobSPKPub)

        // Конкатенируем и хешируем через BLAKE2b (crypto_generichash)
        val combined = if (bobOPKPub != null) {
            // dh4 = Alice_EK × Bob_OPK
            val dh4 = scalarmult(aliceEKPriv, bobOPKPub)
            dh1 + dh2 + dh3 + dh4
        } else {
            dh1 + dh2 + dh3
        }

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
