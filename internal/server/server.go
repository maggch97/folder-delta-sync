package server

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const DefaultReadHeaderTimeout = 10 * time.Second

type Config struct {
	BaseDir string
	Token   string
}

type Server struct {
	baseDir string
	token   string
	mux     *http.ServeMux
}

func New(cfg Config) (*Server, error) {
	baseDir, err := filepath.Abs(cfg.BaseDir)
	if err != nil {
		return nil, err
	}
	app := &Server{
		baseDir: baseDir,
		token:   cfg.Token,
		mux:     http.NewServeMux(),
	}
	app.routes()
	return app, nil
}

func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) routes() {
	api := func(next http.HandlerFunc) http.HandlerFunc {
		return s.withAuth(next)
	}
	s.mux.HandleFunc("GET /api/status", api(s.status))
	s.mux.HandleFunc("POST /api/plan", api(s.plan))
	s.mux.HandleFunc("POST /api/dirs", api(s.createDirs))
	s.mux.HandleFunc("PUT /api/file", api(s.uploadFile))

	static, err := staticHandler()
	if err != nil {
		s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusInternalServerError, err)
		})
		return
	}
	s.mux.Handle("/", static)
}

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.token == "" {
			next(w, r)
			return
		}
		value := r.Header.Get("Authorization")
		if value != "Bearer "+s.token {
			writeError(w, http.StatusUnauthorized, errors.New("unauthorized"))
			return
		}
		next(w, r)
	}
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, StatusResponse{
		BaseDir: s.baseDir,
		Auth:    s.token != "",
	})
}

