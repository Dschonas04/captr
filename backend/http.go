package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"io/fs"
	"log"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "image/png"
)

const (
	maxDatei   = 400 << 20 // ein RAW einer Mittelformatkamera passt hinein
	maxVorlage = 24 << 20  // bearbeitete Vorschauen, Freisteller, Szenen
)

type Dienst struct {
	ablage    *Ablage
	werkstatt *Werkstatt
	rembg     string
	rembgNetz string
	kennwort  string
}

func (d *Dienst) Wege(web fs.FS) http.Handler {
	m := http.NewServeMux()

	m.HandleFunc("GET /api/status", d.status)
	m.HandleFunc("POST /api/anmelden", func(w http.ResponseWriter, r *http.Request) {
		if !gleicheHerkunft(r) {
			fehler(w, http.StatusForbidden, "fremde Herkunft")
			return
		}
		d.anmelden(w, r)
	})

	m.HandleFunc("GET /api/bilder", d.geschuetzt(d.bilder))
	m.HandleFunc("POST /api/bilder", d.geschuetzt(d.hochladen))
	m.HandleFunc("GET /api/bilder/{id}", d.geschuetzt(d.bild))
	m.HandleFunc("PATCH /api/bilder/{id}", d.geschuetzt(d.bildAendern))
	m.HandleFunc("DELETE /api/bilder/{id}", d.geschuetzt(d.bildLoeschen))
	m.HandleFunc("GET /api/bilder/{id}/mini", d.geschuetzt(d.mini))
	m.HandleFunc("GET /api/bilder/{id}/vorschau", d.geschuetzt(d.mini))
	m.HandleFunc("PUT /api/bilder/{id}/mini", d.geschuetzt(d.miniSetzen))
	m.HandleFunc("PUT /api/bilder/{id}/vorschau", d.geschuetzt(d.miniSetzen))
	m.HandleFunc("GET /api/bilder/{id}/pixel", d.geschuetzt(d.pixel))
	m.HandleFunc("GET /api/bilder/{id}/original", d.geschuetzt(d.original))

	m.HandleFunc("POST /api/freistellen", d.geschuetzt(d.freistellen))
	m.HandleFunc("GET /api/freisteller/{datei}", d.geschuetzt(d.freisteller))

	m.HandleFunc("GET /api/leinwaende", d.geschuetzt(d.leinwaende))
	m.HandleFunc("POST /api/leinwaende", d.geschuetzt(d.leinwandSpeichern))
	m.HandleFunc("GET /api/leinwaende/{id}", d.geschuetzt(d.leinwand))
	m.HandleFunc("PUT /api/leinwaende/{id}", d.geschuetzt(d.leinwandSpeichern))
	m.HandleFunc("DELETE /api/leinwaende/{id}", d.geschuetzt(d.leinwandLoeschen))
	m.HandleFunc("GET /api/leinwaende/{id}/vorschau", d.geschuetzt(d.leinwandVorschau))
	m.HandleFunc("PUT /api/leinwaende/{id}/vorschau", d.geschuetzt(d.leinwandVorschauSetzen))

	m.HandleFunc("GET /api/vorlagen", d.geschuetzt(d.vorlagen))
	m.HandleFunc("POST /api/vorlagen", d.geschuetzt(d.vorlageAnlegen))
	m.HandleFunc("DELETE /api/vorlagen/{id}", d.geschuetzt(d.vorlageLoeschen))

	m.Handle("/", seite(web))
	return protokoll(m)
}

// ---------- Rahmen ----------

// seite liefert die gebaute Oberflaeche; unbekannte Wege bekommen index.html,
// damit Neuladen auf /entwickeln/... funktioniert.
func seite(web fs.FS) http.Handler {
	dateien := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if _, err := fs.Stat(web, p); err != nil {
			if strings.HasPrefix(r.URL.Path, "/api/") || path.Ext(p) != "" {
				http.NotFound(w, r)
				return
			}
			r.URL.Path = "/"
		}
		if strings.HasPrefix(p, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		dateien.ServeHTTP(w, r)
	})
}

func protokoll(n http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		anfang := time.Now()
		n.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasSuffix(r.URL.Path, "/mini") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(anfang).Round(time.Millisecond))
		}
	})
}

