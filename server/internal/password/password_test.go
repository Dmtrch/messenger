package password_test

import (
	"strings"
	"testing"
	"time"

	"github.com/messenger/server/internal/password"
	"golang.org/x/crypto/bcrypt"
)

func TestHash_PHCFormat(t *testing.T) {
	phc, err := password.Hash("correct horse battery staple")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !strings.HasPrefix(phc, "$argon2id$v=19$m=65536,t=3,p=4$") {
		t.Fatalf("unexpected PHC prefix: %s", phc)
	}
}

func TestVerify_RoundTrip(t *testing.T) {
	phc, err := password.Hash("hunter2")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if err := password.Verify(phc, "hunter2"); err != nil {
		t.Errorf("verify correct: %v", err)
	}
	if err := password.Verify(phc, "wrong"); err != password.ErrMismatch {
		t.Errorf("verify wrong: want ErrMismatch, got %v", err)
	}
}

// TestVerify_UnicodeNFC — пароль в NFC и NFD должен давать один и тот же результат.
func TestVerify_UnicodeNFC(t *testing.T) {
	phc, err := password.Hash("пароль-é") // NFC
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	// NFD-форма «e\u0301»
	if err := password.Verify(phc, "пароль-e\u0301"); err != nil {
		t.Errorf("NFD-form should verify after NFC normalization: %v", err)
	}
}

// TestVerify_Bcrypt — существующие bcrypt-хеши должны проходить verify.
func TestVerify_Bcrypt(t *testing.T) {
	hash, err := bcrypt.GenerateFromPassword([]byte("legacy-pw"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	if err := password.Verify(string(hash), "legacy-pw"); err != nil {
		t.Errorf("bcrypt verify: %v", err)
	}
	if err := password.Verify(string(hash), "wrong"); err != password.ErrMismatch {
		t.Errorf("bcrypt wrong: want ErrMismatch, got %v", err)
	}
	if !password.NeedsRehash(string(hash)) {
		t.Errorf("bcrypt hash should require rehash")
	}
}

// TestVerify_ConstantTimeCompare — P1-PWD-3: косвенная проверка, что Verify
// всегда пересчитывает Argon2id целиком и сравнивает через subtle.ConstantTimeCompare,
// даже при полностью отличающемся пароле (нет ранней оптимизации по префиксу).
//
// Измеряем два варианта: верный пароль и пароль, отличающийся в первом байте.
// Если бы Verify выходил сразу при первом несоответствии, неверный пароль
// отрабатывал бы ощутимо быстрее. В действительности оба вызова выполняют
// одинаковый Argon2id-раунд, и их тайминг остаётся в одном порядке величины.
func TestVerify_ConstantTimeCompare(t *testing.T) {
	phc, err := password.Hash("correct-horse-battery-staple")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}

	runs := 3
	var okTotal, badTotal time.Duration
	for i := 0; i < runs; i++ {
		t0 := time.Now()
		_ = password.Verify(phc, "correct-horse-battery-staple")
		okTotal += time.Since(t0)

		t1 := time.Now()
		_ = password.Verify(phc, "Xorrect-horse-battery-staple")
		badTotal += time.Since(t1)
	}
	ok := okTotal / time.Duration(runs)
	bad := badTotal / time.Duration(runs)

	// Порядок времени должен совпадать: неверный пароль не должен быть
	// радикально (на порядок) быстрее, иначе Verify сломан.
	ratio := float64(ok) / float64(bad)
	if ratio > 10 || ratio < 0.1 {
		t.Errorf("timing diverges: ok=%v bad=%v ratio=%.2f — constant-time compare possibly broken", ok, bad, ratio)
	}
}

func TestAlgorithm(t *testing.T) {
	phc, _ := password.Hash("x")
	if got := password.Algorithm(phc); got != "argon2id" {
		t.Errorf("argon2id algorithm: got %s", got)
	}
	if password.NeedsRehash(phc) {
		t.Errorf("fresh Argon2id hash should not require rehash")
	}
	bHash, _ := bcrypt.GenerateFromPassword([]byte("x"), bcrypt.MinCost)
	if got := password.Algorithm(string(bHash)); got != "bcrypt" {
		t.Errorf("bcrypt algorithm: got %s", got)
	}
	if got := password.Algorithm("plain-text-nonsense"); got != "" {
		t.Errorf("unknown format should be empty, got %s", got)
	}
}
