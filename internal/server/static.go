package server

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/indask/folder-delta-sync/web"
)

func staticHandler() (http.Handler, error) {
	dist, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		return nil, err
	}
	fileServer := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			serveIndex(w, r, dist)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if file, err := dist.Open(name); err == nil {
			_ = file.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		serveIndex(w, r, dist)
	}), nil
}

func serveIndex(w http.ResponseWriter, r *http.Request, dist fs.FS) {
	http.ServeFileFS(w, r, dist, "index.html")
}