func (s *Server) plan(w http.ResponseWriter, r *http.Request) {
	var req PlanRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	resp := PlanResponse{
		CreateDirs:     []string{},
		Uploads:        []UploadPlanItem{},
		HashCandidates: []HashCandidate{},
		Conflicts:      []Conflict{},
		Stats: PlanStats{
			Files: len(req.Files),
			Dirs:  len(req.Dirs),
		},
	}

	seenDirs := map[string]bool{}
	for _, rawDir := range req.Dirs {
		rel, err := normalizeRelative(rawDir)
		if err != nil {
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rawDir, Reason: "invalid path"})
			continue
		}
		if seenDirs[rel] {
			continue
		}
		seenDirs[rel] = true
		target, err := s.targetPath(rel)
		if err != nil {
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: "invalid path"})
			continue
		}
		info, err := os.Stat(target)
		switch {
		case err == nil && info.IsDir():
			continue
		case err == nil && !info.IsDir():
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: "target file exists where directory is needed"})
		case os.IsNotExist(err):
			resp.CreateDirs = append(resp.CreateDirs, rel)
		default:
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: err.Error()})
		}
	}

	for _, src := range req.Files {
		rel, err := normalizeRelative(src.Path)
		if err != nil {
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: src.Path, Reason: "invalid path"})
			continue
		}
		resp.Stats.Bytes += src.Size
		target, err := s.targetPath(rel)
		if err != nil {
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: "invalid path"})
			continue
		}
		info, err := os.Stat(target)
		switch {
		case os.IsNotExist(err):
			resp.Uploads = append(resp.Uploads, UploadPlanItem{Path: rel, Size: src.Size, ModTimeMs: src.ModTimeMs, Reason: "missing"})
			resp.Stats.MissingFiles++
		case err != nil:
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: err.Error()})
		case info.IsDir():
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: "target directory exists where file is needed"})
		case info.Size() != src.Size:
			resp.Uploads = append(resp.Uploads, UploadPlanItem{Path: rel, Size: src.Size, ModTimeMs: src.ModTimeMs, Reason: "size"})
			resp.Stats.SizeChanged++
		case src.Size == 0:
			continue
		default:
			sum, err := hashFile(target)
			if err != nil {
				resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: err.Error()})
				continue
			}
			resp.HashCandidates = append(resp.HashCandidates, HashCandidate{
				Path:            rel,
				Size:            src.Size,
				ModTimeMs:       src.ModTimeMs,
				TargetHash:      sum,
				TargetModTimeMs: info.ModTime().UnixMilli(),
			})
			resp.Stats.HashChecked++
		}
	}
	resp.Stats.CreateDirs = len(resp.CreateDirs)
	resp.Stats.Conflicts = len(resp.Conflicts)
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) createDirs(w http.ResponseWriter, r *http.Request) {
	var req CreateDirsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	resp := CreateDirsResponse{Created: []string{}, Conflicts: []Conflict{}}
	for _, rawDir := range req.Dirs {
		rel, err := normalizeRelative(rawDir)
		if err != nil {
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rawDir, Reason: "invalid path"})
			continue
		}
		target, err := s.targetPath(rel)
		if err != nil {
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: "invalid path"})
			continue
		}
		if info, err := os.Stat(target); err == nil && !info.IsDir() {
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: "target file exists"})
			continue
		}
		if err := os.MkdirAll(target, 0755); err != nil {
			resp.Conflicts = append(resp.Conflicts, Conflict{Path: rel, Reason: err.Error()})
			continue
		}
		resp.Created = append(resp.Created, rel)
	}
	if len(resp.Conflicts) > 0 {
		writeJSON(w, http.StatusConflict, resp)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) uploadFile(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	if rel == "" {
		writeError(w, http.StatusBadRequest, errors.New("missing path"))
		return
	}
	clean, err := normalizeRelative(rel)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	target, err := s.targetPath(clean)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if info, err := os.Stat(target); err == nil && info.IsDir() {
		writeError(w, http.StatusConflict, errors.New("target directory exists where file is needed"))
		return
	}

	expectedSize, hasExpectedSize, err := int64Query(r, "size")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	modTimeMs, hasModTime, err := int64Query(r, "mtimeMs")
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	expectedHash := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("sha256")))
	if expectedHash != "" && len(expectedHash) != sha256.Size*2 {
		writeError(w, http.StatusBadRequest, errors.New("invalid sha256"))
		return
	}

	body, compressed, wireCounter, err := uploadBodyReader(r)
	if err != nil {
		writeError(w, http.StatusUnsupportedMediaType, err)
		return
	}
	if closer, ok := body.(io.Closer); ok {
		defer closer.Close()
	}

	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0755); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}

	tmp, err := os.CreateTemp(dir, ".folder-delta-sync-*")
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	tmpName := tmp.Name()
	defer func() {
		_ = os.Remove(tmpName)
	}()

	h := sha256.New()
	written, copyErr := io.Copy(tmp, io.TeeReader(body, h))
	closeErr := tmp.Close()
	if copyErr != nil {
		writeError(w, http.StatusInternalServerError, copyErr)
		return
	}
	if closeErr != nil {
		writeError(w, http.StatusInternalServerError, closeErr)
		return
	}
	if hasExpectedSize && written != expectedSize {
		writeError(w, http.StatusBadRequest, fmt.Errorf("size mismatch: got %d, want %d", written, expectedSize))
		return
	}
	actualHash := hex.EncodeToString(h.Sum(nil))
	if expectedHash != "" && actualHash != expectedHash {
		writeError(w, http.StatusBadRequest, errors.New("sha256 mismatch"))
		return
	}

	if err := replaceFile(tmpName, target); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if hasModTime {
		t := time.UnixMilli(modTimeMs)
		_ = os.Chtimes(target, t, t)
	}

	writeJSON(w, http.StatusOK, UploadResponse{
		Path:       clean,
		Size:       written,
		WireSize:   wireCounter.N,
		Compressed: compressed,
		SHA256:     actualHash,
	})
}

type countingReader struct {
	R io.Reader
	N int64
}

func (r *countingReader) Read(p []byte) (int, error) {
	n, err := r.R.Read(p)
	r.N += int64(n)
	return n, err
}

func uploadBodyReader(r *http.Request) (io.Reader, bool, *countingReader, error) {
	wireCounter := &countingReader{R: r.Body}
	encoding := strings.TrimSpace(strings.ToLower(r.Header.Get("Content-Encoding")))
	switch encoding {
	case "", "identity":
		return wireCounter, false, wireCounter, nil
	case "gzip", "x-gzip":
		reader, err := gzip.NewReader(wireCounter)
		if err != nil {
			return nil, true, wireCounter, err
		}
		return reader, true, wireCounter, nil
	default:
		return nil, false, wireCounter, fmt.Errorf("unsupported content-encoding: %s", encoding)
	}
}

func replaceFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(src, dst)
}

func int64Query(r *http.Request, key string) (int64, bool, error) {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return 0, false, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, true, fmt.Errorf("invalid %s", key)
	}
	return value, true, nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, ErrorResponse{Error: err.Error()})
}
