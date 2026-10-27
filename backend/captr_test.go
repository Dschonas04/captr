package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

func testDienst(t *testing.T) (*Dienst, *httptest.Server) {
	t.Helper()
	a, err := OeffneAblage(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	d := &Dienst{ablage: a, werkstatt: NeueWerkstatt(a, 2)}
	web := fstest.MapFS{"index.html": {Data: []byte("<!doctype html>")}}
	s := httptest.NewServer(d.Wege(web))
	t.Cleanup(s.Close)
	return d, s
}

func testPNG(b, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, b, h))
	for y := 0; y < h; y++ {
		for x := 0; x < b; x++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 128, 255})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func lade(t *testing.T, url, name string, daten []byte) *http.Response {
	t.Helper()
	var rumpf bytes.Buffer
	mp := multipart.NewWriter(&rumpf)
	f, _ := mp.CreateFormFile("dateien", name)
	_, _ = f.Write(daten)
	_ = mp.Close()
	res, err := http.Post(url+"/api/bilder", mp.FormDataContentType(), &rumpf)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestPPM(t *testing.T) {
	kopf := "P6\n# Kommentar\n2 1\n65535\n"
	daten := []byte(kopf)
	for _, v := range []uint16{1, 2, 3, 65535, 0, 300} {
		daten = binary.BigEndian.AppendUint16(daten, v)
	}
	p, err := lesePPM(bufio.NewReader(bytes.NewReader(daten)))
	if err != nil {
		t.Fatal(err)
	}
	if p.B != 2 || p.H != 1 || p.D[3] != 65535 || p.D[5] != 300 {
		t.Fatalf("falsch gelesen: %+v", p)
	}
	if _, err := lesePPM(bufio.NewReader(strings.NewReader("P5\n1 1\n255\n\x00"))); err == nil {
		t.Fatal("P5 haette scheitern muessen")
	}
}

func TestDrehen(t *testing.T) {
	// 3x2: Werte 0..5 im roten Kanal
	p := &Pixel{B: 3, H: 2, D: make([]uint16, 18)}
	for i := 0; i < 6; i++ {
		p.D[i*3] = uint16(i)
	}
	n := drehe(p, 6) // 90 Grad im Uhrzeigersinn
	if n.B != 2 || n.H != 3 {
		t.Fatalf("Groesse %dx%d", n.B, n.H)
	}
	// oben links steht jetzt, was unten links war
	if n.D[0] != 3 || n.D[3] != 0 || n.D[(2*2+1)*3] != 2 {
		t.Fatalf("falsch gedreht: %v", n.D)
	}
	if drehe(p, 1) != p {
		t.Fatal("1 darf nichts aendern")
	}
}

func TestVerkleinern(t *testing.T) {
	p := &Pixel{B: 4, H: 2, D: make([]uint16, 24)}
	for i := range p.D {
		p.D[i] = 1000
	}
	n := Verkleinere(p, 2)
	if n.B != 2 || n.H != 1 || n.D[0] != 1000 {
		t.Fatalf("%+v", n)
	}
}

func TestArt(t *testing.T) {
	for name, art := range map[string]string{"a.CR2": "raw", "b.jpeg": "jpeg", "c.HEIC": "heic", "d.txt": "", "e.dng": "raw"} {
		if g := ArtVon(name); g != art {
			t.Errorf("%s: %q statt %q", name, g, art)
		}
	}
}

func TestBilderAblauf(t *testing.T) {
	d, s := testDienst(t)

	res := lade(t, s.URL, "foto.png", testPNG(600, 300))
	var erg struct {
		Bilder []*Bild  `json:"bilder"`
		Fehler []string `json:"fehler"`
	}
	_ = json.NewDecoder(res.Body).Decode(&erg)
	if res.StatusCode != 200 || len(erg.Bilder) != 1 {
		t.Fatalf("Hochladen: %d %+v", res.StatusCode, erg)
	}
	b := erg.Bilder[0]
	if b.Breite != 600 || b.Hoehe != 300 || b.Art != "png" {
		t.Fatalf("Bild: %+v", b)
	}

	// falsche Dateiart
	res = lade(t, s.URL, "notiz.txt", []byte("hallo"))
	if res.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("txt: %d", res.StatusCode)
	}

	// Kachel
	res, _ = http.Get(s.URL + "/api/bilder/" + b.ID + "/mini")
	cfg, err := jpeg.DecodeConfig(res.Body)
	if err != nil || cfg.Width != 480 {
		t.Fatalf("Kachel: %v %d", err, cfg.Width)
	}

	// Bildpunkte
	res, _ = http.Get(s.URL + "/api/bilder/" + b.ID + "/pixel?max=1024")
	daten, _ := io.ReadAll(res.Body) // der Client entpackt gzip selbst
	if len(daten) < 12 || string(daten[:4]) != "CPX1" {
		// Go entpackt nur, wenn es selbst gzip angefragt hat; hier von Hand
		gz, err := gzip.NewReader(bytes.NewReader(daten))
		if err != nil {
			t.Fatalf("pixel: %v", err)
		}
		daten, _ = io.ReadAll(gz)
	}
	if string(daten[:4]) != "CPX1" || binary.LittleEndian.Uint32(daten[4:]) != 600 || len(daten) != 12+600*300*6 {
		t.Fatalf("CPX: %q %d", daten[:4], len(daten))
	}

	// bewerten und Einstellungen
	rumpf := `{"bewertung":4,"markierung":1,"farbe":"rot","einstellungen":{"belichtung":0.5},"bearbeitet":true}`
	req, _ := http.NewRequest(http.MethodPatch, s.URL+"/api/bilder/"+b.ID, strings.NewReader(rumpf))
	res, _ = http.DefaultClient.Do(req)
	var neu Bild
	_ = json.NewDecoder(res.Body).Decode(&neu)
	if neu.Bewertung != 4 || neu.Farbe != "rot" || !neu.Bearbeitet || !strings.Contains(string(neu.Einstellungen), "0.5") {
		t.Fatalf("Aendern: %+v", neu)
	}
	req, _ = http.NewRequest(http.MethodPatch, s.URL+"/api/bilder/"+b.ID, strings.NewReader(`{"bewertung":9}`))
	if res, _ = http.DefaultClient.Do(req); res.StatusCode != 400 {
		t.Fatalf("Bewertung 9: %d", res.StatusCode)
	}

	// bearbeitete Kachel hochladen
	var j bytes.Buffer
	_ = jpeg.Encode(&j, image.NewRGBA(image.Rect(0, 0, 10, 10)), nil)
	req, _ = http.NewRequest(http.MethodPut, s.URL+"/api/bilder/"+b.ID+"/mini", bytes.NewReader(j.Bytes()))
	if res, _ = http.DefaultClient.Do(req); res.StatusCode != 200 {
		t.Fatalf("Kachel setzen: %d", res.StatusCode)
	}
	res, _ = http.Get(s.URL + "/api/bilder/" + b.ID + "/mini")
	if cfg, _ = jpeg.DecodeConfig(res.Body); cfg.Width != 10 {
		t.Fatalf("bearbeitete Kachel nicht geliefert: %d", cfg.Width)
	}
	req, _ = http.NewRequest(http.MethodPut, s.URL+"/api/bilder/"+b.ID+"/mini", strings.NewReader("kein bild"))
	if res, _ = http.DefaultClient.Do(req); res.StatusCode != 400 {
		t.Fatalf("Unsinn als Kachel: %d", res.StatusCode)
	}

	// Filter
	res, _ = http.Get(s.URL + "/api/bilder?bewertung=5")
	var liste []*Bild
	_ = json.NewDecoder(res.Body).Decode(&liste)
	if len(liste) != 0 {
		t.Fatalf("Filter: %d", len(liste))
	}

	// ungueltige Kennung
	if res, _ = http.Get(s.URL + "/api/bilder/..%2f..%2fetc/mini"); res.StatusCode != 404 {
		t.Fatal("Pfad durchgelassen")
	}

	// loeschen
	req, _ = http.NewRequest(http.MethodDelete, s.URL+"/api/bilder/"+b.ID, nil)
	if res, _ = http.DefaultClient.Do(req); res.StatusCode != 200 || d.ablage.AnzahlBilder() != 0 {
		t.Fatalf("Loeschen: %d", res.StatusCode)
	}
}

