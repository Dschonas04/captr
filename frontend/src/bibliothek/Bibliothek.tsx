import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, Download, Flag, Grid3x3, ImagePlus, Maximize2, Search, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import {
  api,
  formatiereBelichtung,
  formatiereBytes,
  formatiereDatum,
  hochladen,
  miniUrl,
  vorschauUrl,
  type Bild,
  type Hochladefortschritt,
} from "../api";
import { FARBEN, Knopf, Laedt, Sterne, SymbolKnopf, cx, eingabe, farbeCss, frage, melde } from "../ui";
import { abweichungen, standard, vervollstaendige, type Einstellungen } from "../entwickeln/einstellungen";
import { Dreieck, Filmstreifen, HistogrammPanel, Navigator, Panel, Seitenleiste, exifTeile, useBildHistogramm, useLeistenTasten } from "../lr";
import { datumVon, letzterImport, sichtbar, tag, useBibliothek } from "./speicher";
import { fotoMenue, ladeVorgaben } from "./menue";
import { useMenue } from "../lr";
import { EINGEBAUT, ablage, aufAlle, kopiere, mitAutomatik, mitVorgabe } from "../entwickeln/stapel";

export const ANNEHMBAR =
  ".jpg,.jpeg,.png,.tif,.tiff,.webp,.heic,.heif,.avif,.gif,.bmp,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.pef,.srw,.x3f,.3fr,.iiq,.mos,.erf,.kdc,.mrw,.rwl";

// Hochladen ueber die ganze Seite: Dateien hineinziehen oder waehlen.
export function useHochladen() {
  const fuegeHinzu = useBibliothek((s) => s.fuegeHinzu);
  const [fortschritt, setFortschritt] = useState<Hochladefortschritt | null>(null);
  const laeuft = useRef(false);
  const lade = useCallback(
    async (dateien: File[]) => {
      if (!dateien.length || laeuft.current) return;
      laeuft.current = true;
      setFortschritt({ datei: dateien[0].name, nummer: 1, anzahl: dateien.length, anteil: 0 });
      const erg = await hochladen(dateien, setFortschritt);
      laeuft.current = false;
      setFortschritt(null);
      if (erg.bilder.length) {
        fuegeHinzu(erg.bilder);
        melde(erg.bilder.length === 1 ? "1 Foto importiert" : `${erg.bilder.length} Fotos importiert`);
      }
      if (erg.fehler.length) melde(erg.fehler.slice(0, 3).join(" · "), "fehler");
    },
    [fuegeHinzu],
  );
  const waehle = useCallback(() => {
    const i = document.createElement("input");
    i.type = "file";
    i.multiple = true;
    i.accept = ANNEHMBAR;
    i.onchange = () => i.files && void lade(Array.from(i.files));
    i.click();
  }, [lade]);
  return { fortschritt, lade, waehle };
}

export function Fortschrittsbalken({ f }: { f: Hochladefortschritt | null }) {
  if (!f) return null;
  const gesamt = (f.nummer - 1 + f.anteil) / f.anzahl;
  return (
    <div className="fixed inset-x-0 top-0 z-[100002]">
      <div className="h-[2px] bg-licht transition-[width] duration-200" style={{ width: `${Math.max(3, gesamt * 100)}%` }} />
      <div className="absolute right-3 top-2 rounded-md border border-linie bg-feld px-3 py-1.5 text-[12px] text-text-2 shadow-xl">
        {f.anteil >= 1 ? "Entwickle" : "Lade"} {f.nummer}/{f.anzahl} · <span className="text-text">{f.datei}</span>
      </div>
    </div>
  );
}

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

export function sammlungName(s: string): string {
  if (!s || s === "alle") return "Alle Fotos";
  if (s === "zuletzt") return "Letzter Import";
  if (s === "bearbeitet") return "Bearbeitet";
  if (s === "unbearbeitet") return "Unbearbeitet";
  const [art, wert] = [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)];
  if (art === "jahr") return wert;
  if (art === "monat") return `${MONATE[Number(wert.slice(5, 7)) - 1]} ${wert.slice(0, 4)}`;
  if (art === "kamera") return wert;
  return s;
}

function Markierung({ m, gross }: { m: number; gross?: boolean }) {
  const g = gross ? 14 : 12;
  if (m === 1) return <Flag size={g} className="text-text" fill="currentColor" aria-label="ausgewählt" />;
  if (m === -1) return <Ban size={g} className="text-gefahr" aria-label="abgelehnt" />;
  return null;
}

// ---------- Rasterzelle ----------

