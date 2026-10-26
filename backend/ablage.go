package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// Die Ablage: Metadaten in SQLite, Dateien daneben im Datenordner.
//
//	originale/  die hochgeladenen Dateien, unveraendert
//	mini/       Kacheln (480 px) und Vorschauen (2048 px) als JPEG
//	pixel/      zwischengespeicherte 16-Bit-Bildpunkte fuer die Entwicklung
//	freisteller/ freigestellte Bilder als PNG
//	leinwand/   Vorschauen der Leinwaende
type Ablage struct {
	db     *sql.DB
	ordner string
}

var ErrNichtGefunden = errors.New("nicht gefunden")

const schema = `
CREATE TABLE IF NOT EXISTS bilder (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    datei           TEXT NOT NULL,
    art             TEXT NOT NULL,
    bytes           INTEGER NOT NULL DEFAULT 0,
    breite          INTEGER NOT NULL DEFAULT 0,
    hoehe           INTEGER NOT NULL DEFAULT 0,
    aufgenommen     TEXT NOT NULL DEFAULT '',
    kamera          TEXT NOT NULL DEFAULT '',
    objektiv        TEXT NOT NULL DEFAULT '',
    iso             INTEGER NOT NULL DEFAULT 0,
    blende          REAL NOT NULL DEFAULT 0,
    belichtungszeit REAL NOT NULL DEFAULT 0,
    brennweite      REAL NOT NULL DEFAULT 0,
    bewertung       INTEGER NOT NULL DEFAULT 0,
    markierung      INTEGER NOT NULL DEFAULT 0,
    farbe           TEXT NOT NULL DEFAULT '',
    einstellungen   TEXT NOT NULL DEFAULT '{}',
    bearbeitet      INTEGER NOT NULL DEFAULT 0,
    angelegt        TEXT NOT NULL,
    geaendert       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bilder_angelegt ON bilder (angelegt);

CREATE TABLE IF NOT EXISTS leinwaende (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    breite    INTEGER NOT NULL,
    hoehe     INTEGER NOT NULL,
    szene     TEXT NOT NULL DEFAULT '',
    angelegt  TEXT NOT NULL,
    geaendert TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vorlagen (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    einstellungen TEXT NOT NULL,
    angelegt      TEXT NOT NULL
);
`

func OeffneAblage(ordner string) (*Ablage, error) {
	for _, u := range []string{"originale", "mini", "pixel", "freisteller", "leinwand"} {
		if err := os.MkdirAll(filepath.Join(ordner, u), 0o750); err != nil {
			return nil, err
		}
	}
	db, err := sql.Open("sqlite", "file:"+filepath.Join(ordner, "captr.db")+
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("Schema: %w", err)
	}
	return &Ablage{db: db, ordner: ordner}, nil
}

func (a *Ablage) Pfad(teile ...string) string {
	return filepath.Join(append([]string{a.ordner}, teile...)...)
}

func neueID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// gueltigeID schuetzt die Dateipfade, die aus Kennungen gebaut werden.
func gueltigeID(id string) bool {
	if len(id) != 16 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}

func jetzt() string { return time.Now().UTC().Format(time.RFC3339) }

// ---------- Bilder ----------

type Bild struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Datei           string          `json:"-"`
	Art             string          `json:"art"`
	Bytes           int64           `json:"bytes"`
	Breite          int             `json:"breite"`
	Hoehe           int             `json:"hoehe"`
	Aufgenommen     string          `json:"aufgenommen"`
	Kamera          string          `json:"kamera"`
	Objektiv        string          `json:"objektiv"`
	ISO             int             `json:"iso"`
	Blende          float64         `json:"blende"`
	Belichtungszeit float64         `json:"belichtungszeit"`
	Brennweite      float64         `json:"brennweite"`
	Bewertung       int             `json:"bewertung"`
	Markierung      int             `json:"markierung"` // -1 abgelehnt, 0 ohne, 1 ausgewaehlt
	Farbe           string          `json:"farbe"`
	Einstellungen   json.RawMessage `json:"einstellungen"`
	Bearbeitet      bool            `json:"bearbeitet"`
	Angelegt        string          `json:"angelegt"`
	Geaendert       string          `json:"geaendert"`
}

