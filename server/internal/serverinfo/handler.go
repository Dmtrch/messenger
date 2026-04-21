package serverinfo

import (
	"encoding/json"
	"net/http"
)

type Handler struct {
	Name                   string
	Description            string
	RegistrationMode       string
	AllowUsersCreateGroups bool
	MaxUploadBytes         int64
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
		"name":                   h.Name,
		"description":            h.Description,
		"registrationMode":       h.RegistrationMode,
		"allowUsersCreateGroups": h.AllowUsersCreateGroups,
		"maxUploadBytes":         h.MaxUploadBytes,
	})
}
