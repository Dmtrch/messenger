/**
 * Тесты Double Ratchet: encrypt/decrypt round-trip, out-of-order, TTL skipped keys, MAX_SKIP.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import _sodium from 'libsodium-wrappers'
import {
  initRatchet,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeRatchetState,
  deserializeRatchetState,
  type RatchetState,
} from './ratchet'

// ── Хелперы ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await _sodium.ready
})

type Sodium = typeof _sodium

/**
 * Создаёт пару инициализированных рэтчет-состояний (Alice ↔ Bob).
 * Alice — инициатор, Bob — ответчик.
 */
async function makeSession(s: Sodium): Promise<{ alice: RatchetState; bob: RatchetState }> {
  const sharedSecret = s.randombytes_buf(32)

  // Alice генерирует свой начальный DH ключ (аналог эфемерного ключа из X3DH).
  // Bob знает его заранее (он передаётся в prekey-сообщении X3DH).
  const aliceDHKeyPair = s.crypto_kx_keypair()
  const bobDHKeyPair = s.crypto_kx_keypair()

  // Alice: инициатор — выполняет DH(alice, bob) для получения первого send chain key
  const alice = await initRatchet(sharedSecret, aliceDHKeyPair, bobDHKeyPair.publicKey, true)
  // Bob: ответчик — dhRemotePublic=null, первое сообщение Alice триггернёт DH ratchet
  const bob = await initRatchet(sharedSecret, bobDHKeyPair, null, false)

  return { alice, bob }
}

// ── Round-trip ────────────────────────────────────────────────────────────────

describe('ratchet encrypt/decrypt round-trip', () => {
  it('Alice → Bob: одно сообщение', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    const { message, nextState: aliceNext } = await ratchetEncrypt(alice, 'hello world')
    const { plaintext, nextState: bobNext } = await ratchetDecrypt(bob, message)

    expect(plaintext).toBe('hello world')
    expect(aliceNext.sendCount).toBe(1)
    expect(bobNext.recvCount).toBe(1)
  })

  it('Alice → Bob: несколько сообщений подряд', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    const texts = ['first', 'second', 'third']
    let aliceState = alice
    let bobState = bob

    for (const text of texts) {
      const { message, nextState } = await ratchetEncrypt(aliceState, text)
      aliceState = nextState
      const { plaintext, nextState: bobNext } = await ratchetDecrypt(bobState, message)
      bobState = bobNext
      expect(plaintext).toBe(text)
    }
  })

  it('Bob → Alice: ответное сообщение после DH ratchet', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    // Alice → Bob (инициирует DH ratchet на стороне Bob)
    const { message: msg1, nextState: alice1 } = await ratchetEncrypt(alice, 'ping')
    const { nextState: bob1 } = await ratchetDecrypt(bob, msg1)

    // Bob → Alice (ответ)
    const { message: msg2, nextState: _bob2 } = await ratchetEncrypt(bob1, 'pong')
    const { plaintext, nextState: _alice2 } = await ratchetDecrypt(alice1, msg2)

    expect(plaintext).toBe('pong')
  })

  it('Bidirectional: чередование сообщений', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    let a = alice, b = bob

    const pairs = [
      ['Alice', 'msg from alice'],
      ['Bob', 'msg from bob'],
      ['Alice', 'another from alice'],
    ]

    for (const [sender, text] of pairs) {
      if (sender === 'Alice') {
        const { message, nextState } = await ratchetEncrypt(a, text)
        a = nextState
        const { plaintext, nextState: bNext } = await ratchetDecrypt(b, message)
        b = bNext
        expect(plaintext).toBe(text)
      } else {
        const { message, nextState } = await ratchetEncrypt(b, text)
        b = nextState
        const { plaintext, nextState: aNext } = await ratchetDecrypt(a, message)
        a = aNext
        expect(plaintext).toBe(text)
      }
    }
  })
})

// ── Out-of-order ──────────────────────────────────────────────────────────────

describe('out-of-order delivery', () => {
  it('Сообщение 2 приходит раньше 1 — расшифровывается из кэша', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    const { message: msg0, nextState: alice1 } = await ratchetEncrypt(alice, 'first')
    const { message: msg1, nextState: _alice2 } = await ratchetEncrypt(alice1, 'second')

    // Bob получает msg1 (second) первым
    const { plaintext: p1, nextState: bob1 } = await ratchetDecrypt(bob, msg1)
    expect(p1).toBe('second')

    // Bob получает msg0 (first) из кэша пропущенных ключей
    const { plaintext: p0 } = await ratchetDecrypt(bob1, msg0)
    expect(p0).toBe('first')
  })

  it('Три сообщения в обратном порядке', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    let aliceState = alice
    const messages = []
    for (const text of ['a', 'b', 'c']) {
      const { message, nextState } = await ratchetEncrypt(aliceState, text)
      aliceState = nextState
      messages.push({ message, text })
    }

    // Получаем в порядке c, b, a
    let bobState = bob
    for (const { message, text } of messages.reverse()) {
      const { plaintext, nextState } = await ratchetDecrypt(bobState, message)
      bobState = nextState
      expect(plaintext).toBe(text)
    }
  })
})