const bildSpalten = `id, name, datei, art, bytes, breite, hoehe, aufgenommen, kamera, objektiv, iso, blende,
	belichtungszeit, brennweite, bewertung, markierung, farbe, einstellungen, bearbeitet, angelegt, geaendert`

func leseBild(s interface{ Scan(...any) error }) (*Bild, error) {
	var b Bild
	var einst string
	err := s.Scan(&b.ID, &b.Name, &b.Datei, &b.Art, &b.Bytes, &b.Breite, &b.Hoehe, &b.Aufgenommen, &b.Kamera,
		&b.Objektiv, &b.ISO, &b.Blende, &b.Belichtungszeit, &b.Brennweite, &b.Bewertung, &b.Markierung,
		&b.Farbe, &einst, &b.Bearbeitet, &b.Angelegt, &b.Geaendert)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNichtGefunden
	}
	if err != nil {
		return nil, err
	}
	b.Einstellungen = json.RawMessage(einst)
	return &b, nil
}

func (a *Ablage) LegeBildAn(b *Bild) error {
	b.Angelegt, b.Geaendert = jetzt(), jetzt()
	if len(b.Einstellungen) == 0 {
		b.Einstellungen = json.RawMessage("{}")
	}
	_, err := a.db.Exec(`INSERT INTO bilder (`+bildSpalten+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		b.ID, b.Name, b.Datei, b.Art, b.Bytes, b.Breite, b.Hoehe, b.Aufgenommen, b.Kamera, b.Objektiv, b.ISO,
		b.Blende, b.Belichtungszeit, b.Brennweite, b.Bewertung, b.Markierung, b.Farbe, string(b.Einstellungen),
		b.Bearbeitet, b.Angelegt, b.Geaendert)
	return err
}

func (a *Ablage) Bild(id string) (*Bild, error) {
	return leseBild(a.db.QueryRow(`SELECT `+bildSpalten+` FROM bilder WHERE id = ?`, id))
}

type BildFilter struct {
	Bewertung  int    // mindestens so viele Sterne
	Markierung string // "ausgewaehlt", "abgelehnt", "ohne-abgelehnte" oder leer
	Art        string // "raw" oder leer
	Farbe      string
	Suche      string
	Ordnung    string // "aufgenommen", "angelegt", "name", "bewertung"
}

func (a *Ablage) Bilder(f BildFilter) ([]*Bild, error) {
	bed := []string{"1=1"}
	args := []any{}
	if f.Bewertung > 0 {
		bed = append(bed, "bewertung >= ?")
		args = append(args, f.Bewertung)
	}
	switch f.Markierung {
	case "ausgewaehlt":
		bed = append(bed, "markierung = 1")
	case "abgelehnt":
		bed = append(bed, "markierung = -1")
	case "ohne-abgelehnte":
		bed = append(bed, "markierung >= 0")
	}
	if f.Art == "raw" {
		bed = append(bed, "art = 'raw'")
	}
	if f.Farbe != "" {
		bed = append(bed, "farbe = ?")
		args = append(args, f.Farbe)
	}
	if s := strings.TrimSpace(f.Suche); s != "" {
		bed = append(bed, "(name LIKE ? OR kamera LIKE ? OR objektiv LIKE ?)")
		muster := "%" + s + "%"
		args = append(args, muster, muster, muster)
	}
	ordnung := "CASE WHEN aufgenommen = '' THEN angelegt ELSE aufgenommen END DESC, name"
	switch f.Ordnung {
	case "angelegt":
		ordnung = "angelegt DESC, name"
	case "name":
		ordnung = "name COLLATE NOCASE, angelegt"
	case "bewertung":
		ordnung = "bewertung DESC, aufgenommen DESC"
	}
	zeilen, err := a.db.Query(`SELECT `+bildSpalten+` FROM bilder WHERE `+strings.Join(bed, " AND ")+
		` ORDER BY `+ordnung, args...)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	liste := []*Bild{}
	for zeilen.Next() {
		b, err := leseBild(zeilen)
		if err != nil {
			return nil, err
		}
		liste = append(liste, b)
	}
	return liste, zeilen.Err()
}

