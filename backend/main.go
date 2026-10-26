// Captr -- Fotos sammeln, entwickeln und zusammensetzen, im Browser.
//
// Der Dienst nimmt Bilder entgegen (RAW, JPEG, PNG, TIFF, WebP, HEIC), liest
// ihre Aufnahmedaten, legt Vorschauen an und liefert die Bildpunkte mit 16 Bit
// je Kanal an die Oberflaeche. Entwickelt wird dort, auf der Grafikkarte; der
// Dienst speichert nur die Einstellungen. Die Leinwand stammt aus ArtCraft und
// setzt Bilder, Freisteller, Formen und Pinselstriche zusammen.
package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

//go:embed all:web
var webDateien embed.FS

func umgebung(name, vorgabe string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return vorgabe
}

func main() {
	log.SetFlags(log.Ldate | log.Ltime)

	daten := umgebung("CAPTR_DATEN", "./daten")
	ablage, err := OeffneAblage(daten)
	if err != nil {
		log.Fatalf("Ablage: %v", err)
	}

	web, err := fs.Sub(webDateien, "web")
	if err != nil {
		log.Fatal(err)
	}

	d := &Dienst{
		ablage:    ablage,
		werkstatt: NeueWerkstatt(ablage, max(1, runtime.NumCPU()/2)),
		rembg:     umgebung("CAPTR_REMBG", "http://rembg:7000"),
		rembgNetz: umgebung("CAPTR_REMBG_MODELL", "isnet-general-use"),
		kennwort:  os.Getenv("CAPTR_KENNWORT"),
	}

	adresse := ":" + umgebung("PORT", "8080")
	server := &http.Server{
		Addr:              adresse,
		Handler:           d.Wege(web),
		ReadHeaderTimeout: 20 * time.Second,
	}
	log.Printf("Captr hoert auf %s, Daten in %s, %d Bilder", adresse, filepath.Clean(daten), ablage.AnzahlBilder())
	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
