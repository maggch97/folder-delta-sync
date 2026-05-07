package server

import (
	"path/filepath"
	"testing"
)

func TestNormalizeRelative(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "simple", input: "a/b.txt", want: "a/b.txt"},
		{name: "backslash", input: "a\\b.txt", want: "a/b.txt"},
		{name: "parent", input: "../b.txt", wantErr: true},
		{name: "nested parent", input: "a/../b.txt", wantErr: true},
		{name: "absolute", input: "/a.txt", wantErr: true},
		{name: "drive", input: "C:/a.txt", wantErr: true},
		{name: "empty segment", input: "a//b.txt", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeRelative(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestTargetPathStaysInsideBase(t *testing.T) {
	base := t.TempDir()
	app, err := New(Config{BaseDir: base})
	if err != nil {
		t.Fatal(err)
	}

	got, err := app.targetPath("sub/a.txt")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(base, "sub", "a.txt")
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}

	if _, err := app.targetPath("../a.txt"); err == nil {
		t.Fatal("expected traversal path to be rejected")
	}
}
