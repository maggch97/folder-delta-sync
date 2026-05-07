package server

import (
	"errors"
	"path"
	"path/filepath"
	"strings"
)

var errInvalidPath = errors.New("invalid relative path")

func normalizeRelative(raw string) (string, error) {
	raw = strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if raw == "" {
		return "", errInvalidPath
	}
	if strings.Contains(raw, ":") || strings.HasPrefix(raw, "/") {
		return "", errInvalidPath
	}
	for _, segment := range strings.Split(raw, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", errInvalidPath
		}
	}
	clean := path.Clean("/" + raw)
	clean = strings.TrimPrefix(clean, "/")
	if clean == "." || clean == "" || strings.HasPrefix(clean, "../") || clean == ".." {
		return "", errInvalidPath
	}
	return clean, nil
}

func (s *Server) targetPath(rel string) (string, error) {
	clean, err := normalizeRelative(rel)
	if err != nil {
		return "", err
	}
	full := filepath.Join(s.baseDir, filepath.FromSlash(clean))
	abs, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	relToBase, err := filepath.Rel(s.baseDir, abs)
	if err != nil {
		return "", err
	}
	if relToBase == ".." || strings.HasPrefix(relToBase, ".."+string(filepath.Separator)) || filepath.IsAbs(relToBase) {
		return "", errInvalidPath
	}
	return abs, nil
}
