package downloads

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// Artifact describes one downloadable binary in the manifest.
type Artifact struct {
	Platform  string `json:"platform"`
	Arch      string `json:"arch"`
	Format    string `json:"format"`
	Filename  string `json:"filename"`
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
}

// Manifest is the JSON response for GET /api/downloads/manifest.
type Manifest struct {
	Version          string     `json:"version"`
	MinClientVersion string     `json:"minClientVersion"`
	Changelog        string     `json:"changelog,omitempty"`
	GeneratedAt      time.Time  `json:"generated_at"`
	Artifacts        []Artifact `json:"artifacts"`
}

// VersionResponse is the JSON response for GET /api/version.
type VersionResponse struct {
	Version          string `json:"version"`
	MinClientVersion string `json:"minClientVersion"`
	BuildDate        string `json:"buildDate"`
}

// Handler serves protected binary downloads.
type Handler struct {
	DownloadsDir     string
	Version          string
	MinClientVersion string
	Changelog        string
	BuildDate        string
}

// GetManifest — GET /api/downloads/manifest (requires auth).
// Scans DownloadsDir and returns JSON with SHA256 and size for each artifact.
func (h *Handler) GetManifest(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(h.DownloadsDir)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(Manifest{Version: h.Version, MinClientVersion: h.MinClientVersion, Changelog: h.Changelog, GeneratedAt: time.Now(), Artifacts: []Artifact{}}) //nolint:errcheck
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	artifacts := make([]Artifact, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		fullPath := filepath.Join(h.DownloadsDir, entry.Name())
		hash, err := fileSHA256(fullPath)
		if err != nil {
			continue
		}
		platform, arch, format := parseFilename(entry.Name())
		artifacts = append(artifacts, Artifact{
			Platform:  platform,
			Arch:      arch,
			Format:    format,
			Filename:  entry.Name(),
			URL:       "/api/downloads/" + entry.Name(),
			SHA256:    hash,
			SizeBytes: info.Size(),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Manifest{Version: h.Version, MinClientVersion: h.MinClientVersion, Changelog: h.Changelog, GeneratedAt: time.Now(), Artifacts: artifacts}) //nolint:errcheck
}

// ServeVersion — GET /api/version (public, no auth).
func (h *Handler) ServeVersion(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(VersionResponse{ //nolint:errcheck
		Version:          h.Version,
		MinClientVersion: h.MinClientVersion,
		BuildDate:        h.BuildDate,
	})
}

// ServeFile — GET /api/downloads/{filename} (requires auth).
// Streams the requested file; prevents directory traversal.
func (h *Handler) ServeFile(w http.ResponseWriter, r *http.Request) {
	filename := filepath.Base(chi.URLParam(r, "filename"))
	if strings.ContainsAny(filename, "/\\") || filename == "." || filename == ".." {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	absDir, err := filepath.Abs(h.DownloadsDir)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	absPath, err := filepath.Abs(filepath.Join(h.DownloadsDir, filename))
	if err != nil || !strings.HasPrefix(absPath, absDir+string(filepath.Separator)) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	f, err := os.Open(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "not found", http.StatusNotFound)
		} else {
			http.Error(w, "internal error", http.StatusInternalServerError)
		}
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	http.ServeContent(w, r, filename, info.ModTime(), f)
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// parseFilename extracts platform/arch/format from filenames like:
// messenger-1.0.0-windows-x86_64.exe
// messenger-1.0.0-macos-arm64.dmg
// messenger-1.0.0-linux-x86_64.deb
// messenger-1.0.0-android-arm64.apk
func parseFilename(name string) (platform, arch, format string) {
	ext := strings.TrimPrefix(filepath.Ext(name), ".")
	format = ext
	base := strings.TrimSuffix(name, "."+ext)
	parts := strings.Split(base, "-")
	if len(parts) >= 4 {
		platform = parts[len(parts)-2]
		arch = parts[len(parts)-1]
	} else if len(parts) >= 3 {
		platform = parts[len(parts)-1]
	}
	// Fallback: infer platform from extension
	if platform == "" {
		switch ext {
		case "exe", "msi":
			platform = "windows"
		case "dmg":
			platform = "macos"
		case "deb", "rpm":
			platform = "linux"
		case "apk":
			platform = "android"
		case "ipa":
			platform = "ios"
		}
	}
	return
}