function Zelle({
  b,
  nummer,
  gewaehlt,
  haupt,
  groesse,
  onKlick,
  onDoppel,
  onKontext,
}: {
  b: Bild;
  nummer: number;
  gewaehlt: boolean;
  haupt: boolean;
  groesse: number;
  onKlick: (e: React.MouseEvent) => void;
  onDoppel: () => void;
  onKontext: (e: React.MouseEvent) => void;
}) {
  const farbe = farbeCss(b.farbe);
  const hoehe = Math.round(groesse * 1.08);
  return (
    <div
      role="gridcell"
      aria-selected={gewaehlt}
      data-id={b.id}
      onClick={onKlick}
      onDoubleClick={onDoppel}
      onContextMenu={onKontext}
      className={cx(
        "group relative flex cursor-default select-none flex-col overflow-hidden rounded-[3px] transition-colors",
        haupt ? "bg-[#4b4b4b]" : gewaehlt ? "bg-[#3c3c3c]" : "bg-[#2a2a2a] hover:bg-[#323232]",
      )}
      style={{ width: groesse, height: hoehe, boxShadow: farbe ? `inset 0 0 0 2px ${farbe}` : "inset 0 1px 0 rgba(255,255,255,0.05)" }}
    >
      {/* laufende Nummer wie auf einem Kontaktabzug */}
      <span
        className="zahl pointer-events-none absolute left-1.5 top-0 font-bold leading-none text-white/[0.07]"
        style={{ fontSize: Math.max(22, groesse * 0.24) }}
        aria-hidden
      >
        {nummer}
      </span>
      <div className="relative z-[1] flex h-5 items-center gap-1 px-2 pt-1 text-[10.5px] text-text-3">
        <span className="min-w-0 flex-1 truncate opacity-0 transition-opacity group-hover:opacity-100" title={b.name}>
          {b.name}
        </span>
        {b.art === "raw" && <span className="rounded-[2px] bg-black/45 px-1 text-[8.5px] font-semibold tracking-wider text-text-2">RAW</span>}
        {b.bearbeitet && <SlidersHorizontal size={10} className="text-licht" aria-label="bearbeitet" />}
      </div>
      <div className="relative z-[1] flex min-h-0 flex-1 items-center justify-center px-2.5">
        <img
          src={miniUrl(b)}
          alt={b.name}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={cx(
            "max-h-full max-w-full object-contain shadow-[0_3px_10px_rgba(0,0,0,0.65)] outline outline-1 outline-black/40",
            b.markierung === -1 && "opacity-30",
          )}
        />
      </div>
      <div className="relative z-[1] flex h-7 items-center justify-between gap-1 px-2">
        <Sterne wert={b.bewertung} klein />
        <Markierung m={b.markierung} />
      </div>
    </div>
  );
}

// ---------- Lupe ----------

function Lupe({ b }: { b: Bild }) {
  return (
    <div className="relative flex h-full items-center justify-center bg-[#0e0e0e] p-6">
      <img
        key={b.id}
        src={vorschauUrl(b)}
        alt={b.name}
        draggable={false}
        className={cx("max-h-full max-w-full object-contain shadow-[0_6px_30px_rgba(0,0,0,0.7)]", b.markierung === -1 && "opacity-40")}
      />
      <div className="pointer-events-none absolute left-4 top-3 space-y-0.5 text-[12px] leading-snug text-text-2 [text-shadow:0_1px_2px_#000]">
        <div className="text-[13px] text-text">{b.name}</div>
        <div className="zahl">
          {b.breite} × {b.hoehe}
          {datumVon(b) && ` · ${formatiereDatum(b.aufgenommen || b.angelegt)}`}
        </div>
        {exifTeile(b).length > 0 && <div className="zahl">{exifTeile(b).join("   ")}</div>}
      </div>
    </div>
  );
}

// ---------- Filter ----------

