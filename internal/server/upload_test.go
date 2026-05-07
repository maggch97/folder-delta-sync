package server

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestUploadGzip(t *testing.T) {
	base := t.TempDir()
	app, err := New(Config{BaseDir: base})
	if err != nil {
		t.Fatal(err)
	}

	var body bytes.Buffer
	gz := gzip.NewWriter(&body)
	if _, err := gz.Write([]byte("hello world")); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	compressedLen := body.Len()

	req := httptest.NewRequest(http.MethodPut, "/api/file?path=sub/a.txt&size=11&mtimeMs=1700000000000", &body)
	req.Header.Set("Content-Encoding", "gzip")
	rec := httptest.NewRecorder()
	app.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}

	var resp UploadResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	if !resp.Compressed {
		t.Fatal("expected compressed response")
	}
	if resp.WireSize != int64(compressedLen) {
		t.Fatalf("wire size got %d, want %d", resp.WireSize, compressedLen)
	}

	got, err := os.ReadFile(filepath.Join(base, "sub", "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "hello world" {
		t.Fatalf("got %q", got)
	}
}

func TestUploadRejectsUnsupportedEncoding(t *testing.T) {
	app, err := New(Config{BaseDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPut, "/api/file?path=a.txt&size=1", bytes.NewBufferString("a"))
	req.Header.Set("Content-Encoding", "br")
	rec := httptest.NewRecorder()
	app.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
}