// Aenderung enthaelt nur, was gesetzt werden soll.
type Aenderung struct {
	Name          *string          `json:"name"`
	Bewertung     *int             `json:"bewertung"`
	Markierung    *int             `json:"markierung"`
	Farbe         *string          `json:"farbe"`
	Einstellungen *json.RawMessage `json:"einstellungen"`
	Bearbeitet    *bool            `json:"bearbeitet"`
}

var farben = map[string]bool{"": true, "rot": true, "gelb": true, "gruen": true, "blau": true, "lila": true}

func (a *Ablage) AendereBild(id string, ae Aenderung) (*Bild, error) {
	setze := []string{"geaendert = ?"}
	args := []any{jetzt()}
	if ae.Name != nil {
		n := strings.TrimSpace(*ae.Name)
		if n == "" || len(n) > 200 {
			return nil, errors.New("Name leer oder zu lang")
		}
		setze, args = append(setze, "name = ?"), append(args, n)
	}
	if ae.Bewertung != nil {
		if *ae.Bewertung < 0 || *ae.Bewertung > 5 {
			return nil, errors.New("Bewertung 0 bis 5")
		}
		setze, args = append(setze, "bewertung = ?"), append(args, *ae.Bewertung)
	}
	if ae.Markierung != nil {
		if *ae.Markierung < -1 || *ae.Markierung > 1 {
			return nil, errors.New("Markierung -1, 0 oder 1")
		}
		setze, args = append(setze, "markierung = ?"), append(args, *ae.Markierung)
	}
	if ae.Farbe != nil {
		if !farben[*ae.Farbe] {
			return nil, errors.New("unbekannte Farbe")
		}
		setze, args = append(setze, "farbe = ?"), append(args, *ae.Farbe)
	}
	if ae.Einstellungen != nil {
		var probe map[string]any
		if err := json.Unmarshal(*ae.Einstellungen, &probe); err != nil || len(*ae.Einstellungen) > 64<<10 {
			return nil, errors.New("Einstellungen unlesbar")
		}
		setze, args = append(setze, "einstellungen = ?"), append(args, string(*ae.Einstellungen))
	}
	if ae.Bearbeitet != nil {
		setze, args = append(setze, "bearbeitet = ?"), append(args, *ae.Bearbeitet)
	}
	res, err := a.db.Exec(`UPDATE bilder SET `+strings.Join(setze, ", ")+` WHERE id = ?`, append(args, id)...)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNichtGefunden
	}
	return a.Bild(id)
}

func (a *Ablage) LoescheBild(id string) error {
	b, err := a.Bild(id)
	if err != nil {
		return err
	}
	if _, err := a.db.Exec(`DELETE FROM bilder WHERE id = ?`, id); err != nil {
		return err
	}
	_ = os.Remove(a.Pfad("originale", b.Datei))
	for _, muster := range []string{"mini/" + id + "*", "pixel/" + id + "*"} {
		treffer, _ := filepath.Glob(a.Pfad(muster))
		for _, t := range treffer {
			_ = os.Remove(t)
		}
	}
	return nil
}

func (a *Ablage) AnzahlBilder() int {
	var n int
	_ = a.db.QueryRow(`SELECT count(*) FROM bilder`).Scan(&n)
	return n
}

// ---------- Leinwaende ----------

type Leinwand struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Breite    int    `json:"breite"`
	Hoehe     int    `json:"hoehe"`
	Szene     string `json:"szene,omitempty"`
	Angelegt  string `json:"angelegt"`
	Geaendert string `json:"geaendert"`
}

