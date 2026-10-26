package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "image/gif"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

// Bildpunkte mit 16 Bit je Kanal, RGB hintereinander, sRGB-codiert. So
// kommen sie aus LibRaw und so bekommt sie die Oberflaeche.
type Pixel struct {
	B, H int
	D    []uint16
}

var rawEndungen = map[string]bool{
	".cr2": true, ".cr3": true, ".crw": true, ".nef": true, ".nrw": true, ".arw": true, ".srf": true,
	".sr2": true, ".dng": true, ".raf": true, ".orf": true, ".rw2": true, ".pef": true, ".srw": true,
	".x3f": true, ".3fr": true, ".iiq": true, ".mos": true, ".erf": true, ".kdc": true, ".mrw": true,
	".rwl": true,
}

var bildEndungen = map[string]string{
	".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".tif": "tiff", ".tiff": "tiff", ".webp": "webp",
	".heic": "heic", ".heif": "heic", ".avif": "heic", ".gif": "gif", ".bmp": "bmp",
}

// ArtVon ordnet eine Datei nach ihrer Endung ein; leer heisst: kann Captr nicht.
func ArtVon(name string) string {
	e := strings.ToLower(filepath.Ext(name))
	if rawEndungen[e] {
		return "raw"
	}
	return bildEndungen[e]
}

// ---------- Entwickeln ----------

// Werkstatt begrenzt, wie viele Bilder gleichzeitig entwickelt werden; ein
// RAW braucht einen Kern und ein paar hundert MB.
type Werkstatt struct {
	ablage  *Ablage
	plaetze chan struct{}
}

func NeueWerkstatt(a *Ablage, n int) *Werkstatt {
	return &Werkstatt{ablage: a, plaetze: make(chan struct{}, n)}
}

func (w *Werkstatt) belege(ctx context.Context) (func(), error) {
	select {
	case w.plaetze <- struct{}{}:
		return func() { <-w.plaetze }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Entwickle liest eine Datei in 16-Bit-Bildpunkte, richtig herum gedreht.
// halb liefert RAWs in halber Groesse, das reicht fuer Vorschauen und geht
// doppelt so schnell.
func Entwickle(ctx context.Context, pfad, art string, halb bool, ausrichtung int) (*Pixel, error) {
	switch art {
	case "raw":
		return entwickleRAW(ctx, pfad, halb)
	case "heic":
		tmp, err := os.CreateTemp("", "captr-*.png")
		if err != nil {
			return nil, err
		}
		tmp.Close()
		defer os.Remove(tmp.Name())
		ausgabe, err := exec.CommandContext(ctx, "heif-dec", pfad, tmp.Name()).CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("HEIC: %v %s", err, kurz(string(ausgabe)))
		}
		// heif-dec dreht schon richtig herum.
		return leseBilddatei(tmp.Name(), 1)
	default:
		return leseBilddatei(pfad, ausrichtung)
	}
}

func entwickleRAW(ctx context.Context, pfad string, halb bool) (*Pixel, error) {
	// -w Kamera-Weissabgleich, -o 1 sRGB, -6 16 Bit, -g sRGB-Kurve,
	// -H 2 ausgefressene Lichter mischen statt hart abschneiden, -q 3 AHD.
	args := []string{"-w", "-o", "1", "-6", "-g", "2.4", "12.92", "-H", "2", "-q", "3", "-Z", "-", pfad}
	if halb {
		args = append([]string{"-h"}, args...)
	}
	cmd := exec.CommandContext(ctx, "dcraw_emu", args...)
	var fehler bytes.Buffer
	cmd.Stderr = &fehler
	aus, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("dcraw_emu: %w", err)
	}
	p, leseFehler := lesePPM(bufio.NewReaderSize(aus, 1<<20))
	_, _ = io.Copy(io.Discard, aus)
	if err := cmd.Wait(); err != nil {
		return nil, fmt.Errorf("RAW nicht lesbar: %s", kurz(fehler.String()))
	}
	if leseFehler != nil {
		return nil, fmt.Errorf("RAW: %w", leseFehler)
	}
	return p, nil
}