// Ohne gesetztes Kennwort laeuft der Dienst offen -- so ist er im Heimnetz
// gedacht. Mit Kennwort verlangt jede Schnittstelle das Merkmal.
func (d *Dienst) geschuetzt(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !gleicheHerkunft(r) {
			fehler(w, http.StatusForbidden, "fremde Herkunft")
			return
		}
		if d.kennwort == "" || d.erlaubt(r) {
			h(w, r)
			return
		}
		if r.Header.Get("X-Captr") != "" {
			bremse() // falsches Kennwort im Kopf: genauso muehsam wie bei der Anmeldung
		}
		fehler(w, http.StatusUnauthorized, "anmelden")
	}
}

// gleicheHerkunft weist schreibende Anfragen fremder Seiten ab. Ohne
// Kennwort koennte sonst jede Webseite, die jemand im Heimnetz oeffnet,
// Bilder loeschen oder hochladen.
func gleicheHerkunft(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	herkunft := r.Header.Get("Origin")
	if herkunft == "" {
		return true // Skripte und curl schicken keine
	}
	u, err := url.Parse(herkunft)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

// Fehlversuche laufen nacheinander durch eine Sekunde Wartezeit, auch wenn
// jemand viele Anfragen gleichzeitig schickt.
var rateSperre sync.Mutex

func bremse() {
	rateSperre.Lock()
	time.Sleep(time.Second)
	rateSperre.Unlock()
}

// Skripte schicken das Kennwort in X-Captr, der Browser einen Keks mit einem
// davon abgeleiteten Merkmal -- nie das Kennwort selbst.
func (d *Dienst) erlaubt(r *http.Request) bool {
	if gleich(r.Header.Get("X-Captr"), d.kennwort) {
		return true
	}
	if k, err := r.Cookie("captr"); err == nil && gleich(k.Value, d.merkmal()) {
		return true
	}
	return false
}

func (d *Dienst) merkmal() string {
	m := hmac.New(sha256.New, []byte(d.kennwort))
	m.Write([]byte("captr-anmeldung"))
	return hex.EncodeToString(m.Sum(nil))
}

func gleich(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func (d *Dienst) anmelden(w http.ResponseWriter, r *http.Request) {
	var rumpf struct {
		Kennwort string `json:"kennwort"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&rumpf); err != nil {
		fehler(w, http.StatusBadRequest, "unlesbar")
		return
	}
	if d.kennwort == "" || !gleich(rumpf.Kennwort, d.kennwort) {
		bremse() // Raten soll muehsam sein
		fehler(w, http.StatusUnauthorized, "falsches Kennwort")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "captr", Value: d.merkmal(), Path: "/",
		MaxAge: 60 * 60 * 24 * 365, HttpOnly: true, SameSite: http.SameSiteStrictMode,
		Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"})
	gib(w, map[string]any{"ok": true})
}

func (d *Dienst) status(w http.ResponseWriter, r *http.Request) {
	gib(w, map[string]any{
		"kennwort":    d.kennwort != "",
		"angemeldet":  d.kennwort == "" || d.erlaubt(r),
		"freistellen": d.rembg != "",
	})
}

func gib(w http.ResponseWriter, wert any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(wert)
}

func fehler(w http.ResponseWriter, code int, text string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"fehler": text})
}

// fehlerVon uebersetzt Ablagefehler: nicht gefunden wird 404, alles andere
// gilt als Eingabefehler, ausser es ist ein interner.
func fehlerVon(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNichtGefunden) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return
	}
	fehler(w, http.StatusBadRequest, err.Error())
}

func intern(w http.ResponseWriter, err error) {
	log.Printf("Fehler: %v", err)
	fehler(w, http.StatusInternalServerError, "interner Fehler")
}

func (d *Dienst) bildAusPfad(w http.ResponseWriter, r *http.Request) *Bild {
	id := r.PathValue("id")
	if !gueltigeID(id) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return nil
	}
	b, err := d.ablage.Bild(id)
	if err != nil {
		fehlerVon(w, err)
		return nil
	}
	return b
}

// ---------- Bilder ----------

func (d *Dienst) bilder(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sterne, _ := strconv.Atoi(q.Get("bewertung"))
	liste, err := d.ablage.Bilder(BildFilter{
		Bewertung: sterne, Markierung: q.Get("markierung"), Art: q.Get("art"),
		Farbe: q.Get("farbe"), Suche: q.Get("suche"), Ordnung: q.Get("ordnung"),
	})
	if err != nil {
		intern(w, err)
		return
	}
	gib(w, liste)
}

// hochladen nimmt beliebig viele Dateien als multipart/form-data entgegen und
// liest sie nacheinander, ohne sie ganz in den Speicher zu holen.
func (d *Dienst) hochladen(w http.ResponseWriter, r *http.Request) {
	leser, err := r.MultipartReader()
	if err != nil {
		fehler(w, http.StatusBadRequest, "multipart/form-data erwartet")
		return
	}
	type ergebnis struct {
		Bilder []*Bild  `json:"bilder"`
		Fehler []string `json:"fehler"`
	}
	erg := ergebnis{Bilder: []*Bild{}, Fehler: []string{}}
	for {
		teil, err := leser.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			erg.Fehler = append(erg.Fehler, "Übertragung abgebrochen")
			break
		}
		name := teil.FileName()
		if name == "" {
			teil.Close()
			continue
		}
		b, err := d.werkstatt.NimmAuf(r.Context(), name, teil, maxDatei)
		teil.Close()
		if err != nil {
			log.Printf("Einlesen %q: %v", name, err)
			erg.Fehler = append(erg.Fehler, err.Error())
			continue
		}
		erg.Bilder = append(erg.Bilder, b)
	}
	if len(erg.Bilder) == 0 && len(erg.Fehler) > 0 {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(erg)
		return
	}
	gib(w, erg)
}

func (d *Dienst) bild(w http.ResponseWriter, r *http.Request) {
	if b := d.bildAusPfad(w, r); b != nil {
		gib(w, b)
	}
}

func (d *Dienst) bildAendern(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !gueltigeID(id) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return
	}
	var ae Aenderung
	if err := json.NewDecoder(io.LimitReader(r.Body, 128<<10)).Decode(&ae); err != nil {
		fehler(w, http.StatusBadRequest, "unlesbar")
		return
	}
	b, err := d.ablage.AendereBild(id, ae)
	if err != nil {
		fehlerVon(w, err)
		return
	}
	if !b.Bearbeitet {
		// zurueckgesetzt: wieder die unbearbeiteten Vorschauen zeigen
		_ = os.Remove(d.ablage.Pfad("mini", id+"-b.jpg"))
		_ = os.Remove(d.ablage.Pfad("mini", id+"-bv.jpg"))
	}
	gib(w, b)
}

func (d *Dienst) bildLoeschen(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !gueltigeID(id) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return
	}
	if err := d.ablage.LoescheBild(id); err != nil {
		fehlerVon(w, err)
		return
	}
	gib(w, map[string]any{"ok": true})
}

// miniDatei: Kachel oder Vorschau, die bearbeitete, wenn es sie gibt.
func (d *Dienst) miniDatei(id string, vorschau, bearbeitet bool) string {
	name := id
	if bearbeitet {
		name += "-b"
	}
	if vorschau {
		if bearbeitet {
			name += "v"
		} else {
			name += "-v"
		}
	}
	return d.ablage.Pfad("mini", name+".jpg")
}

func (d *Dienst) mini(w http.ResponseWriter, r *http.Request) {
	b := d.bildAusPfad(w, r)
	if b == nil {
		return
	}
	vorschau := strings.HasSuffix(r.URL.Path, "/vorschau")
	pfad := d.miniDatei(b.ID, vorschau, false)
	if r.URL.Query().Get("roh") == "" {
		if p := d.miniDatei(b.ID, vorschau, true); dateiDa(p) {
			pfad = p
		}
	}
	w.Header().Set("Content-Type", "image/jpeg")
	// Die Adresse enthaelt ?v=<geaendert>, darum darf der Browser lange behalten.
	w.Header().Set("Cache-Control", "private, max-age=31536000")
	http.ServeFile(w, r, pfad)
}

// miniSetzen nimmt die im Browser entwickelte Kachel oder Vorschau entgegen.
func (d *Dienst) miniSetzen(w http.ResponseWriter, r *http.Request) {
	b := d.bildAusPfad(w, r)
	if b == nil {
		return
	}
	daten, err := io.ReadAll(io.LimitReader(r.Body, maxVorlage+1))
	if err != nil || len(daten) > maxVorlage {
		fehler(w, http.StatusRequestEntityTooLarge, "zu groß")
		return
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(daten))
	if err != nil || format != "jpeg" || cfg.Width > 4096 || cfg.Height > 4096 {
		fehler(w, http.StatusBadRequest, "JPEG bis 4096 Pixel erwartet")
		return
	}
	ziel := d.miniDatei(b.ID, strings.HasSuffix(r.URL.Path, "/vorschau"), true)
	if err := schreibeAtomar(ziel, daten); err != nil {
		intern(w, err)
		return
	}
	gib(w, map[string]any{"ok": true})
}

func (d *Dienst) pixel(w http.ResponseWriter, r *http.Request) {
	b := d.bildAusPfad(w, r)
	if b == nil {
		return
	}
	max, _ := strconv.Atoi(r.URL.Query().Get("max"))
	// nur wenige Groessen, damit der Zwischenspeicher nicht waechst
	switch {
	case max <= 0:
		max = 0
	case max <= 1024:
		max = 1024
	case max <= 2560:
		max = 2560
	default:
		max = 0
	}
	pfad, err := d.werkstatt.PixelDatei(r.Context(), b, max)
	if err != nil {
		if r.Context().Err() != nil {
			return
		}
		log.Printf("Bildpunkte %s: %v", b.ID, err)
		fehler(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Encoding", "gzip")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	f, err := os.Open(pfad)
	if err != nil {
		intern(w, err)
		return
	}
	defer f.Close()
	if st, err := f.Stat(); err == nil {
		w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	}
	_, _ = io.Copy(w, f)
}

func (d *Dienst) original(w http.ResponseWriter, r *http.Request) {
	b := d.bildAusPfad(w, r)
	if b == nil {
		return
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", dateiName(b.Name)))
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, d.ablage.Pfad("originale", b.Datei))
}

// dateiName haelt Anfuehrungszeichen und Steuerzeichen aus dem Kopf heraus.
func dateiName(s string) string {
	return strings.Map(func(c rune) rune {
		if c < 32 || c == '"' || c == '\\' || c == '/' {
			return '_'
		}
		return c
	}, s)
}

func dateiDa(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func schreibeAtomar(pfad string, daten []byte) error {
	tmp := pfad + ".tmp"
	if err := os.WriteFile(tmp, daten, 0o640); err != nil {
		return err
	}
	return os.Rename(tmp, pfad)
}

// ---------- Freistellen ----------

// freistellen schickt ein Bild an rembg und legt das Ergebnis als PNG ab.
// Alles bleibt im Heimnetz; das Modell laeuft im Nachbarcontainer.
func (d *Dienst) freistellen(w http.ResponseWriter, r *http.Request) {
	if d.rembg == "" {
		fehler(w, http.StatusServiceUnavailable, "Freistellen ist nicht eingerichtet")
		return
	}
	daten, err := io.ReadAll(io.LimitReader(r.Body, maxVorlage+1))
	if err != nil || len(daten) > maxVorlage {
		fehler(w, http.StatusRequestEntityTooLarge, "zu groß")
		return
	}
	if _, _, err := image.DecodeConfig(bytes.NewReader(daten)); err != nil {
		fehler(w, http.StatusBadRequest, "kein lesbares Bild")
		return
	}
	var rumpf bytes.Buffer
	mp := multipart.NewWriter(&rumpf)
	teil, _ := mp.CreateFormFile("file", "bild")
	_, _ = teil.Write(daten)
	_ = mp.WriteField("model", d.rembgNetz)
	_ = mp.Close()

	anfrage, err := http.NewRequestWithContext(r.Context(), http.MethodPost, strings.TrimRight(d.rembg, "/")+"/api/remove", &rumpf)
	if err != nil {
		intern(w, err)
		return
	}
	anfrage.Header.Set("Content-Type", mp.FormDataContentType())
	client := &http.Client{Timeout: 5 * time.Minute}
	antwort, err := client.Do(anfrage)
	if err != nil {
		log.Printf("rembg: %v", err)
		fehler(w, http.StatusBadGateway, "Freistellen nicht erreichbar")
		return
	}
	defer antwort.Body.Close()
	png, err := io.ReadAll(io.LimitReader(antwort.Body, 4*maxVorlage))
	if err != nil || antwort.StatusCode != http.StatusOK || !bytes.HasPrefix(png, []byte("\x89PNG")) {
		log.Printf("rembg: Status %d, %d Bytes", antwort.StatusCode, len(png))
		fehler(w, http.StatusBadGateway, "Freistellen fehlgeschlagen")
		return
	}
	id := neueID()
	if err := schreibeAtomar(d.ablage.Pfad("freisteller", id+".png"), png); err != nil {
		intern(w, err)
		return
	}
	gib(w, map[string]any{"id": id, "url": "/api/freisteller/" + id + ".png"})
}

func (d *Dienst) freisteller(w http.ResponseWriter, r *http.Request) {
	id, ok := strings.CutSuffix(r.PathValue("datei"), ".png")
	if !ok || !gueltigeID(id) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeFile(w, r, d.ablage.Pfad("freisteller", id+".png"))
}

// ---------- Leinwaende ----------

func (d *Dienst) leinwaende(w http.ResponseWriter, r *http.Request) {
	liste, err := d.ablage.Leinwaende()
	if err != nil {
		intern(w, err)
		return
	}
	gib(w, liste)
}

func (d *Dienst) leinwand(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !gueltigeID(id) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return
	}
	l, err := d.ablage.Leinwand(id)
	if err != nil {
		fehlerVon(w, err)
		return
	}
	gib(w, l)
}

func (d *Dienst) leinwandSpeichern(w http.ResponseWriter, r *http.Request) {
	var l Leinwand
	// Szenen tragen eingebettete Bilder als data:-Adressen, darum grosszuegig.
	if err := json.NewDecoder(io.LimitReader(r.Body, 8*maxVorlage)).Decode(&l); err != nil {
		fehler(w, http.StatusBadRequest, "unlesbar oder zu groß")
		return
	}
	l.ID = ""
	if id := r.PathValue("id"); id != "" {
		if !gueltigeID(id) {
			fehler(w, http.StatusNotFound, "nicht gefunden")
			return
		}
		l.ID = id
	}
	if err := d.ablage.SpeichereLeinwand(&l); err != nil {
		fehlerVon(w, err)
		return
	}
	l.Szene = ""
	gib(w, l)
}

func (d *Dienst) leinwandLoeschen(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !gueltigeID(id) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return
	}
	if err := d.ablage.LoescheLeinwand(id); err != nil {
		fehlerVon(w, err)
		return
	}
	gib(w, map[string]any{"ok": true})
}

func (d *Dienst) leinwandVorschau(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !gueltigeID(id) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=31536000")
	http.ServeFile(w, r, d.ablage.Pfad("leinwand", id+".jpg"))
}

func (d *Dienst) leinwandVorschauSetzen(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !gueltigeID(id) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return
	}
	if _, err := d.ablage.Leinwand(id); err != nil {
		fehlerVon(w, err)
		return
	}
	daten, err := io.ReadAll(io.LimitReader(r.Body, maxVorlage+1))
	if err != nil || len(daten) > maxVorlage {
		fehler(w, http.StatusRequestEntityTooLarge, "zu groß")
		return
	}
	if _, err := jpeg.DecodeConfig(bytes.NewReader(daten)); err != nil {
		fehler(w, http.StatusBadRequest, "JPEG erwartet")
		return
	}
	if err := schreibeAtomar(d.ablage.Pfad("leinwand", id+".jpg"), daten); err != nil {
		intern(w, err)
		return
	}
	gib(w, map[string]any{"ok": true})
}

// ---------- Vorlagen ----------

func (d *Dienst) vorlagen(w http.ResponseWriter, r *http.Request) {
	liste, err := d.ablage.Vorlagen()
	if err != nil {
		intern(w, err)
		return
	}
	gib(w, liste)
}

func (d *Dienst) vorlageAnlegen(w http.ResponseWriter, r *http.Request) {
	var v Vorlage
	if err := json.NewDecoder(io.LimitReader(r.Body, 128<<10)).Decode(&v); err != nil {
		fehler(w, http.StatusBadRequest, "unlesbar")
		return
	}
	if err := d.ablage.LegeVorlageAn(&v); err != nil {
		fehlerVon(w, err)
		return
	}
	gib(w, v)
}

func (d *Dienst) vorlageLoeschen(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !gueltigeID(id) {
		fehler(w, http.StatusNotFound, "nicht gefunden")
		return
	}
	if err := d.ablage.LoescheVorlage(id); err != nil {
		intern(w, err)
		return
	}
	gib(w, map[string]any{"ok": true})
}
