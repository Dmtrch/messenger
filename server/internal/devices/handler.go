package devices

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/ws"
)

type Handler struct {
	DB  *sql.DB
	Hub *ws.Hub
}

func (h *Handler) GetDevices(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	devices, err := db.GetDevicesByUserID(h.DB, userID)
	if err != nil {
		jsonErr(w, "server error", 500)
		return
	}
	if devices == nil {
		devices = []db.Device{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(devices)
}

func (h *Handler) DeleteDevice(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	deviceID := chi.URLParam(r, "deviceId")

	dev, err := db.GetDeviceByID(h.DB, deviceID)
	if err != nil || dev == nil {
		jsonErr(w, "not found", 404)
		return
	}
	if dev.UserID != userID {
		jsonErr(w, "forbidden", 403)
		return
	}

	if err := db.DeleteDevice(h.DB, deviceID, userID); err != nil {
		jsonErr(w, "server error", 500)
		return
	}

	h.Hub.DisconnectDeviceOnly(userID, deviceID)
	payload, _ := json.Marshal(map[string]any{"type": "device_removed", "deviceId": deviceID})
	h.Hub.Deliver(userID, payload)

	w.WriteHeader(204)
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