// lesePPM liest ein binaeres PPM (P6) mit 8 oder 16 Bit.
func lesePPM(r *bufio.Reader) (*Pixel, error) {
	feld := func() (string, error) {
		var b strings.Builder
		for {
			c, err := r.ReadByte()
			if err != nil {
				return "", err
			}
			if c == '#' {
				if _, err := r.ReadString('\n'); err != nil {
					return "", err
				}
				continue
			}
			if c == ' ' || c == '\n' || c == '\r' || c == '\t' {
				if b.Len() > 0 {
					return b.String(), nil
				}
				continue
			}
			b.WriteByte(c)
		}
	}
	magie, err := feld()
	if err != nil || magie != "P6" {
		return nil, fmt.Errorf("kein PPM (%q)", magie)
	}
	var zahlen [3]int
	for i := range zahlen {
		f, err := feld()
		if err != nil {
			return nil, err
		}
		if zahlen[i], err = strconv.Atoi(f); err != nil {
			return nil, err
		}
	}
	b, h, maxwert := zahlen[0], zahlen[1], zahlen[2]
	if b <= 0 || h <= 0 || b*h > 200_000_000 || maxwert <= 0 || maxwert > 65535 {
		return nil, fmt.Errorf("unplausibles PPM %dx%d/%d", b, h, maxwert)
	}
	p := &Pixel{B: b, H: h, D: make([]uint16, b*h*3)}
	if maxwert < 256 {
		roh := make([]byte, len(p.D))
		if _, err := io.ReadFull(r, roh); err != nil {
			return nil, err
		}
		for i, v := range roh {
			p.D[i] = uint16(v) * 257
		}
		return p, nil
	}
	roh := make([]byte, len(p.D)*2)
	if _, err := io.ReadFull(r, roh); err != nil {
		return nil, err
	}
	skala := 65535.0 / float64(maxwert)
	for i := range p.D {
		v := binary.BigEndian.Uint16(roh[2*i:])
		if maxwert != 65535 {
			v = uint16(float64(v)*skala + 0.5)
		}
		p.D[i] = v
	}
	return p, nil
}

