// Package password инкапсулирует хеширование паролей (Argon2id)
// и lazy-миграцию с устаревшего bcrypt.
//
// Формат PHC-string:
//   $argon2id$v=19$m=65536,t=3,p=4$<base64-salt>$<base64-hash>
//
// Параметры (shared/test-vectors/argon2id.json):
//   memory=64 MiB, iterations=3, parallelism=4, salt=16B, hash=32B.
//
// Перед хешированием пароль нормализуется до формы NFC, чтобы Unicode-пароли
// из разных клиентов (где composing/decomposing может различаться) давали
// один и тот же хеш.
package password

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/text/unicode/norm"
)

// Параметры Argon2id (OWASP-рекомендация + фиксированные в test-vectors).
const (
	Algo        = "argon2id"
	Memory      = 64 * 1024 // 65536 KiB
	Iterations  = 3
	Parallelism = 4
	SaltLen     = 16
	KeyLen      = 32
	Version     = argon2.Version // 19
)

// Argon2idPrefix — стабильный префикс PHC-string для быстрого
// отличия Argon2id-хеша от bcrypt-хеша.
const Argon2idPrefix = "$argon2id$"

// Ошибки верификации.
var (
	ErrMismatch      = errors.New("password mismatch")
	ErrUnknownFormat = errors.New("unknown password hash format")
)

// Algorithm возвращает имя алгоритма, по которому был посчитан данный хеш.
// Используется lazy-миграцией для обновления чужих (bcrypt) хешей.
func Algorithm(stored string) string {
	switch {
	case strings.HasPrefix(stored, Argon2idPrefix):
		return "argon2id"
	case strings.HasPrefix(stored, "$2a$"),
		strings.HasPrefix(stored, "$2b$"),
		strings.HasPrefix(stored, "$2y$"):
		return "bcrypt"
	default:
		return ""
	}
}

// Hash вычисляет Argon2id-хеш и возвращает PHC-string.
func Hash(plain string) (string, error) {
	plainNFC := norm.NFC.String(plain)
	salt := make([]byte, SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("argon2id: salt: %w", err)
	}
	return hashWithSalt(plainNFC, salt), nil
}

// hashWithSalt внутренний хелпер для детерминированных тестов.
func hashWithSalt(plainNFC string, salt []byte) string {
	hash := argon2.IDKey([]byte(plainNFC), salt, Iterations, Memory, Parallelism, KeyLen)
	return encode(salt, hash)
}

// Verify проверяет пароль против сохранённого хеша (Argon2id или bcrypt).
// Для Argon2id используется постоянно-временное сравнение.
func Verify(stored, plain string) error {
	plainNFC := norm.NFC.String(plain)
	switch Algorithm(stored) {
	case "argon2id":
		salt, want, params, err := decode(stored)
		if err != nil {
			return err
		}
		got := argon2.IDKey([]byte(plainNFC), salt,
			params.iterations, params.memory, params.parallelism, uint32(len(want)))
		if subtle.ConstantTimeCompare(got, want) != 1 {
			return ErrMismatch
		}
		return nil
	case "bcrypt":
		if err := bcrypt.CompareHashAndPassword([]byte(stored), []byte(plainNFC)); err != nil {
			if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
				return ErrMismatch
			}
			return err
		}
		return nil
	default:
		return ErrUnknownFormat
	}
}

// NeedsRehash возвращает true, если хеш нужно пересчитать Argon2id
// (все не-argon2id хеши считаются устаревшими и подлежат lazy-миграции).
func NeedsRehash(stored string) bool {
	return Algorithm(stored) != "argon2id"
}

// ── PHC encode/decode ───────────────────────────────────────────────────────

type argon2Params struct {
	memory      uint32
	iterations  uint32
	parallelism uint8
}

func encode(salt, hash []byte) string {
	b64 := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		Version, Memory, Iterations, Parallelism, b64(salt), b64(hash))
}

// decode разбирает PHC-string формата Argon2id.
func decode(stored string) ([]byte, []byte, argon2Params, error) {
	parts := strings.Split(stored, "$")
	// ["", "argon2id", "v=19", "m=...,t=...,p=...", "<salt>", "<hash>"]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return nil, nil, argon2Params{}, ErrUnknownFormat
	}
	var ver int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &ver); err != nil || ver != Version {
		return nil, nil, argon2Params{}, ErrUnknownFormat
	}
	var p argon2Params
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.iterations, &p.parallelism); err != nil {
		return nil, nil, argon2Params{}, ErrUnknownFormat
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return nil, nil, argon2Params{}, ErrUnknownFormat
	}
	hash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return nil, nil, argon2Params{}, ErrUnknownFormat
	}
	return salt, hash, p, nil
}
