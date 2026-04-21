package media

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

const maxUploadSize = 10 << 20 // 10 МБ

// Все загружаемые файлы — E2E-зашифрованный бинарный контент.
// Реальный MIME-тип хранится только в зашифрованном payload на клиенте.
const uploadContentType = "application/octet-stream"

type Handler struct {
	MediaDir       string
	DB             *sql.DB
	MaxUploadBytes int64
}

// POST /api/media/upload — загрузка файла (требует JWT, возвращает mediaId).
// Принимает form-field "file" и опциональный "chat_id".
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	uploaderID := auth.UserIDFromCtx(r)
	if uploaderID == "" {
		httpErr(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	maxSize := h.MaxUploadBytes
	if maxSize <= 0 {
		maxSize = 100 << 20
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSize+1024)
	if err := r.ParseMultipartForm(maxSize); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"error":    "file_too_large",
			"maxBytes": maxSize,
		})
		return
	}

	chatID := r.FormValue("chat_id")
	clientMsgID := r.FormValue("msg_id")

	if chatID != "" {
		member, err := db.IsConversationMember(h.DB, chatID, uploaderID)
		if err != nil || !member {
			httpErr(w, "forbidden", http.StatusForbidden)
			return
		}
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		httpErr(w, "file field required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Сохраняем файл на диск под UUID-именем (.bin — содержимое всегда зашифровано)
	diskName := uuid.New().String() + ".bin"
	if err := os.MkdirAll(h.MediaDir, 0700); err != nil {
		httpErr(w, "server error", http.StatusInternalServerError)
		return
	}
	dst, err := os.Create(filepath.Join(h.MediaDir, diskName))
	if err != nil {
		httpErr(w, "server error", http.StatusInternalServerError)
		return
	}
	defer dst.Close()

	size, err := io.Copy(dst, file)
	if err != nil {
		httpErr(w, "server error", http.StatusInternalServerError)
		return
	}

	quota, qErr := db.GetUserQuota(h.DB, uploaderID)
	if qErr == nil && quota.QuotaBytes > 0 && quota.UsedBytes+size > quota.QuotaBytes {
		os.Remove(filepath.Join(h.MediaDir, diskName))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"error":      "quota_exceeded",
			"quotaBytes": quota.QuotaBytes,
			"usedBytes":  quota.UsedBytes,
		})
		return
	}

	// Определяем content_type: клиент может передать audio/* для голосовых заметок
	contentType := uploadContentType
	if ct := r.FormValue("content_type"); strings.HasPrefix(ct, "audio/") {
		contentType = ct
	}

	// Создаём запись в media_objects
	mediaID := uuid.New().String()
	obj := db.MediaObject{
		ID:             mediaID,
		UploaderID:     uploaderID,
		ConversationID: chatID,
		ClientMsgID:    clientMsgID,
		Filename:       diskName,
		OriginalName:   header.Filename,
		ContentType:    contentType,
		Size:           size,
		CreatedAt:      time.Now().UnixMilli(),
	}
	if err := db.InsertMediaObject(h.DB, obj); err != nil {
		os.Remove(filepath.Join(h.MediaDir, diskName)) //nolint:errcheck
		httpErr(w, "server error", http.StatusInternalServerError)
		return
	}

	db.AddUsedBytes(h.DB, uploaderID, size) //nolint:errcheck

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{ //nolint:errcheck
		"mediaId":      mediaID,
		"originalName": header.Filename,
		"contentType":  contentType,
	})
}

// GET /api/media/{id} — выдача медиафайла по mediaId (требует JWT).
// Доступ: загрузчик ИЛИ участник чата, к которому привязан файл.
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	if userID == "" {
		httpErr(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	mediaID := chi.URLParam(r, "id")
	if mediaID == "" {
		http.NotFound(w, r)
		return
	}

	obj, err := db.GetMediaObject(h.DB, mediaID)
	if err != nil || obj == nil {
		http.NotFound(w, r)
		return
	}

	// Проверка доступа
	if obj.UploaderID != userID {
		if obj.ConversationID == "" {
			httpErr(w, "forbidden", http.StatusForbidden)
			return
		}
		member, err := db.IsConversationMember(h.DB, obj.ConversationID, userID)
		if err != nil || !member {
			httpErr(w, "forbidden", http.StatusForbidden)
			return
		}
	}

	path := filepath.Join(h.MediaDir, filepath.Clean(obj.Filename))
	// Защита от path traversal
	if !strings.HasPrefix(path, filepath.Clean(h.MediaDir)+string(os.PathSeparator)) {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", obj.ContentType)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Disposition", "inline; filename=\""+escapeFilename(obj.OriginalName)+"\"")
	http.ServeFile(w, r, path)
}

// GET /api/chats/{chatId}/media?page=1&limit=20 — список медиафайлов чата с пагинацией.
// Доступ: только участник чата.
func (h *Handler) ListChatMedia(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	if userID == "" {
		httpErr(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	chatID := chi.URLParam(r, "chatId")
	if chatID == "" {
		http.NotFound(w, r)
		return
	}

	member, err := db.IsConversationMember(h.DB, chatID, userID)
	if err != nil || !member {
		httpErr(w, "forbidden", http.StatusForbidden)
		return
	}

	page := 1
	limit := 20
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 {
			page = n
		}
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 {
			if n > 100 {
				n = 100
			}
			limit = n
		}
	}

	items, hasMore, err := db.ListChatMedia(h.DB, chatID, page, limit)
	if err != nil {
		httpErr(w, "server error", http.StatusInternalServerError)
		return
	}

	type responseItem struct {
		ID           string `json:"id"`
		OriginalName string `json:"originalName"`
		Size         int64  `json:"size"`
		CreatedAt    int64  `json:"createdAt"`
	}
	resp := struct {
		Items   []responseItem `json:"items"`
		HasMore bool           `json:"hasMore"`
	}{
		HasMore: hasMore,
	}
	for _, item := range items {
		resp.Items = append(resp.Items, responseItem{
			ID:           item.ID,
			OriginalName: item.OriginalName,
			Size:         item.Size,
			CreatedAt:    item.CreatedAt,
		})
	}
	if resp.Items == nil {
		resp.Items = []responseItem{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

// StartOrphanCleaner запускает фоновую горутину, которая раз в час удаляет
// медиафайлы без привязки к чату (conversation_id = ''), загруженные более 24 часов назад.
func StartOrphanCleaner(database *sql.DB, mediaDir string) {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			cleanOrphans(database, mediaDir)
		}
	}()
}

func cleanOrphans(database *sql.DB, mediaDir string) {
	cutoff := time.Now().Add(-24*time.Hour).UnixMilli()
	filenames, err := db.DeleteOrphanedMedia(database, cutoff)
	if err != nil {
		// Не фатально — попробуем в следующий раз
		return
	}
	for _, name := range filenames {
		path := filepath.Join(mediaDir, filepath.Clean(name))
		os.Remove(path) //nolint:errcheck
	}
}

// escapeFilename убирает кавычки из имени файла для Content-Disposition.
func escapeFilename(name string) string {
	return strings.ReplaceAll(name, `"`, `'`)
}

func httpErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg}) //nolint:errcheck
}
