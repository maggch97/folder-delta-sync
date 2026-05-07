package main

import (
	"crypto/rand"
	"encoding/hex"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/indask/folder-delta-sync/internal/server"
)

func main() {
	var (
		baseDir   = flag.String("dir", "", "target base directory")
		listen    = flag.String("listen", ":8787", "listen address")
		token     = flag.String("token", "", "optional API token")
		genToken  = flag.Bool("gen-token", false, "generate a temporary API token")
		certFile  = flag.String("cert", "", "TLS certificate file")
		keyFile   = flag.String("key", "", "TLS private key file")
		showAddrs = flag.Bool("addrs", true, "print candidate browser URLs")
	)
	flag.Parse()

	if *baseDir == "" {
		log.Fatal("missing required -dir")
	}

	absBase, err := filepath.Abs(*baseDir)
	if err != nil {
		log.Fatalf("resolve base dir: %v", err)
	}
	if err := os.MkdirAll(absBase, 0755); err != nil {
		log.Fatalf("create base dir: %v", err)
	}

	if *genToken && *token == "" {
		value, err := randomToken()
		if err != nil {
			log.Fatalf("generate token: %v", err)
		}
		*token = value
	}

	app, err := server.New(server.Config{
		BaseDir: absBase,
		Token:   *token,
		TLS:     true,
	})
	if err != nil {
		log.Fatalf("start server: %v", err)
	}

	srv := &http.Server{
		Addr:              *listen,
		Handler:           app.Handler(),
		ReadHeaderTimeout: server.DefaultReadHeaderTimeout,
	}

	log.Printf("target dir: %s", absBase)
	log.Printf("listening: %s", *listen)
	if *showAddrs {
		for _, url := range candidateURLs(*listen, *token) {
			log.Printf("open: %s", url)
		}
	}
	if *token == "" {
		log.Printf("warning: no API token is configured")
	}

	if *certFile != "" || *keyFile != "" {
		if *certFile == "" || *keyFile == "" {
			log.Fatal("-cert and -key must be provided together")
		}
		err = srv.ListenAndServeTLS(*certFile, *keyFile)
	} else {
		tlsConfig, err := server.SelfSignedTLSConfig()
		if err != nil {
			log.Fatalf("create self-signed certificate: %v", err)
		}
		srv.TLSConfig = tlsConfig
		err = srv.ListenAndServeTLS("", "")
	}
	if err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func randomToken() (string, error) {
	buf := make([]byte, 18)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func candidateURLs(listen, token string) []string {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		if strings.HasPrefix(listen, ":") {
			port = strings.TrimPrefix(listen, ":")
		} else {
			return []string{withToken(fmt.Sprintf("https://%s/", listen), token)}
		}
	}
	if port == "" {
		port = "8787"
	}

	var hosts []string
	if host == "" || host == "0.0.0.0" || host == "::" {
		hosts = append(hosts, "localhost")
		ifaces, _ := net.Interfaces()
		for _, iface := range ifaces {
			if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
				continue
			}
			addrs, _ := iface.Addrs()
			for _, addr := range addrs {
				var ip net.IP
				switch value := addr.(type) {
				case *net.IPNet:
					ip = value.IP
				case *net.IPAddr:
					ip = value.IP
				}
				if ip == nil || ip.To4() == nil {
					continue
				}
				hosts = append(hosts, ip.String())
			}
		}
	} else {
		hosts = append(hosts, host)
	}

	urls := make([]string, 0, len(hosts))
	seen := map[string]bool{}
	for _, h := range hosts {
		if h == "" || seen[h] {
			continue
		}
		seen[h] = true
		urls = append(urls, withToken(fmt.Sprintf("https://%s:%s/", h, port), token))
	}
	return urls
}

func withToken(rawURL, token string) string {
	if token == "" {
		return rawURL
	}
	return rawURL + "?token=" + token
}
