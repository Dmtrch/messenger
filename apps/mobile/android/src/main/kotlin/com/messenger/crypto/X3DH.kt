// apps/mobile/android/src/main/kotlin/com/messenger/crypto/X3DH.kt
package com.messenger.crypto

import com.goterl.lazysodium.LazySodium

class X3DH(private val sodium: LazySodium) {

    fun computeSharedSecret(
        aliceIKPrivEd: ByteArray,
        aliceEKPriv: ByteArray,
        bobIKPubEd: ByteArray,
        bobSPKPub: ByteArray,
        bobOPKPub: ByteArray? = null,
    ): ByteArray {
        val aliceIKCurvePriv = ed25519SkToCurve25519(aliceIKPrivEd)
        val bobIKCurvePub = ed25519PkToCurve25519(bobIKPubEd)
        val dh1 = scalarmult(aliceIKCurvePriv, bobSPKPub)
        val dh2 = scalarmult(aliceEKPriv, bobIKCurvePub)
        val dh3 = scalarmult(aliceEKPriv, bobSPKPub)
        val combined = if (bobOPKPub != null) {
            val dh4 = scalarmult(aliceEKPriv, bobOPKPub)
            dh1 + dh2 + dh3 + dh4
        } else {
            dh1 + dh2 + dh3
        }
        return genericHash(combined, 32)
    }

    private fun scalarmult(priv: ByteArray, pub: ByteArray): ByteArray {
        require(priv.size == 32) { "curve25519 private key must be 32 bytes, got ${priv.size}" }
        require(pub.size == 32) { "curve25519 public key must be 32 bytes, got ${pub.size}" }
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
        require(edPk.size == 32) { "ed25519 public key must be 32 bytes, got ${edPk.size}" }
        val out = ByteArray(32)
        check(sodium.convertPublicKeyEd25519ToCurve25519(out, edPk)) {
            "ed25519PkToCurve25519 failed"
        }
        return out
    }

    private fun ed25519SkToCurve25519(edSk: ByteArray): ByteArray {
        require(edSk.size == 64) { "ed25519 secret key must be 64 bytes, got ${edSk.size}" }
        val out = ByteArray(32)
        check(sodium.convertSecretKeyEd25519ToCurve25519(out, edSk)) {
            "ed25519SkToCurve25519 failed"
        }
        return out
    }
}