func leseBilddatei(pfad string, ausrichtung int) (*Pixel, error) {
	f, err := os.Open(pfad)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	img, _, err := image.Decode(bufio.NewReaderSize(f, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("Bild nicht lesbar: %w", err)
	}
	return drehe(ausBild(img), ausrichtung), nil
}

// ausBild bringt ein Go-Bild in 16-Bit-RGB. Halbtransparentes wird auf Weiss
// gesetzt, wie es ein Fotoprogramm ohne Ebenen zeigen wuerde.
func ausBild(img image.Image) *Pixel {
	r := img.Bounds()
	p := &Pixel{B: r.Dx(), H: r.Dy(), D: make([]uint16, r.Dx()*r.Dy()*3)}
	i := 0
	switch q := img.(type) {
	case *image.YCbCr:
		for y := r.Min.Y; y < r.Max.Y; y++ {
			for x := r.Min.X; x < r.Max.X; x++ {
				yy := q.YOffset(x, y)
				cc := q.COffset(x, y)
				rr, gg, bb := color.YCbCrToRGB(q.Y[yy], q.Cb[cc], q.Cr[cc])
				p.D[i], p.D[i+1], p.D[i+2] = uint16(rr)*257, uint16(gg)*257, uint16(bb)*257
				i += 3
			}
		}
	default:
		for y := r.Min.Y; y < r.Max.Y; y++ {
			for x := r.Min.X; x < r.Max.X; x++ {
				rr, gg, bb, aa := img.At(x, y).RGBA()
				if aa < 0xffff {
					// vormultipliziert: auf Weiss legen
					weiss := 0xffff - aa
					rr, gg, bb = rr+weiss, gg+weiss, bb+weiss
				}
				p.D[i], p.D[i+1], p.D[i+2] = uint16(rr), uint16(gg), uint16(bb)
				i += 3
			}
		}
	}
	return p
}

// drehe wendet die EXIF-Ausrichtung an (1 bis 8).
func drehe(p *Pixel, ausrichtung int) *Pixel {
	if ausrichtung < 2 || ausrichtung > 8 {
		return p
	}
	quer := ausrichtung >= 5 // 5 bis 8 tauschen Breite und Hoehe
	nb, nh := p.B, p.H
	if quer {
		nb, nh = p.H, p.B
	}
	n := &Pixel{B: nb, H: nh, D: make([]uint16, len(p.D))}
	for y := 0; y < p.H; y++ {
		for x := 0; x < p.B; x++ {
			var zx, zy int
			switch ausrichtung {
			case 2:
				zx, zy = p.B-1-x, y
			case 3:
				zx, zy = p.B-1-x, p.H-1-y
			case 4:
				zx, zy = x, p.H-1-y
			case 5:
				zx, zy = y, x
			case 6:
				zx, zy = p.H-1-y, x
			case 7:
				zx, zy = p.H-1-y, p.B-1-x
			case 8:
				zx, zy = y, p.B-1-x
			}
			q := (y*p.B + x) * 3
			z := (zy*nb + zx) * 3
			copy(n.D[z:z+3], p.D[q:q+3])
		}
	}
	return n
}

// Verkleinere mittelt Flaechen, bis die laengere Seite hoechstens max ist.
func Verkleinere(p *Pixel, max int) *Pixel {
	if max <= 0 || (p.B <= max && p.H <= max) {
		return p
	}
	f := float64(max) / float64(p.B)
	if p.H > p.B {
		f = float64(max) / float64(p.H)
	}
	nb, nh := int(float64(p.B)*f+0.5), int(float64(p.H)*f+0.5)
	if nb < 1 {
		nb = 1
	}
	if nh < 1 {
		nh = 1
	}
	n := &Pixel{B: nb, H: nh, D: make([]uint16, nb*nh*3)}
	for y := 0; y < nh; y++ {
		y0, y1 := y*p.H/nh, (y+1)*p.H/nh
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for x := 0; x < nb; x++ {
			x0, x1 := x*p.B/nb, (x+1)*p.B/nb
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var s [3]uint64
			for yy := y0; yy < y1; yy++ {
				q := (yy*p.B + x0) * 3
				for xx := x0; xx < x1; xx++ {
					s[0] += uint64(p.D[q])
					s[1] += uint64(p.D[q+1])
					s[2] += uint64(p.D[q+2])
					q += 3
				}
			}
			anz := uint64((y1 - y0) * (x1 - x0))
			z := (y*nb + x) * 3
			n.D[z], n.D[z+1], n.D[z+2] = uint16(s[0]/anz), uint16(s[1]/anz), uint16(s[2]/anz)
		}
	}
	return n
}

func (p *Pixel) Bild8() *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, p.B, p.H))
	for i, j := 0, 0; i < len(p.D); i, j = i+3, j+4 {
		img.Pix[j], img.Pix[j+1], img.Pix[j+2], img.Pix[j+3] = byte(p.D[i]>>8), byte(p.D[i+1]>>8), byte(p.D[i+2]>>8), 255
	}
	return img
}

func schreibeJPEG(pfad string, p *Pixel, qualitaet int) error {
	tmp := pfad + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if err := jpeg.Encode(f, p.Bild8(), &jpeg.Options{Quality: qualitaet}); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, pfad)
}

