package monitoring

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
)

type Handler struct{}

type SystemStats struct {
	CPUPercent float64 `json:"cpuPercent"`
	RAMUsed    uint64  `json:"ramUsed"`
	RAMTotal   uint64  `json:"ramTotal"`
	DiskUsed   uint64  `json:"diskUsed"`
	DiskTotal  uint64  `json:"diskTotal"`
}

func CollectStats() (SystemStats, error) {
	var s SystemStats

	cpuPct, err := cpu.Percent(200*time.Millisecond, false)
	if err == nil && len(cpuPct) > 0 {
		s.CPUPercent = cpuPct[0]
	}

	vmStat, err := mem.VirtualMemory()
	if err == nil {
		s.RAMUsed = vmStat.Used
		s.RAMTotal = vmStat.Total
	}

	diskStat, err := disk.Usage("/")
	if err == nil {
		s.DiskUsed = diskStat.Used
		s.DiskTotal = diskStat.Total
	}

	return s, nil
}

func (h *Handler) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := CollectStats()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": "failed to collect stats"}) //nolint:errcheck
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats) //nolint:errcheck
}

func (h *Handler) StreamStats(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	send := func() {
		stats, err := CollectStats()
		if err != nil {
			return
		}
		data, err := json.Marshal(stats)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "event: stats\ndata: %s\n\n", data) //nolint:errcheck
		flusher.Flush()
	}

	send()

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			send()
		}
	}
}
