package main

import (
	"os"
	"strconv"

	"gopkg.in/yaml.v3"
)

// Config — все параметры запуска сервера.
// Значения загружаются из config.yaml (если файл существует),
// затем env-переменные переопределяют каждое поле.
type Config struct {
	Port              string `yaml:"port"`
	DBPath            string `yaml:"db_path"`
	MediaDir          string `yaml:"media_dir"`
	JWTSecret         string `yaml:"jwt_secret"`
	TLSCert           string `yaml:"tls_cert"`
	TLSKey            string `yaml:"tls_key"`
	AllowedOrigin     string `yaml:"allowed_origin"`
	BehindProxy       bool   `yaml:"behind_proxy"`
	STUNUrl           string `yaml:"stun_url"`
	TURNUrl           string `yaml:"turn_url"`
	TURNSecret        string `yaml:"turn_secret"`
	TURNCredTTL       int64  `yaml:"turn_credential_ttl"`
	VAPIDPrivate      string `yaml:"vapid_private_key"`
	VAPIDPublic       string `yaml:"vapid_public_key"`
	ServerName        string `yaml:"server_name"`
	ServerDescription string `yaml:"server_description"`
	RegistrationMode  string `yaml:"registration_mode"`
	AdminUsername     string `yaml:"admin_username"`
	AdminPassword     string `yaml:"admin_password"`
	// Native push notifications
	FCMLegacyKey  string `yaml:"fcm_legacy_key"`  // Firebase Server Key
	APNsKeyPath   string `yaml:"apns_key_path"`   // путь к .p8 файлу
	APNsKeyID     string `yaml:"apns_key_id"`
	APNsTeamID    string `yaml:"apns_team_id"`
	APNsBundleID  string `yaml:"apns_bundle_id"`
	APNsSandbox   bool   `yaml:"apns_sandbox"`
}

// defaults — базовые значения, применяемые до yaml и env.
func defaults() Config {
	return Config{
		Port:             "8080",
		DBPath:           "./messenger.db",
		MediaDir:         "./media",
		STUNUrl:          "stun:stun.l.google.com:19302",
		TURNCredTTL:      86400,
		ServerName:       "Messenger",
		RegistrationMode: "open",
	}
}

// loadConfig читает config.yaml (необязательный), затем применяет env-переменные.
// Порядок приоритета: env > config.yaml > defaults.
func loadConfig(path string) (Config, error) {
	cfg := defaults()

	// Читаем файл конфигурации (не обязателен)
	if data, err := os.ReadFile(path); err == nil {
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			return cfg, err
		}
	}

	// Env-переменные переопределяют yaml
	if v := os.Getenv("PORT"); v != "" {
		cfg.Port = v
	}
	if v := os.Getenv("DB_PATH"); v != "" {
		cfg.DBPath = v
	}
	if v := os.Getenv("MEDIA_DIR"); v != "" {
		cfg.MediaDir = v
	}
	if v := os.Getenv("JWT_SECRET"); v != "" {
		cfg.JWTSecret = v
	}
	if v := os.Getenv("TLS_CERT"); v != "" {
		cfg.TLSCert = v
	}
	if v := os.Getenv("TLS_KEY"); v != "" {
		cfg.TLSKey = v
	}
	if v := os.Getenv("ALLOWED_ORIGIN"); v != "" {
		cfg.AllowedOrigin = v
	}
	if v := os.Getenv("BEHIND_PROXY"); v != "" {
		cfg.BehindProxy = v == "true"
	}
	if v := os.Getenv("STUN_URL"); v != "" {
		cfg.STUNUrl = v
	}
	if v := os.Getenv("TURN_URL"); v != "" {
		cfg.TURNUrl = v
	}
	if v := os.Getenv("TURN_SECRET"); v != "" {
		cfg.TURNSecret = v
	}
	if v := os.Getenv("TURN_CREDENTIAL_TTL"); v != "" {
		if ttl, err := strconv.ParseInt(v, 10, 64); err == nil {
			cfg.TURNCredTTL = ttl
		}
	}
	if v := os.Getenv("VAPID_PRIVATE_KEY"); v != "" {
		cfg.VAPIDPrivate = v
	}
	if v := os.Getenv("VAPID_PUBLIC_KEY"); v != "" {
		cfg.VAPIDPublic = v
	}
	if v := os.Getenv("SERVER_NAME"); v != "" {
		cfg.ServerName = v
	}
	if v := os.Getenv("SERVER_DESCRIPTION"); v != "" {
		cfg.ServerDescription = v
	}
	if v := os.Getenv("REGISTRATION_MODE"); v != "" {
		cfg.RegistrationMode = v
	}
	if v := os.Getenv("ADMIN_USERNAME"); v != "" {
		cfg.AdminUsername = v
	}
	if v := os.Getenv("ADMIN_PASSWORD"); v != "" {
		cfg.AdminPassword = v
	}
	if v := os.Getenv("FCM_LEGACY_KEY"); v != "" {
		cfg.FCMLegacyKey = v
	}
	if v := os.Getenv("APNS_KEY_PATH"); v != "" {
		cfg.APNsKeyPath = v
	}
	if v := os.Getenv("APNS_KEY_ID"); v != "" {
		cfg.APNsKeyID = v
	}
	if v := os.Getenv("APNS_TEAM_ID"); v != "" {
		cfg.APNsTeamID = v
	}
	if v := os.Getenv("APNS_BUNDLE_ID"); v != "" {
		cfg.APNsBundleID = v
	}
	if v := os.Getenv("APNS_SANDBOX"); v != "" {
		cfg.APNsSandbox = v == "true"
	}

	return cfg, nil
}
