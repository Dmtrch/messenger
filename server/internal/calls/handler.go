package calls

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/sfu"
)

// Broadcaster — минимальный интерфейс для WS-broadcast.
// Реализуется *ws.Hub, но импортировать ws напрямую нельзя (цикл).
type Broadcaster interface {
	BroadcastRoomCreated(chatID, roomID, creatorID string)
	BroadcastParticipantJoined(chatID, roomID, userID, deviceID string)
	BroadcastParticipantLeft(chatID, roomID, userID string)
	BroadcastTrackAdded(chatID, roomID, userID, kind string)
}

// Handler обрабатывает REST-эндпоинты управления групповыми звонками.
type Handler struct {
	SFU *sfu.Manager
	Hub Broadcaster
}

func httpErr(w http.ResponseWriter, msg string, code int) {
	http.Error(w, msg, code)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// POST /api/calls/room
// Body: {"roomId": "...", "chatId": "..."}
// Returns: {"roomId": "...", "chatId": "..."}
func (h *Handler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	if userID == "" {
		httpErr(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		RoomID string `json:"roomId"`
		ChatID string `json:"chatId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ChatID == "" {
		httpErr(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.RoomID == "" {
		req.RoomID = req.ChatID + "-room"
	}

	room := h.SFU.CreateRoom(req.RoomID, req.ChatID, userID)
	h.Hub.BroadcastRoomCreated(room.ChatID, room.ID, userID)

	w.WriteHeader(http.StatusCreated)
	writeJSON(w, map[string]string{
		"roomId": room.ID,
		"chatId": room.ChatID,
	})
}

// DELETE /api/calls/room/{roomId}
func (h *Handler) DeleteRoom(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	if userID == "" {
		httpErr(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	roomID := chi.URLParam(r, "roomId")
	if err := h.SFU.DeleteRoom(roomID); err != nil {
		if errors.Is(err, sfu.ErrRoomNotFound) {
			httpErr(w, "room not found", http.StatusNotFound)
			return
		}
		httpErr(w, "server error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GET /api/calls/room/{roomId}/participants
// Returns: [{"userId":"...","deviceId":"...","hasAudio":true,"hasVideo":false}]
func (h *Handler) GetParticipants(w http.ResponseWriter, r *http.Request) {
	roomID := chi.URLParam(r, "roomId")

	room, err := h.SFU.GetRoom(roomID)
	if err != nil {
		if errors.Is(err, sfu.ErrRoomNotFound) {
			httpErr(w, "room not found", http.StatusNotFound)
			return
		}
		httpErr(w, "server error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, room.Participants)
}

// POST /api/calls/room/{roomId}/join
// Body: {"sdpOffer": "...", "deviceId": "..."}
// Returns: {"sdpAnswer": "..."}
func (h *Handler) JoinRoom(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	if userID == "" {
		httpErr(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	roomID := chi.URLParam(r, "roomId")

	var req struct {
		SDPOffer string `json:"sdpOffer"`
		DeviceID string `json:"deviceId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid request body", http.StatusBadRequest)
		return
	}

	deviceID := req.DeviceID
	if deviceID == "" {
		deviceID = "default"
	}

	sdpAnswer, err := h.SFU.Join(roomID, userID, deviceID, req.SDPOffer)
	if err != nil {
		if errors.Is(err, sfu.ErrRoomNotFound) {
			httpErr(w, "room not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, sfu.ErrAlreadyInRoom) {
			httpErr(w, "already in room", http.StatusConflict)
			return
		}
		httpErr(w, "join failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	room, _ := h.SFU.GetRoom(roomID)
	if room != nil {
		h.Hub.BroadcastParticipantJoined(room.ChatID, roomID, userID, deviceID)
	}

	writeJSON(w, map[string]string{
		"sdpAnswer": sdpAnswer,
	})
}

// POST /api/calls/room/{roomId}/leave
func (h *Handler) LeaveRoom(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	if userID == "" {
		httpErr(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	roomID := chi.URLParam(r, "roomId")
	room, getErr := h.SFU.GetRoom(roomID)
	if getErr != nil {
		if errors.Is(getErr, sfu.ErrRoomNotFound) {
			httpErr(w, "room not found", http.StatusNotFound)
			return
		}
		httpErr(w, "server error", http.StatusInternalServerError)
		return
	}

	if err := h.SFU.Leave(roomID, userID); err != nil && !errors.Is(err, sfu.ErrRoomNotFound) {
		httpErr(w, "server error", http.StatusInternalServerError)
		return
	}

	h.Hub.BroadcastParticipantLeft(room.ChatID, roomID, userID)
	w.WriteHeader(http.StatusNoContent)
}