function Filterleiste({ anzahl }: { anzahl: number }) {
  const { filter, setzeFilter } = useBibliothek();
  const [suche, setSuche] = useState(filter.suche ?? "");
  useEffect(() => {
    const t = setTimeout(() => suche !== (filter.suche ?? "") && setzeFilter({ suche }), 250);
    return () => clearTimeout(t);
  }, [suche, filter.suche, setzeFilter]);
  const seg = (aktiv: boolean) =>
    cx("h-6 rounded-[3px] px-2 text-[11.5px] transition-colors", aktiv ? "bg-[#3d3d3d] text-text" : "text-text-2 hover:text-text");
  const gefiltert = Boolean(filter.bewertung || filter.markierung || filter.art || filter.farbe || filter.suche);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-black/50 bg-[#1c1c1c] px-3 py-1.5">
      <span className="text-[11.5px] text-text-3">Bibliotheksfilter</span>
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-3" />
        <input
          className={cx(eingabe, "h-7 w-48 pl-7 text-[12px]")}
          placeholder="Text: Name, Kamera, Objektiv"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11.5px] text-text-3">Bewertung ≥</span>
        <Sterne wert={filter.bewertung ?? 0} onChange={(v) => setzeFilter({ bewertung: v })} />
      </div>
      <div className="flex rounded-[4px] bg-[#262626] p-[2px]">
        {(
          [
            ["", "Alle"],
            ["ohne-abgelehnte", "Ohne Abgelehnte"],
            ["ausgewaehlt", "Ausgewählt"],
            ["abgelehnt", "Abgelehnt"],
          ] as const
        ).map(([w, n]) => (
          <button key={w} className={seg((filter.markierung ?? "") === w)} onClick={() => setzeFilter({ markierung: w })}>
            {n}
          </button>
        ))}
      </div>
      <button
        className={cx(
          "h-6 rounded-[4px] border px-2 text-[10.5px] font-semibold tracking-wider",
          filter.art === "raw" ? "border-licht/60 text-licht" : "border-linie text-text-3 hover:text-text-2",
        )}
        onClick={() => setzeFilter({ art: filter.art === "raw" ? "" : "raw" })}
        aria-pressed={filter.art === "raw"}
      >
        RAW
      </button>
      <div className="flex items-center gap-1.5">
        {FARBEN.map((f) => (
          <button
            key={f.wert}
            title={f.name}
            aria-label={`Farbe ${f.name}`}
            aria-pressed={filter.farbe === f.wert}
            onClick={() => setzeFilter({ farbe: filter.farbe === f.wert ? "" : f.wert })}
            className={cx(
              "h-3 w-3 rounded-[2px] transition-transform hover:scale-110",
              filter.farbe === f.wert ? "ring-2 ring-white/80 ring-offset-2 ring-offset-[#1c1c1c]" : "opacity-70",
            )}
            style={{ background: f.css }}
          />
        ))}
      </div>
      {gefiltert && (
        <button
          className="flex items-center gap-1 text-[11.5px] text-text-3 hover:text-text"
          onClick={() => {
            setSuche("");
            setzeFilter({ bewertung: 0, markierung: "", art: "", farbe: "", suche: "" });
          }}
        >
          <X size={12} /> Ohne
        </button>
      )}
      <span className="zahl ml-auto text-[11.5px] text-text-3">{anzahl} Fotos</span>
    </div>
  );
}

// ---------- Linke Leiste: Katalog ----------

function Eintrag({ name, zahl, an, onKlick, einzug = 0, aufklapper }: { name: string; zahl: number; an: boolean; onKlick: () => void; einzug?: number; aufklapper?: ReactNode }) {
  return (
    <div
      className={cx("flex h-[26px] cursor-default items-center gap-1.5 rounded-[2px] pr-2 text-[12.5px]", an ? "bg-[#3d3d3d] text-text" : "text-text-2 hover:bg-white/[0.04] hover:text-text")}
      style={{ paddingLeft: 8 + einzug * 14 }}
      onClick={onKlick}
      role="button"
      aria-pressed={an}
    >
      <span className="flex w-3 justify-center">{aufklapper}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="zahl text-[11.5px] text-text-3">{zahl}</span>
    </div>
  );
}