func TestLeinwand(t *testing.T) {
	_, s := testDienst(t)
	res, _ := http.Post(s.URL+"/api/leinwaende", "application/json", strings.NewReader(`{"name":"Collage","breite":1080,"hoehe":1350,"szene":"{}"}`))
	var l Leinwand
	_ = json.NewDecoder(res.Body).Decode(&l)
	if l.ID == "" || l.Breite != 1080 {
		t.Fatalf("Anlegen: %+v", l)
	}
	req, _ := http.NewRequest(http.MethodPut, s.URL+"/api/leinwaende/"+l.ID, strings.NewReader(`{"name":"Neu","breite":5,"hoehe":5}`))
	if res, _ = http.DefaultClient.Do(req); res.StatusCode != 400 {
		t.Fatalf("zu klein: %d", res.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodPut, s.URL+"/api/leinwaende/"+l.ID, strings.NewReader(`{"name":"Neu","breite":800,"hoehe":600,"szene":"{\"a\":1}"}`))
	if res, _ = http.DefaultClient.Do(req); res.StatusCode != 200 {
		t.Fatalf("Speichern: %d", res.StatusCode)
	}
	res, _ = http.Get(s.URL + "/api/leinwaende/" + l.ID)
	_ = json.NewDecoder(res.Body).Decode(&l)
	if l.Name != "Neu" || l.Szene != `{"a":1}` {
		t.Fatalf("Laden: %+v", l)
	}
}

func TestHerkunft(t *testing.T) {
	_, s := testDienst(t)
	req, _ := http.NewRequest(http.MethodDelete, s.URL+"/api/vorlagen/0123456789abcdef", nil)
	req.Header.Set("Origin", "http://boese.example")
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != http.StatusForbidden {
		t.Fatalf("fremde Herkunft: %d", res.StatusCode)
	}
	req, _ = http.NewRequest(http.MethodDelete, s.URL+"/api/vorlagen/0123456789abcdef", nil)
	req.Header.Set("Origin", s.URL)
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != http.StatusOK {
		t.Fatalf("eigene Herkunft: %d", res.StatusCode)
	}
}

func TestRiesenbild(t *testing.T) {
	// nur ein PNG-Kopf, der 30000 x 30000 Pixel behauptet
	ihdr := []byte("IHDR")
	ihdr = binary.BigEndian.AppendUint32(ihdr, 30000)
	ihdr = binary.BigEndian.AppendUint32(ihdr, 30000)
	ihdr = append(ihdr, 8, 0, 0, 0, 0)
	daten := []byte("\x89PNG\r\n\x1a\n")
	daten = binary.BigEndian.AppendUint32(daten, 13)
	daten = append(daten, ihdr...)
	daten = binary.BigEndian.AppendUint32(daten, crc32.ChecksumIEEE(ihdr))
	pfad := t.TempDir() + "/riese.png"
	if err := os.WriteFile(pfad, daten, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := leseBilddatei(pfad, 1); err == nil || !strings.Contains(err.Error(), "zu groß") {
		t.Fatalf("Riesenbild nicht abgewiesen: %v", err)
	}
}

func TestKennwort(t *testing.T) {
	_, s := testDienst(t)
	d2, _ := testDienst(t)
	d2.kennwort = "geheim"
	s2 := httptest.NewServer(d2.Wege(fstest.MapFS{"index.html": {Data: []byte("x")}}))
	defer s2.Close()
	if res, _ := http.Get(s2.URL + "/api/bilder"); res.StatusCode != 401 {
		t.Fatalf("ohne Anmeldung: %d", res.StatusCode)
	}
	req, _ := http.NewRequest(http.MethodGet, s2.URL+"/api/bilder", nil)
	req.Header.Set("X-Captr", "geheim")
	if res, _ := http.DefaultClient.Do(req); res.StatusCode != 200 {
		t.Fatalf("mit Kennwort: %d", res.StatusCode)
	}
	if res, _ := http.Get(s.URL + "/api/bilder"); res.StatusCode != 200 {
		t.Fatalf("offen: %d", res.StatusCode)
	}
	// Oberflaeche: unbekannter Weg liefert index.html
	if res, _ := http.Get(s.URL + "/entwickeln/abc"); res.StatusCode != 200 {
		t.Fatalf("SPA: %d", res.StatusCode)
	}
}
