package serverinfo

import (
	"encoding/json"
	"net/http"
)

type Handler struct {
	Name             string
	Description      string
	RegistrationMode string
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"name":             h.Name,
		"description":      h.Description,
		"registrationMode": h.RegistrationMode,
	})
}