// ── MAX_SKIP ──────────────────────────────────────────────────────────────────

describe('MAX_SKIP', () => {
  it('Превышение MAX_SKIP (100) бросает ошибку', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    // Alice отправляет 101 сообщение, Bob получает только 101-е — должно упасть
    let aliceState = alice
    let lastMsg = null
    for (let i = 0; i <= 101; i++) {
      const { message, nextState } = await ratchetEncrypt(aliceState, `msg${i}`)
      aliceState = nextState
      lastMsg = message
    }

    // Bob пытается принять 102-е сообщение (skip = 102 > MAX_SKIP=100)
    await expect(ratchetDecrypt(bob, lastMsg!)).rejects.toThrow('Too many skipped')
  })
})

// ── Skipped Keys TTL ──────────────────────────────────────────────────────────

describe('skipped keys TTL', () => {
  it('Просроченные ключи (> 7 дней) удаляются при расшифровке', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    // Alice отправляет два сообщения
    const { message: msg0, nextState: alice1 } = await ratchetEncrypt(alice, 'fresh')
    const { message: msg1, nextState: _alice2 } = await ratchetEncrypt(alice1, 'delayed')

    // Bob получает msg1 первым — msg0 попадёт в кэш skippedKeys
    const { nextState: bob1 } = await ratchetDecrypt(bob, msg1)

    // Симулируем устаревание: все ключи в skippedKeys помечаем как старые
    const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000 // 8 дней назад
    const staleState: RatchetState = {
      ...bob1,
      skippedKeys: Object.fromEntries(
        Object.entries(bob1.skippedKeys).map(([k, v]) => [k, { ...v, storedAt: oldTimestamp }])
      ),
    }

    // Попытка расшифровать msg0 должна провалиться — ключ удалён как просроченный
    await expect(ratchetDecrypt(staleState, msg0)).rejects.toThrow()
  })

  it('Свежие ключи (< 7 дней) не удаляются', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    const { message: msg0, nextState: alice1 } = await ratchetEncrypt(alice, 'will survive')
    const { message: msg1, nextState: _alice2 } = await ratchetEncrypt(alice1, 'received first')

    // Bob получает msg1 первым
    const { nextState: bob1 } = await ratchetDecrypt(bob, msg1)

    // Ключи свежие — msg0 должен расшифроваться
    const { plaintext } = await ratchetDecrypt(bob1, msg0)
    expect(plaintext).toBe('will survive')
  })
})

// ── Serialize / Deserialize ───────────────────────────────────────────────────

describe('serialization', () => {
  it('Сериализация и десериализация сохраняют состояние', async () => {
    const s = _sodium
    const { alice, bob } = await makeSession(s)

    const { message, nextState: alice1 } = await ratchetEncrypt(alice, 'persist this')

    // Сериализуем bob, десериализуем, расшифровываем
    const bytes = serializeRatchetState(bob)
    const bobRestored = deserializeRatchetState(bytes)

    const { plaintext } = await ratchetDecrypt(bobRestored, message)
    expect(plaintext).toBe('persist this')
    expect(alice1.sendCount).toBe(1)
  })

  it('Backward compat: старый формат skippedKeys (строка) десериализуется', () => {
    const legacyJson = JSON.stringify({
      dhSendKeyPair: { publicKey: Array(32).fill(1), privateKey: Array(32).fill(2) },
      dhRemotePublic: null,
      rootKey: Array(32).fill(3),
      sendChainKey: Array(32).fill(4),
      recvChainKey: null,
      sendCount: 0,
      recvCount: 0,
      prevSendCount: 0,
      skippedKeys: { 'someKey:0': 'base64encodedkey==' }, // старый string формат
    })
    const bytes = new TextEncoder().encode(legacyJson)
    const state = deserializeRatchetState(bytes)

    // Должен конвертировать строку в { key, storedAt }
    const entry = state.skippedKeys['someKey:0']
    expect(typeof entry).toBe('object')
    expect(entry.key).toBe('base64encodedkey==')
    expect(typeof entry.storedAt).toBe('number')
  })
})