// Das Format, in dem die Oberflaeche Bildpunkte bekommt: "CPX1", Breite und
// Hoehe als uint32, dann RGB als uint16, alles little-endian, gzip-komprimiert.
func schreibeCPX(pfad string, p *Pixel) error {
	tmp := pfad + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	gz, _ := gzip.NewWriterLevel(f, gzip.BestSpeed)
	w := bufio.NewWriterSize(gz, 1<<20)
	kopf := make([]byte, 12)
	copy(kopf, "CPX1")
	binary.LittleEndian.PutUint32(kopf[4:], uint32(p.B))
	binary.LittleEndian.PutUint32(kopf[8:], uint32(p.H))
	_, _ = w.Write(kopf)
	puffer := make([]byte, 2)
	for _, v := range p.D {
		binary.LittleEndian.PutUint16(puffer, v)
		_, _ = w.Write(puffer)
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := gz.Close(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, pfad)
}

// ---------- Aufnahmedaten ----------

type exifDaten struct {
	Make             string  `json:"Make"`
	Model            string  `json:"Model"`
	LensModel        any     `json:"LensModel"`
	Lens             any     `json:"Lens"`
	ISO              float64 `json:"ISO"`
	FNumber          float64 `json:"FNumber"`
	ExposureTime     float64 `json:"ExposureTime"`
	FocalLength      float64 `json:"FocalLength"`
	DateTimeOriginal any     `json:"DateTimeOriginal"`
	CreateDate       any     `json:"CreateDate"`
	Orientation      int     `json:"Orientation"`
}

// LiesAufnahme fuellt Kamera, Objektiv und Belichtung aus den EXIF-Daten und
// gibt die Ausrichtung zurueck. Fehlt exiftool oder scheitert es, bleibt das
// Bild trotzdem benutzbar.
func LiesAufnahme(ctx context.Context, pfad string, b *Bild) int {
	ctx, abbruch := context.WithTimeout(ctx, 20*time.Second)
	defer abbruch()
	aus, err := exec.CommandContext(ctx, "exiftool", "-j", "-n", "-Make", "-Model", "-LensModel", "-Lens",
		"-ISO", "-FNumber", "-ExposureTime", "-FocalLength", "-DateTimeOriginal", "-CreateDate", "-Orientation",
		pfad).Output()
	if err != nil {
		return 1
	}
	var liste []exifDaten
	if json.Unmarshal(aus, &liste) != nil || len(liste) == 0 {
		return 1
	}
	e := liste[0]
	kamera := strings.TrimSpace(e.Model)
	if marke := strings.Fields(e.Make); len(marke) > 0 && !strings.HasPrefix(strings.ToLower(kamera), strings.ToLower(marke[0])) {
		kamera = strings.TrimSpace(marke[0] + " " + kamera)
	}
	b.Kamera = kuerze(kamera, 80)
	b.Objektiv = kuerze(textVon(e.LensModel, e.Lens), 120)
	b.ISO = int(e.ISO)
	b.Blende = e.FNumber
	b.Belichtungszeit = e.ExposureTime
	b.Brennweite = e.FocalLength
	b.Aufgenommen = exifZeit(textVon(e.DateTimeOriginal, e.CreateDate))
	if e.Orientation == 0 {
		return 1
	}
	return e.Orientation
}

func textVon(werte ...any) string {
	for _, w := range werte {
		switch v := w.(type) {
		case string:
			if s := strings.TrimSpace(v); s != "" && s != "----" {
				return s
			}
		case float64:
			return strconv.FormatFloat(v, 'f', -1, 64)
		}
	}
	return ""
}

// exifZeit macht aus "2016:12:30 13:13:11" ein "2016-12-30T13:13:11".
func exifZeit(s string) string {
	if len(s) < 19 {
		return ""
	}
	t, err := time.Parse("2006:01:02 15:04:05", s[:19])
	if err != nil || t.Year() < 1900 {
		return ""
	}
	return t.Format("2006-01-02T15:04:05")
}

func kuerze(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func kurz(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return kuerze(s, 200)
}

// ---------- Einlesen ----------

// NimmAuf legt eine hochgeladene Datei ab, liest ihre Aufnahmedaten und baut
// Kachel und Vorschau. Kann Captr das Bild nicht lesen, bleibt nichts zurueck.
func (w *Werkstatt) NimmAuf(ctx context.Context, name string, r io.Reader, maxBytes int64) (*Bild, error) {
	art := ArtVon(name)
	if art == "" {
		return nil, fmt.Errorf("%s: Dateiart wird nicht unterstützt", name)
	}
	b := &Bild{ID: neueID(), Name: kuerze(strings.TrimSpace(filepath.Base(name)), 200), Art: art}
	b.Datei = b.ID + strings.ToLower(filepath.Ext(name))
	ziel := w.ablage.Pfad("originale", b.Datei)
	f, err := os.Create(ziel)
	if err != nil {
		return nil, err
	}
	n, err := io.Copy(f, io.LimitReader(r, maxBytes+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	aufraeumen := func() {
		_ = os.Remove(ziel)
		treffer, _ := filepath.Glob(w.ablage.Pfad("mini", b.ID+"*"))
		for _, t := range treffer {
			_ = os.Remove(t)
		}
	}
	if err != nil {
		aufraeumen()
		return nil, err
	}
	if n > maxBytes {
		aufraeumen()
		return nil, fmt.Errorf("%s: größer als %d MB", name, maxBytes>>20)
	}
	b.Bytes = n

	frei, err := w.belege(ctx)
	if err != nil {
		aufraeumen()
		return nil, err
	}
	defer frei()
	ausrichtung := LiesAufnahme(ctx, ziel, b)
	p, err := Entwickle(ctx, ziel, art, art == "raw", ausrichtung)
	if err != nil {
		aufraeumen()
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	b.Breite, b.Hoehe = p.B, p.H
	if art == "raw" {
		// halb entwickelt: die volle Groesse ist doppelt so gross
		b.Breite, b.Hoehe = p.B*2, p.H*2
	}
	if err := w.bauVorschauen(b.ID, p); err != nil {
		aufraeumen()
		return nil, err
	}
	if err := w.ablage.LegeBildAn(b); err != nil {
		aufraeumen()
		return nil, err
	}
	return b, nil
}

func (w *Werkstatt) bauVorschauen(id string, p *Pixel) error {
	v := Verkleinere(p, 2048)
	if err := schreibeJPEG(w.ablage.Pfad("mini", id+"-v.jpg"), v, 88); err != nil {
		return err
	}
	return schreibeJPEG(w.ablage.Pfad("mini", id+".jpg"), Verkleinere(v, 480), 82)
}

// PixelDatei liefert den Pfad der zwischengespeicherten Bildpunkte in der
// gewuenschten Groesse und legt sie bei Bedarf an. max 0 heisst volle Groesse.
func (w *Werkstatt) PixelDatei(ctx context.Context, b *Bild, max int) (string, error) {
	pfad := w.ablage.Pfad("pixel", fmt.Sprintf("%s-%d.cpx.gz", b.ID, max))
	if _, err := os.Stat(pfad); err == nil {
		return pfad, nil
	}
	frei, err := w.belege(ctx)
	if err != nil {
		return "", err
	}
	defer frei()
	if _, err := os.Stat(pfad); err == nil { // inzwischen von jemand anderem gebaut
		return pfad, nil
	}
	ausrichtung := 1
	if b.Art != "raw" && b.Art != "heic" {
		ausrichtung = LiesAufnahme(ctx, w.ablage.Pfad("originale", b.Datei), &Bild{})
	}
	p, err := Entwickle(ctx, w.ablage.Pfad("originale", b.Datei), b.Art, false, ausrichtung)
	if err != nil {
		return "", err
	}
	if b.Art == "raw" && (p.B != b.Breite || p.H != b.Hoehe) {
		_ = w.ablage.SetzeGroesse(b.ID, p.B, p.H)
	}
	if err := schreibeCPX(pfad, Verkleinere(p, max)); err != nil {
		return "", err
	}
	return pfad, nil
}

func (a *Ablage) SetzeGroesse(id string, b, h int) error {
	_, err := a.db.Exec(`UPDATE bilder SET breite = ?, hoehe = ? WHERE id = ?`, b, h, id)
	return err
}