func (a *Ablage) Leinwaende() ([]*Leinwand, error) {
	zeilen, err := a.db.Query(`SELECT id, name, breite, hoehe, angelegt, geaendert FROM leinwaende ORDER BY geaendert DESC`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	liste := []*Leinwand{}
	for zeilen.Next() {
		var l Leinwand
		if err := zeilen.Scan(&l.ID, &l.Name, &l.Breite, &l.Hoehe, &l.Angelegt, &l.Geaendert); err != nil {
			return nil, err
		}
		liste = append(liste, &l)
	}
	return liste, zeilen.Err()
}

func (a *Ablage) Leinwand(id string) (*Leinwand, error) {
	var l Leinwand
	err := a.db.QueryRow(`SELECT id, name, breite, hoehe, szene, angelegt, geaendert FROM leinwaende WHERE id = ?`, id).
		Scan(&l.ID, &l.Name, &l.Breite, &l.Hoehe, &l.Szene, &l.Angelegt, &l.Geaendert)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNichtGefunden
	}
	return &l, err
}

func (a *Ablage) SpeichereLeinwand(l *Leinwand) error {
	l.Name = strings.TrimSpace(l.Name)
	if l.Name == "" {
		l.Name = "Leinwand"
	}
	if l.Breite < 16 || l.Hoehe < 16 || l.Breite > 12000 || l.Hoehe > 12000 {
		return errors.New("Größe zwischen 16 und 12000 Pixeln")
	}
	l.Geaendert = jetzt()
	if l.ID == "" {
		l.ID, l.Angelegt = neueID(), l.Geaendert
		_, err := a.db.Exec(`INSERT INTO leinwaende (id, name, breite, hoehe, szene, angelegt, geaendert) VALUES (?,?,?,?,?,?,?)`,
			l.ID, l.Name, l.Breite, l.Hoehe, l.Szene, l.Angelegt, l.Geaendert)
		return err
	}
	res, err := a.db.Exec(`UPDATE leinwaende SET name = ?, breite = ?, hoehe = ?, szene = ?, geaendert = ? WHERE id = ?`,
		l.Name, l.Breite, l.Hoehe, l.Szene, l.Geaendert, l.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNichtGefunden
	}
	return nil
}

func (a *Ablage) LoescheLeinwand(id string) error {
	res, err := a.db.Exec(`DELETE FROM leinwaende WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNichtGefunden
	}
	_ = os.Remove(a.Pfad("leinwand", id+".jpg"))
	return nil
}

// ---------- Vorlagen ----------

type Vorlage struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Einstellungen json.RawMessage `json:"einstellungen"`
	Angelegt      string          `json:"angelegt"`
}

func (a *Ablage) Vorlagen() ([]*Vorlage, error) {
	zeilen, err := a.db.Query(`SELECT id, name, einstellungen, angelegt FROM vorlagen ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer zeilen.Close()
	liste := []*Vorlage{}
	for zeilen.Next() {
		var v Vorlage
		var e string
		if err := zeilen.Scan(&v.ID, &v.Name, &e, &v.Angelegt); err != nil {
			return nil, err
		}
		v.Einstellungen = json.RawMessage(e)
		liste = append(liste, &v)
	}
	return liste, zeilen.Err()
}

func (a *Ablage) LegeVorlageAn(v *Vorlage) error {
	v.Name = strings.TrimSpace(v.Name)
	var probe map[string]any
	if v.Name == "" || json.Unmarshal(v.Einstellungen, &probe) != nil {
		return errors.New("Name und Einstellungen nötig")
	}
	v.ID, v.Angelegt = neueID(), jetzt()
	_, err := a.db.Exec(`INSERT INTO vorlagen (id, name, einstellungen, angelegt) VALUES (?,?,?,?)`,
		v.ID, v.Name, string(v.Einstellungen), v.Angelegt)
	return err
}

func (a *Ablage) LoescheVorlage(id string) error {
	_, err := a.db.Exec(`DELETE FROM vorlagen WHERE id = ?`, id)
	return err
}