function Katalog({ bilder }: { bilder: Bild[] }) {
  const { sammlung, setzeSammlung } = useBibliothek();
  const [offeneJahre, setOffeneJahre] = useState<string[]>(() => (sammlung.startsWith("monat:") ? [sammlung.slice(6, 10)] : []));
  const zuletzt = letzterImport(bilder);
  const zaehle = (f: (b: Bild) => boolean) => bilder.filter(f).length;

  const jahre = useMemo(() => {
    const k = new Map<string, Map<string, number>>();
    for (const b of bilder) {
      const d = datumVon(b);
      if (!d) continue;
      const j = d.slice(0, 4);
      const m = d.slice(0, 7);
      if (!k.has(j)) k.set(j, new Map());
      k.get(j)!.set(m, (k.get(j)!.get(m) ?? 0) + 1);
    }
    return [...k.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [bilder]);

  const kameras = useMemo(() => {
    const k = new Map<string, number>();
    for (const b of bilder) {
      const n = b.kamera || "Unbekannte Kamera";
      k.set(n, (k.get(n) ?? 0) + 1);
    }
    return [...k.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [bilder]);

  return (
    <>
      <Panel titel="Katalog" seite="links">
        <Eintrag name="Alle Fotos" zahl={bilder.length} an={sammlung === "alle"} onKlick={() => setzeSammlung("alle")} />
        <Eintrag name="Letzter Import" zahl={zaehle((b) => tag(b.angelegt) === zuletzt)} an={sammlung === "zuletzt"} onKlick={() => setzeSammlung("zuletzt")} />
        <Eintrag name="Bearbeitet" zahl={zaehle((b) => b.bearbeitet)} an={sammlung === "bearbeitet"} onKlick={() => setzeSammlung("bearbeitet")} />
        <Eintrag name="Unbearbeitet" zahl={zaehle((b) => !b.bearbeitet)} an={sammlung === "unbearbeitet"} onKlick={() => setzeSammlung("unbearbeitet")} />
      </Panel>
      <Panel titel="Nach Datum" seite="links">
        {jahre.length === 0 && <p className="px-2 text-[12px] text-text-3">Noch keine Fotos</p>}
        {jahre.map(([j, monate]) => {
          const offen = offeneJahre.includes(j);
          return (
            <div key={j}>
              <Eintrag
                name={j}
                zahl={[...monate.values()].reduce((a, b) => a + b, 0)}
                an={sammlung === "jahr:" + j}
                onKlick={() => setzeSammlung("jahr:" + j)}
                aufklapper={
                  <button
                    className="text-text-3 hover:text-text"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOffeneJahre(offen ? offeneJahre.filter((x) => x !== j) : [...offeneJahre, j]);
                    }}
                    aria-label={offen ? `${j} zuklappen` : `${j} aufklappen`}
                  >
                    <Dreieck richtung={offen ? "unten" : "rechts"} />
                  </button>
                }
              />
              {offen &&
                [...monate.entries()]
                  .sort((a, b) => b[0].localeCompare(a[0]))
                  .map(([m, n]) => (
                    <Eintrag key={m} name={MONATE[Number(m.slice(5, 7)) - 1]} zahl={n} einzug={1} an={sammlung === "monat:" + m} onKlick={() => setzeSammlung("monat:" + m)} />
                  ))}
            </div>
          );
        })}
      </Panel>
      <Panel titel="Nach Kamera" seite="links" offen={false}>
        {kameras.map(([k, n]) => (
          <Eintrag key={k} name={k} zahl={n} an={sammlung === "kamera:" + k} onKlick={() => setzeSammlung("kamera:" + k)} />
        ))}
      </Panel>
    </>
  );
}

// ---------- Rechte Leiste ----------

function Zeile({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-center gap-2 py-[3px] text-[12px]">
      <span className="truncate text-right text-text-3">{name}</span>
      <span className="min-w-0 truncate text-text-2">{children}</span>
    </div>
  );
}

function Metadaten({ b, alle }: { b: Bild; alle: string[] }) {
  const aendere = useBibliothek((s) => s.aendere);
  return (
    <Panel titel="Metadaten">
      {alle.length > 1 && <p className="mb-2 text-[11.5px] text-licht">{alle.length} Fotos gewählt – Bewertung, Markierung und Farbe gelten für alle</p>}
      <Zeile name="Dateiname">
        <span title={b.name}>{b.name}</span>
      </Zeile>
      <Zeile name="Bewertung">
        <Sterne wert={b.bewertung} onChange={(v) => aendere(alle, { bewertung: v })} />
      </Zeile>
      <Zeile name="Markierung">
        <span className="flex items-center gap-0.5">
          <SymbolKnopf className="h-6 w-6" aktiv={b.markierung === 1} title="Auswählen (P)" onClick={() => aendere(alle, { markierung: b.markierung === 1 ? 0 : 1 })}>
            <Flag size={13} />
          </SymbolKnopf>
          <SymbolKnopf className="h-6 w-6" aktiv={b.markierung === -1} title="Ablehnen (X)" onClick={() => aendere(alle, { markierung: b.markierung === -1 ? 0 : -1 })}>
            <Ban size={13} />
          </SymbolKnopf>
        </span>
      </Zeile>
      <Zeile name="Farbe">
        <span className="flex items-center gap-1.5">
          {FARBEN.map((f) => (
            <button
              key={f.wert}
              title={f.name}
              aria-label={`Farbe ${f.name}`}
              onClick={() => aendere(alle, { farbe: b.farbe === f.wert ? "" : f.wert })}
              className={cx("h-3 w-3 rounded-[2px]", b.farbe === f.wert ? "ring-2 ring-white/80 ring-offset-1 ring-offset-flaeche" : "opacity-55 hover:opacity-100")}
              style={{ background: f.css }}
            />
          ))}
        </span>
      </Zeile>
      <div className="my-2 h-px bg-linie" />
      <Zeile name="Aufgenommen">{formatiereDatum(b.aufgenommen) || "–"}</Zeile>
      <Zeile name="Abmessungen">
        <span className="zahl">
          {b.breite} × {b.hoehe}
        </span>
      </Zeile>
      <Zeile name="Dateigröße">{formatiereBytes(b.bytes)}</Zeile>
      <Zeile name="Format">{b.art.toUpperCase()}</Zeile>
      <Zeile name="Kamera">{b.kamera || "–"}</Zeile>
      <Zeile name="Objektiv">{b.objektiv || "–"}</Zeile>
      <Zeile name="Brennweite">{b.brennweite ? `${Math.round(b.brennweite)} mm` : "–"}</Zeile>
      <Zeile name="Blende">{b.blende ? `f/${String(b.blende).replace(".", ",")}` : "–"}</Zeile>
      <Zeile name="Belichtung">{formatiereBelichtung(b.belichtungszeit) || "–"}</Zeile>
      <Zeile name="ISO">{b.iso || "–"}</Zeile>
      <Zeile name="Importiert">{formatiereDatum(b.angelegt)}</Zeile>
    </Panel>
  );
}

// Schnellentwicklung: Schritte auf alle gewählten Fotos, ohne Entwickeln zu öffnen
function Schnellentwicklung({ ids }: { ids: string[] }) {
  const [vorgaben, setVorgaben] = useState<{ name: string; e: Partial<Einstellungen> }[]>(EINGEBAUT);
  useEffect(() => {
    void ladeVorgaben().then((v) => setVorgaben([...v.map((x) => ({ name: x.name, e: x.einstellungen })), ...EINGEBAUT]));
  }, []);
  const schritt = (k: "belichtung" | "kontrast" | "lichter" | "tiefen" | "klarheit" | "dynamik", d: number, was: string) =>
    void aufAlle(ids, (alt) => ({ ...alt, [k]: Math.max(k === "belichtung" ? -5 : -100, Math.min(k === "belichtung" ? 5 : 100, Math.round(((alt[k] as number) + d) * 100) / 100)) }), was);
  const zeile = (name: string, k: Parameters<typeof schritt>[0], gross: number, klein: number, einheit = "") => (
    <div className="grid grid-cols-[78px_repeat(4,1fr)] items-center gap-1 py-[2px] text-[12px]">
      <span className="truncate text-right text-text-3">{name}</span>
      {[-gross, -klein, klein, gross].map((d, i) => (
        <button
          key={i}
          className="h-6 rounded-[3px] bg-[#2b2b2b] text-[11px] text-text-2 hover:bg-[#363636] hover:text-text"
          onClick={() => schritt(k, d, `${name} ${d > 0 ? "+" : "−"}${String(Math.abs(d)).replace(".", ",")}${einheit}`)}
          title={`${name} ${d > 0 ? "+" : ""}${d}${einheit}`}
        >
          {i < 2 ? (i === 0 ? "◀◀" : "◀") : i === 2 ? "▶" : "▶▶"}
        </button>
      ))}
    </div>
  );
  return (
    <Panel titel="Schnellentwicklung" offen={false}>
      {ids.length > 1 && <p className="mb-2 text-[11.5px] text-licht">Wirkt auf {ids.length} Fotos</p>}
      <div className="grid grid-cols-[78px_1fr] items-center gap-1 pb-1.5 text-[12px]">
        <span className="text-right text-text-3">Vorgabe</span>
        <select
          className="h-7 rounded-[3px] border border-linie bg-[#262626] px-1.5 text-[12px] text-text-2 outline-none"
          value=""
          onChange={(e) => {
            const v = vorgaben[Number(e.target.value)];
            if (v) void aufAlle(ids, (alt) => mitVorgabe(alt, v.e), v.name);
          }}
        >
          <option value="">Anwenden …</option>
          {vorgaben.map((v, i) => (
            <option key={i} value={i}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
      {zeile("Belichtung", "belichtung", 1, 0.33)}
      {zeile("Kontrast", "kontrast", 20, 5)}
      {zeile("Lichter", "lichter", 20, 5)}
      {zeile("Tiefen", "tiefen", 20, 5)}
      {zeile("Klarheit", "klarheit", 20, 5)}
      {zeile("Dynamik", "dynamik", 20, 5)}
      <div className="mt-2 flex gap-1.5">
        <Knopf art="rahmen" className="h-7 flex-1 px-2 text-[12px]" onClick={() => void aufAlle(ids, (alt, en) => mitAutomatik(alt, en), "Automatisch")}>
          Automatisch
        </Knopf>
        <Knopf
          art="rahmen"
          className="h-7 flex-1 px-2 text-[12px]"
          onClick={() =>
            frage({
              title: ids.length > 1 ? `${ids.length} Fotos zurücksetzen?` : "Foto zurücksetzen?",
              message: "Alle Einstellungen gehen auf den Ausgangszustand zurück, auch Zuschnitt und Drehung.",
              primaryActionText: "Zurücksetzen",
              onPrimaryAction: () => void aufAlle(ids, () => standard(), "Zurückgesetzt"),
            })
          }
        >
          Zurücksetzen
        </Knopf>
      </div>
    </Panel>
  );
}

function Bearbeitungen({ b }: { b: Bild }) {
  const liste = useMemo(() => abweichungen(vervollstaendige(b.einstellungen)), [b.einstellungen]);
  return (
    <Panel titel="Bearbeitungen" offen={false}>
      {liste.length === 0 ? (
        <p className="text-[12px] text-text-3">Unbearbeitet</p>
      ) : (
        liste.map(([n, w]) => (
          <Zeile key={n} name={n}>
            <span className="zahl">{w}</span>
          </Zeile>
        ))
      )}
    </Panel>
  );
}

// ---------- Werkzeugleiste unter dem Raster ----------

function Werkzeugleiste({
  ansicht,
  setAnsicht,
  groesse,
  setGroesse,
  aktiv,
  ids,
}: {
  ansicht: "raster" | "lupe";
  setAnsicht: (a: "raster" | "lupe") => void;
  groesse: number;
  setGroesse: (g: number) => void;
  aktiv?: Bild;
  ids: string[];
}) {
  const { filter, setzeFilter, aendere } = useBibliothek();
  const knopf = (an: boolean) => cx("flex h-6 w-7 items-center justify-center rounded-[3px]", an ? "bg-[#454545] text-text" : "text-text-3 hover:text-text");
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-t border-black/50 bg-[#1c1c1c] px-3 text-[12px] text-text-3">
      <div className="flex rounded-[4px] bg-[#262626] p-[2px]">
        <button className={knopf(ansicht === "raster")} onClick={() => setAnsicht("raster")} title="Rasteransicht (G)" aria-label="Rasteransicht">
          <Grid3x3 size={14} />
        </button>
        <button className={knopf(ansicht === "lupe")} onClick={() => aktiv && setAnsicht("lupe")} title="Lupenansicht (E)" aria-label="Lupenansicht" disabled={!aktiv}>
          <Maximize2 size={13} />
        </button>
      </div>
      <label className="flex items-center gap-1.5">
        Sortieren:
        <select
          className="h-6 rounded-[3px] border border-linie bg-[#262626] px-1.5 text-[12px] text-text-2 outline-none"
          value={filter.ordnung ?? "aufgenommen"}
          onChange={(e) => setzeFilter({ ordnung: e.target.value as never })}
        >
          <option value="aufgenommen">Aufnahmedatum</option>
          <option value="angelegt">Importzeit</option>
          <option value="name">Dateiname</option>
          <option value="bewertung">Bewertung</option>
        </select>
      </label>
      {aktiv && (
        <div className="flex items-center gap-2 border-l border-linie pl-3">
          <SymbolKnopf className="h-6 w-6" aktiv={aktiv.markierung === 1} title="Auswählen (P)" onClick={() => aendere(ids, { markierung: aktiv.markierung === 1 ? 0 : 1 })}>
            <Flag size={13} />
          </SymbolKnopf>
          <SymbolKnopf className="h-6 w-6" aktiv={aktiv.markierung === -1} title="Ablehnen (X)" onClick={() => aendere(ids, { markierung: aktiv.markierung === -1 ? 0 : -1 })}>
            <Ban size={13} />
          </SymbolKnopf>
          <Sterne wert={aktiv.bewertung} onChange={(v) => aendere(ids, { bewertung: v })} />
          <div className="flex items-center gap-1">
            {FARBEN.map((f) => (
              <button
                key={f.wert}
                title={f.name}
                aria-label={`Farbe ${f.name}`}
                onClick={() => aendere(ids, { farbe: aktiv.farbe === f.wert ? "" : f.wert })}
                className={cx("h-3 w-3 rounded-[2px]", aktiv.farbe === f.wert ? "ring-2 ring-white/80 ring-offset-1 ring-offset-[#1c1c1c]" : "opacity-55 hover:opacity-100")}
                style={{ background: f.css }}
              />
            ))}
          </div>
          {ids.length > 1 && (
            <span className="flex items-center gap-1 text-text-2">
              {ids.length} gewählt
              <button className="text-text-3 hover:text-text" onClick={() => useBibliothek.setState({ auswahl: [aktiv.id] })} aria-label="Auswahl aufheben">
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}
      {ansicht === "raster" && (
        <label className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline">Miniaturen</span>
          <input type="range" className="regler w-28" min={110} max={340} value={groesse} onChange={(e) => setGroesse(Number(e.target.value))} aria-label="Miniaturgröße" />
        </label>
      )}
    </div>
  );
}

// ---------- Modul ----------

export default function Bibliothek() {
  const { bilder: alleBilder, alle: katalog, geladen, auswahl, waehle, aendere, laden, entferne, sammlung } = useBibliothek();
  const zeigeMenue = useMenue((s) => s.zeige);
  const bilder = useMemo(() => sichtbar(alleBilder, sammlung), [alleBilder, sammlung]);
  const { fortschritt, lade, waehle: dateienWaehlen } = useHochladen();
  const [ziehen, setZiehen] = useState(false);
  const [ansicht, setAnsicht] = useState<"raster" | "lupe">("raster");
  const [groesse, setGroesse] = useState(() => {
    try {
      return Number(localStorage.getItem("captr-kachel")) || 180;
    } catch {
      return 180;
    }
  });
  const raster = useRef<HTMLDivElement>(null);
  useLeistenTasten();

  useEffect(() => {
    void laden();
  }, [laden]);

  useEffect(() => {
    try {
      localStorage.setItem("captr-kachel", String(groesse));
    } catch {
      /* egal */
    }
  }, [groesse]);

  const aktiv = useMemo(() => bilder.find((b) => b.id === auswahl[0]), [bilder, auswahl]);
  const histo = useBildHistogramm(aktiv);
  const ids = auswahl.length ? auswahl : [];
  const alle = ids.length > 1 ? ids : aktiv ? [aktiv.id] : [];

  useEffect(() => {
    if (ansicht === "lupe" && !aktiv) setAnsicht("raster");
  }, [ansicht, aktiv]);

  // wie gewohnt: ohne Auswahl ist das erste Foto aktiv, damit Navigator,
  // Histogramm und Metadaten etwas zeigen
  useEffect(() => {
    if (geladen && bilder.length && !bilder.some((b) => auswahl.includes(b.id))) useBibliothek.setState({ auswahl: [bilder[0].id] });
  }, [geladen, bilder, auswahl]);

  const loeschen = useCallback(
    (liste: string[]) =>
      frage({
        title: liste.length > 1 ? `${liste.length} Fotos löschen?` : "Foto löschen?",
        message: "Original, Einstellungen und Vorschauen werden entfernt.",
        primaryActionText: "Löschen",
        onPrimaryAction: async () => {
          for (const id of liste) {
            try {
              await api.loeschen(id);
              entferne(id);
            } catch (err) {
              melde((err as Error).message, "fehler");
            }
          }
        },
      }),
    [entferne],
  );

  // Tastatur wie in gewohnten Fotoprogrammen
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || document.querySelector("[role=dialog]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        useBibliothek.setState({ auswahl: bilder.map((b) => b.id) });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c" && aktiv) {
        e.preventDefault();
        kopiere(vervollstaendige(aktiv.einstellungen), aktiv.name);
        melde(`Einstellungen von ${aktiv.name} kopiert`);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v" && ids.length && ablage.e) {
        e.preventDefault();
        const teil = ablage.e;
        void aufAlle(ids, (alt) => mitVorgabe(alt, teil), "Eingefügt");
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-5]$/.test(e.key) && ids.length) return void aendere(ids, { bewertung: Number(e.key) });
      const farbTaste: Record<string, string> = { "6": "rot", "7": "gelb", "8": "gruen", "9": "blau" };
      if (farbTaste[e.key] && ids.length) {
        const f = farbTaste[e.key];
        return void aendere(ids, { farbe: aktiv?.farbe === f ? "" : (f as never) });
      }
      const k = e.key.toLowerCase();
      if (k === "p" && ids.length) return void aendere(ids, { markierung: 1 });
      if (k === "x" && ids.length) return void aendere(ids, { markierung: -1 });
      if (k === "u" && ids.length) return void aendere(ids, { markierung: 0 });
      if (k === "g") return setAnsicht("raster");
      if (k === "e" && aktiv) return setAnsicht("lupe");
      if (k === "escape" && ansicht === "lupe") return setAnsicht("raster");
      if ((k === "enter" || k === "d") && aktiv) {
        location.hash = `#/entwickeln/${aktiv.id}`;
        return;
      }
      if ((k === "delete" || k === "backspace") && ids.length) return loeschen(ids);
      if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k) && bilder.length) {
        e.preventDefault();
        const i = Math.max(0, bilder.findIndex((b) => b.id === auswahl[0]));
        const breite = raster.current?.clientWidth ?? 800;
        const proZeile = ansicht === "lupe" ? 1 : Math.max(1, Math.floor((breite - 20 + 6) / (groesse + 6)));
        const schritt = { arrowleft: -1, arrowright: 1, arrowup: -proZeile, arrowdown: proZeile }[k]!;
        const n = Math.min(bilder.length - 1, Math.max(0, i + schritt));
        waehle(bilder[n].id, e.shiftKey ? "bereich" : "einzeln");
        raster.current?.querySelector(`[data-id="${bilder[n].id}"]`)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  }, [auswahl, bilder, aendere, aktiv, waehle, groesse, ansicht, ids, loeschen]);

  const ablegen = (e: React.DragEvent) => {
    e.preventDefault();
    setZiehen(false);
    void lade(Array.from(e.dataTransfer.files));
  };

  const klick = (b: Bild, e: React.MouseEvent, liste = bilder) => waehle(b.id, e.shiftKey ? "bereich" : e.ctrlKey || e.metaKey ? "dazu" : "einzeln", liste);
  // Rechtsklick: gehoert das Foto nicht zur Auswahl, wird es allein gewaehlt
  const kontext = (b: Bild, e: React.MouseEvent) => {
    let ids = useBibliothek.getState().auswahl;
    if (!ids.includes(b.id)) {
      ids = [b.id];
      useBibliothek.setState({ auswahl: ids });
    } else ids = [b.id, ...ids.filter((x) => x !== b.id)];
    useBibliothek.setState({ auswahl: ids });
    zeigeMenue(e, fotoMenue(ids, b, { lupe: () => setAnsicht("lupe") }));
  };
  const entwickeln = (b: Bild) => (location.hash = `#/entwickeln/${b.id}`);
  const gefiltert = Object.values(useBibliothek.getState().filter).some((v) => v && v !== "aufgenommen") || sammlung !== "alle";

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setZiehen(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setZiehen(false)}
      onDrop={ablegen}
    >
      <Fortschrittsbalken f={fortschritt} />
      <div className="flex min-h-0 flex-1">
        <Seitenleiste
          seite="links"
          breite={250}
          fuss={
            <Knopf art="rahmen" className="w-full" onClick={dateienWaehlen}>
              <Upload size={14} /> Importieren …
            </Knopf>
          }
        >
          <Navigator bild={aktiv} />
          <Katalog bilder={alleBilder} />
        </Seitenleiste>

        <div className="flex min-w-0 flex-1 flex-col">
          {ansicht === "raster" && <Filterleiste anzahl={bilder.length} />}
          <div
            ref={raster}
            role="grid"
            aria-label="Fotos"
            className={cx("min-h-0 flex-1 bg-[#161616]", ansicht === "raster" ? "overflow-y-auto p-2.5" : "overflow-hidden")}
          >
            {!geladen ? (
              <div className="p-6">
                <Laedt />
              </div>
            ) : bilder.length === 0 ? (
              <Leer onImport={dateienWaehlen} gefiltert={gefiltert} />
            ) : ansicht === "lupe" && aktiv ? (
              <div className="h-full" onDoubleClick={() => entwickeln(aktiv)} onContextMenu={(e) => kontext(aktiv, e)}>
                <Lupe b={aktiv} />
              </div>
            ) : (
              <div
                className="grid content-start justify-start gap-1.5"
                style={{ gridTemplateColumns: `repeat(auto-fill, ${groesse}px)` }}
              >
                {bilder.map((b, i) => (
                  <Zelle
                    key={b.id}
                    b={b}
                    nummer={i + 1}
                    groesse={groesse}
                    gewaehlt={auswahl.includes(b.id)}
                    haupt={auswahl[0] === b.id}
                    onKlick={(e) => klick(b, e)}
                    onDoppel={() => entwickeln(b)}
                    onKontext={(e) => kontext(b, e)}
                  />
                ))}
              </div>
            )}
          </div>
          <Werkzeugleiste ansicht={ansicht} setAnsicht={setAnsicht} groesse={groesse} setGroesse={setGroesse} aktiv={aktiv} ids={alle} />
        </div>

        <Seitenleiste
          seite="rechts"
          breite={290}
          fuss={
            aktiv && (
              <div className="flex gap-1.5">
                <a href={`#/entwickeln/${aktiv.id}`} className="flex-1">
                  <Knopf art="licht" className="w-full">
                    <SlidersHorizontal size={14} /> Entwickeln
                  </Knopf>
                </a>
                <a href={`/api/bilder/${aktiv.id}/original`} title="Original herunterladen">
                  <Knopf art="rahmen" aria-label="Original herunterladen">
                    <Download size={14} />
                  </Knopf>
                </a>
                <Knopf art="gefahr" onClick={() => loeschen(alle)} title="Löschen (Entf)" aria-label="Löschen">
                  <Trash2 size={14} />
                </Knopf>
              </div>
            )
          }
        >
          <HistogrammPanel h={histo} bild={aktiv} />
          {aktiv ? (
            <>
              <Schnellentwicklung ids={alle} />
              <Metadaten b={aktiv} alle={alle} />
              <Bearbeitungen b={aktiv} />
            </>
          ) : (
            <p className="p-4 text-[12px] text-text-3">Foto anklicken, um Bewertung, Markierung und Aufnahmedaten zu sehen.</p>
          )}
        </Seitenleiste>
      </div>

      <Filmstreifen
        bilder={katalog}
        aktiv={auswahl[0]}
        auswahl={auswahl}
        quelle="Alle Fotos"
        onKlick={(b, e) => klick(b, e, katalog)}
        onDoppel={entwickeln}
        onKontext={kontext}
      />

      {ziehen && (
        <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-licht/70 bg-black/60">
          <div className="flex flex-col items-center gap-2 text-licht">
            <ImagePlus size={36} strokeWidth={1.5} />
            <span className="text-[15px] font-medium">Fotos hier ablegen</span>
            <span className="text-[12px] text-text-2">RAW, JPEG, PNG, TIFF, WebP, HEIC</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Leer({ onImport, gefiltert }: { onImport: () => void; gefiltert: boolean }) {
  if (gefiltert)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-text-3">
        <p>Kein Foto passt zu Filter und Sammlung.</p>
        <Knopf
          art="rahmen"
          onClick={() => {
            useBibliothek.getState().setzeSammlung("alle");
            useBibliothek.getState().setzeFilter({ bewertung: 0, markierung: "", art: "", farbe: "", suche: "" });
          }}
        >
          Alles zeigen
        </Knopf>
      </div>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-linie bg-flaeche text-licht">
        <ImagePlus size={28} strokeWidth={1.5} />
      </div>
      <div>
        <h2 className="text-[17px] font-semibold">Noch keine Fotos</h2>
        <p className="mt-1 max-w-sm text-[13px] text-text-2">
          Zieh Fotos in dieses Fenster oder wähle sie aus. Captr liest RAW-Dateien fast aller Kameras, dazu JPEG, PNG, TIFF, WebP und HEIC.
        </p>
      </div>
      <Knopf art="licht" onClick={onImport}>
        <Upload size={14} /> Fotos importieren
      </Knopf>
    </div>
  );
}
