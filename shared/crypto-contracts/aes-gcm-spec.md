# AES-GCM Media Encryption Spec

## Назначение

Шифрование медиафайлов (изображений, файлов, голосовых заметок) перед загрузкой на сервер. Сервер хранит только ciphertext и не может расшифровать содержимое без ключа.

## Параметры алгоритма

| Параметр | Значение |
|----------|---------|
| Алгоритм | AES-256-GCM |
| Длина ключа | 256 бит (32 байта) |
| Длина nonce (IV) | 96 бит (12 байт) |
| Тег аутентификации | 128 бит (16 байт) |
| Формат wire | `nonce (12 байт) \|\| ciphertext \|\| auth_tag` |

## Управление ключами

- Ключ генерируется случайно для каждого файла через `crypto.getRandomValues`.
- Ключ передаётся получателям в зашифрованном E2E payload сообщения (base64).
- Сервер хранит только ciphertext; plaintext ключ ему недоступен.
- Один файл — один ключ. Повторное использование ключей не допускается.

## Реализация

Portable обёртка: `shared/native-core/crypto/aesGcm.ts`

```typescript
encryptAesGcm(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>
decryptAesGcm(key: Uint8Array, combined: Uint8Array): Promise<Uint8Array>
```

`encryptAesGcm` возвращает `nonce || ciphertext || auth_tag` как единый `Uint8Array`.
`decryptAesGcm` принимает тот же формат и возвращает plaintext.

## Zeroing out

После использования ключевой материал и ciphertext буферы должны быть обнулены:

- `combined.fill(0)` — очистка буфера ciphertext после расшифровки
- `key.fill(0)` — очистка ключевого материала после операции
- Blob URL должен быть отозван (`URL.revokeObjectURL`) не позднее чем через 60 секунд после создания

## Связанные документы

- [../../docs/crypto-rationale.md](../../docs/crypto-rationale.md) — раздел "Шифрование медиа"
- [interfaces.md](interfaces.md) — CryptoEngine contract
