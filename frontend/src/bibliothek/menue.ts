// Rechtsklick auf Fotos: Bewertung, Markierung, Farbe, Entwicklung und
// Vorgaben für alle gewählten Fotos auf einmal.

import { api, type Bild, type Vorlage } from "../api";
import { standard, vervollstaendige, type Einstellungen } from "../entwickeln/einstellungen";
import { EINGEBAUT, ablage, aufAlle, kopiere, mitAutomatik, mitVorgabe, type Aenderung } from "../entwickeln/stapel";
import type { MenuePunkt } from "../lr";
import { FARBEN, frage, melde } from "../ui";
import { useBibliothek } from "./speicher";

let eigeneVorgaben: Vorlage[] = [];
export const ladeVorgaben = () =>
  api.vorlagen().then(
    (v) => (eigeneVorgaben = v),
    () => eigeneVorgaben,
  );
void ladeVorgaben();

export interface MenueOptionen {
  // Das gerade in Entwickeln offene Foto ändert die Seite selbst, damit Regler,
  // Protokoll und Vorschau mitkommen.
  offen?: { id: string; aendern: (f: (e: Einstellungen) => Einstellungen, was: string, auto?: boolean) => void };
  lupe?: () => void;
}

export function fotoMenue(ids: string[], aktiv: Bild, o: MenueOptionen = {}): MenuePunkt[] {
  const { aendere, entferne } = useBibliothek.getState();
  const mehrere = ids.length > 1;
  const anwenden = (f: Aenderung, was: string, auto = false) => {
    const rest = o.offen ? ids.filter((id) => id !== o.offen!.id) : ids;
    if (o.offen && ids.includes(o.offen.id)) o.offen.aendern((e) => f(e, null as never), was, auto);
    void aufAlle(rest, f, was);
  };
  const vorgabe = (name: string, e: Partial<Einstellungen>): MenuePunkt => ({ text: name, onKlick: () => anwenden((alt) => mitVorgabe(alt, e), name) });

  return [
    ...(mehrere ? [{ kopf: true, text: `${ids.length} Fotos gewählt` }] : []),
    { text: "In Entwickeln öffnen", tasten: "D", onKlick: () => (location.hash = `#/entwickeln/${aktiv.id}`) },
    ...(o.lupe ? [{ text: "In der Lupe zeigen", tasten: "E", onKlick: o.lupe }] : []),
    { trenner: true },
    {
      text: "Bewertung",
      unter: [0, 1, 2, 3, 4, 5].map((n) => ({
        text: n ? "★".repeat(n) : "Keine",
        tasten: String(n),
        an: !mehrere && aktiv.bewertung === n,
        onKlick: () => void aendere(ids, { bewertung: n }),
      })),
    },
    {
      text: "Markierung",
      unter: [
        { text: "Ausgewählt", tasten: "P", an: !mehrere && aktiv.markierung === 1, onKlick: () => void aendere(ids, { markierung: 1 }) },
        { text: "Abgelehnt", tasten: "X", an: !mehrere && aktiv.markierung === -1, onKlick: () => void aendere(ids, { markierung: -1 }) },
        { text: "Ohne", tasten: "U", an: !mehrere && aktiv.markierung === 0, onKlick: () => void aendere(ids, { markierung: 0 }) },
      ],
    },
    {
      text: "Farbe",
      unter: [
        { text: "Keine", an: !mehrere && !aktiv.farbe, onKlick: () => void aendere(ids, { farbe: "" }) },
        ...FARBEN.map((f, i) => ({ text: f.name, tasten: i < 4 ? String(6 + i) : undefined, an: !mehrere && aktiv.farbe === f.wert, onKlick: () => void aendere(ids, { farbe: f.wert }) })),
      ],
    },
    { trenner: true },
    {
      text: "Entwicklung",
      unter: [
        { text: mehrere ? `Automatisch (${ids.length} Fotos)` : "Automatisch", onKlick: () => anwenden((alt, en) => mitAutomatik(alt, en), "Automatisch", true) },
        {
          text: "Einstellungen kopieren",
          tasten: "Strg+Umschalt+C",
          onKlick: () => {
            kopiere(vervollstaendige(aktiv.einstellungen), aktiv.name);
            melde(`Einstellungen von ${aktiv.name} kopiert`);
          },
        },
        {
          text: ablage.e ? `Einstellungen einfügen${mehrere ? ` (${ids.length} Fotos)` : ""}` : "Einstellungen einfügen",
          tasten: "Strg+Umschalt+V",
          aus: !ablage.e,
          onKlick: () => ablage.e && anwenden((alt) => mitVorgabe(alt, ablage.e!), "Eingefügt"),
        },
        { trenner: true },
        {
          text: mehrere ? `Zurücksetzen (${ids.length} Fotos)` : "Zurücksetzen",
          onKlick: () =>
            frage({
              title: mehrere ? `${ids.length} Fotos zurücksetzen?` : "Foto zurücksetzen?",
              message: "Alle Einstellungen gehen auf den Ausgangszustand zurück, auch Zuschnitt und Drehung.",
              primaryActionText: "Zurücksetzen",
              onPrimaryAction: () => anwenden(() => standard(), "Zurückgesetzt"),
            }),
        },
      ],
    },
    {
      text: "Vorgabe anwenden",
      unter: [
        ...(eigeneVorgaben.length ? [{ kopf: true, text: "Eigene" }, ...eigeneVorgaben.map((v) => vorgabe(v.name, v.einstellungen))] : []),
        { kopf: true, text: "Captr" },
        ...EINGEBAUT.map((v) => vorgabe(v.name, v.e)),
      ],
    },
    { trenner: true },
    ...(!mehrere ? [{ text: "Original herunterladen", onKlick: () => (location.href = `/api/bilder/${aktiv.id}/original`) }] : []),
    {
      text: mehrere ? `${ids.length} Fotos löschen …` : "Löschen …",
      tasten: "Entf",
      gefahr: true,
      onKlick: () =>
        frage({
          title: mehrere ? `${ids.length} Fotos löschen?` : "Foto löschen?",
          message: "Original, Einstellungen und Vorschauen werden entfernt.",
          primaryActionText: "Löschen",
          onPrimaryAction: async () => {
            for (const id of ids) {
              try {
                await api.loeschen(id);
                entferne(id);
              } catch (e) {
                melde((e as Error).message, "fehler");
              }
            }
          },
        }),
    },
  ];
}
