# Captr

Fotos sammeln, entwickeln und zusammensetzen – im Browser, auf dem eigenen
Server. Ähnlich wie Lightroom, nur ohne Abo und ohne Cloud.

- **Bibliothek** – RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 und viele mehr),
  JPEG, PNG, TIFF, WebP und HEIC hineinziehen. Sterne, Markierungen,
  Farbetiketten, Filter, Aufnahmedaten.
- **Entwickeln** – zerstörungsfrei: Weißabgleich, Belichtung, Kontrast,
  Lichter, Tiefen, Weiß, Schwarz, Klarheit, Dunst, Dynamik, Sättigung,
  Gradationskurven (RGB und je Kanal), Farbton/Sättigung/Luminanz für acht
  Farbbereiche, Schärfen, Vignette, Körnung, Zuschneiden mit
  Seitenverhältnis, Drehen, Spiegeln. Histogramm, Vorher/Nachher, 1:1-Lupe,
  Rückgängig, Vorlagen, Einstellungen übertragen, Export als JPEG, PNG oder
  WebP in voller Auflösung.
- **Leinwand** – Fotos zu Collagen zusammensetzen, Hintergrund per Klick
  entfernen, Formen und Pinselstriche darüberlegen, als PNG oder JPEG
  exportieren. Die Leinwand stammt aus [ArtCraft](https://github.com/storytold/artcraft).

## Wie es funktioniert

Der Dienst (Go) nimmt die Dateien an, liest die Aufnahmedaten mit ExifTool,
entwickelt RAWs mit LibRaw und liefert die Bildpunkte mit 16 Bit je Kanal an
den Browser. Dort läuft die ganze Entwicklung als WebGL2-Shader auf der
Grafikkarte: jeder Regler ist nur ein Parameter, das Bild reagiert ohne
Verzögerung. Gespeichert werden nur die Einstellungen; das Original bleibt
unberührt. Das Freistellen übernimmt [rembg](https://github.com/danielgatis/rembg)
im Nachbarcontainer – nichts verlässt das eigene Netz.

```
frontend/   React, TypeScript, Vite, Tailwind; Leinwand mit Konva
backend/    Go, SQLite; die gebaute Oberfläche ist eingebettet
```

## Starten

```sh
docker compose up -d --build
```

Captr läuft dann auf Port 8320. Die Daten liegen im Volume `captr-daten`.

| Variable | Bedeutung | Vorgabe |
|---|---|---|
| `CAPTR_KENNWORT` | Kennwort für den Zugang; leer heißt offen | leer |
| `CAPTR_REMBG` | Adresse des rembg-Dienstes; leer schaltet Freistellen ab | `http://rembg:7000` |
| `CAPTR_REMBG_MODELL` | rembg-Modell | `isnet-general-use` |
| `CAPTR_DATEN` | Datenordner | `/daten` |

Der Browser braucht WebGL2 mit `EXT_color_buffer_float` – das können alle
aktuellen Desktop-Browser.

## Entwickeln

```sh
cd backend && go run .                # Dienst auf :8080 (braucht dcraw_emu und exiftool)
cd frontend && npm ci && npx vite     # Oberfläche mit Proxy auf :8080
```

Tests: `go test ./...` in `backend/`, `npx tsc --noEmit` in `frontend/`.

## Tasten

| Bibliothek | | Entwickeln | |
|---|---|---|---|
| 0–5 | Sterne | \ | Vorher/Nachher |
| P / X / U | auswählen / ablehnen / aufheben | R | Zuschneiden |
| 6–9 | Farbetikett | Z, Leertaste | 1:1-Lupe |
| Enter, D | Entwickeln | ← / → | voriges / nächstes Foto |
| Entf | Löschen | Strg+Z | Rückgängig |
| Strg+A | alle wählen | Strg+Umschalt+C / V | Einstellungen kopieren / einfügen |

## Lizenz

Apache 2.0, siehe [LICENSE](LICENSE). Die Leinwand-Dateien aus ArtCraft und
die übrigen Fremdbestandteile sind in [NOTICE](NOTICE) aufgeführt.
