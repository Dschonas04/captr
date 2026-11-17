# Captr

Fotos sammeln, entwickeln und zusammensetzen, im Browser, auf dem eigenen Server. Ähnlich wie Lightroom, nur ohne Abo und ohne Cloud.

- **Bibliothek**: RAW (CR2, CR3, NEF, ARW, DNG, RAF und mehr), JPEG, PNG, TIFF, WebP, HEIC; Sterne, Markierungen, Farbetiketten, Filter
- **Entwickeln**: zerstörungsfrei per WebGL2, Weißabgleich, Belichtung, Kurven und mehr
- **Leinwand**: Bilder zusammensetzen, Freistellen über rembg

Quellcode und Anleitung: [https://github.com/Dschonas04/captr](https://github.com/Dschonas04/captr)

## Start

```yaml
services:
  captr:
    image: dschohnas/captr:1
    ports: ["8320:8080"]
    environment:
      CAPTR_REMBG: http://rembg:7000
    volumes: [captr-daten:/daten]
  rembg:
    image: danielgatis/rembg:2.0.86
    command: ["s", "--host", "0.0.0.0", "--port", "7000", "--no-ui"]
    volumes: [rembg-modelle:/root/.u2net]
volumes:
  captr-daten:
  rembg-modelle:
```

Danach läuft Captr unter `http://<host>:8320`. Ohne rembg funktioniert alles außer dem Freistellen.

## Tags

`latest`, die genaue Version (`1.0.0`) sowie `1.0` und `1`. Jedes Image gibt es für `linux/amd64` und `linux/arm64`. Dieselben Images liegen auch unter `ghcr.io/dschonas04/captr`.

## Lizenz

Apache 2.0. Fremdbestandteile sind in der NOTICE im Repository aufgeführt.
