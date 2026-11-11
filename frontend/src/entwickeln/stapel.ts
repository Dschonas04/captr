// Einstellungen auf viele Fotos auf einmal anwenden: Vorgaben, eingefügte
// Einstellungen, Automatik, Zurücksetzen, Synchronisieren.
//
// Die Vorschaubilder entstehen wie beim Entwickeln im Browser. Dafür gibt es
// eine eigene, unsichtbare WebGL-Fläche, die jedes Foto kurz lädt, rendert und
// die Vorschauen hochlädt.

import { api, ladePixel, type Bild } from "../api";
import { useBibliothek } from "../bibliothek/speicher";
import { melde } from "../ui";
import { ausgabeGroesse, istStandard, ohneGeometrie, standard, vervollstaendige, type Einstellungen } from "./einstellungen";
import { Entwickler, automatisch, bildAlsBlob } from "./gpu";

export const EINGEBAUT: { name: string; e: Partial<Einstellungen> }[] = [
  { name: "Schwarzweiß", e: { saettigung: -100, dynamik: 0, kontrast: 18, klarheit: 12 } },
  { name: "Schwarzweiß hart", e: { saettigung: -100, kontrast: 45, klarheit: 30, schwarz: -15, weiss: 10, koernung: 18 } },
  { name: "Kräftig", e: { dynamik: 35, kontrast: 18, klarheit: 15, dunst: 8 } },
  { name: "Matt", e: { kontrast: -12, kurven: { rgb: [[0, 0.08], [0.5, 0.5], [1, 0.94]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }, saettigung: -10 } },
  { name: "Warm", e: { temperatur: 22, toenung: 6, dynamik: 10 } },
  { name: "Kühl", e: { temperatur: -20, toenung: -4 } },
  { name: "Film", e: { kontrast: 10, lichter: -25, tiefen: 20, saettigung: -12, koernung: 25, vignette: -18, kurven: { rgb: [[0, 0.05], [0.25, 0.22], [0.75, 0.8], [1, 0.96]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0.04], [1, 0.97]] } } },
];

// Zwischenablage für Einstellungen, geteilt von Bibliothek und Entwickeln
export const ablage: { e: Partial<Einstellungen> | null; von: string } = { e: null, von: "" };

export function kopiere(e: Einstellungen, name: string) {
  ablage.e = ohneGeometrie(e);
  ablage.von = name;
}

// Eine Vorgabe überschreibt nur, was sie selbst setzt; Zuschnitt und Drehung
// bleiben, wie sie sind.
export function mitVorgabe(alt: Einstellungen, teil: Partial<Einstellungen>): Einstellungen {
  const geo = { vierteldrehung: alt.vierteldrehung, spiegeln: alt.spiegeln, winkel: alt.winkel, zuschnitt: alt.zuschnitt, seitenverhaeltnis: alt.seitenverhaeltnis };
  const voll = vervollstaendige({ ...ohneGeometrie(standard()), ...ohneGeometrie(vervollstaendige(teil)), ...geo });
  const erg = { ...alt } as Record<string, unknown>;
  for (const k of Object.keys(ohneGeometrie(vervollstaendige(teil)))) {
    if (k in teil) erg[k] = (voll as unknown as Record<string, unknown>)[k];
  }
  return vervollstaendige(erg as Partial<Einstellungen>);
}

// Ton automatisch, Weißabgleich und Geometrie bleiben
export function mitAutomatik(alt: Einstellungen, en: Entwickler): Einstellungen {
  const basis = { ...standard(), vierteldrehung: alt.vierteldrehung, spiegeln: alt.spiegeln, winkel: alt.winkel, zuschnitt: alt.zuschnitt, temperatur: alt.temperatur, toenung: alt.toenung };
  return vervollstaendige({ ...alt, ...automatisch(en.histogramm({ ...basis, schaerfe: 0 })) });
}

export type Aenderung = (alt: Einstellungen, en: Entwickler) => Einstellungen;

let flaeche: Entwickler | null = null;
let laeuft = Promise.resolve();

async function vorschauenSchreiben(en: Entwickler, id: string, e: Einstellungen) {
  const [gb, gh] = ausgabeGroesse(en.breite, en.hoehe, e);
  for (const [art, max, q] of [
    ["vorschau", 2048, 0.88],
    ["mini", 480, 0.82],
  ] as const) {
    const f = Math.min(1, max / Math.max(gb, gh));
    const daten = en.rendere(e, Math.max(1, Math.round(gb * f)), Math.max(1, Math.round(gh * f)));
    await api.setzeVorschau(id, art, await bildAlsBlob(daten, "image/jpeg", q));
  }
}

// Wendet aendern auf alle Fotos an. Läuft nacheinander, damit der Rechner
// nicht mehrere große Bilder gleichzeitig im Speicher hält.
export function aufAlle(ids: string[], aendern: Aenderung, was: string): Promise<void> {
  const auftrag = laeuft.then(async () => {
    if (!ids.length) return;
    const st = useBibliothek.getState();
    let fertig = 0;
    const fehler: string[] = [];
    if (ids.length > 1) melde(`${was}: ${ids.length} Fotos werden bearbeitet …`);
    try {
      flaeche ??= new Entwickler(document.createElement("canvas"));
    } catch (e) {
      melde("WebGL nicht verfügbar: " + (e as Error).message, "fehler");
      return;
    }
    const en = flaeche;
    for (const id of ids) {
      const b: Bild | undefined = st.alle.find((x) => x.id === id) ?? st.bilder.find((x) => x.id === id);
      try {
        const bild = b ?? (await api.bild(id));
        const alt = vervollstaendige(bild.einstellungen);
        en.setzeBild(await ladePixel(id, 2560));
        const neu = aendern(alt, en);
        const bearbeitet = !istStandard(neu);
        if (bearbeitet) await vorschauenSchreiben(en, id, neu);
        const aktuell = await api.aendern(id, { einstellungen: neu, bearbeitet });
        useBibliothek.getState().ersetze({ ...aktuell, geaendert: new Date().toISOString() });
        fertig++;
      } catch (e) {
        fehler.push(`${b?.name ?? id}: ${(e as Error).message}`);
      }
    }
    if (fehler.length) melde(fehler.slice(0, 2).join(" · "), "fehler");
    else melde(fertig === 1 ? `${was}: 1 Foto bearbeitet` : `${was}: ${fertig} Fotos bearbeitet`);
  });
  laeuft = auftrag.catch(() => {});
  return auftrag;
}
