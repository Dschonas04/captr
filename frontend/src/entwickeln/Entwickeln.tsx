import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Columns2,
  Copy,
  Crop,
  Download,
  FlipHorizontal2,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { api, formatiereBelichtung, ladePixel, miniUrl, vorschauUrl, type Bild, type Vorlage } from "../api";
import { useBibliothek } from "../bibliothek/speicher";
import { Dialog, Feld, Knopf, Laedt, Regler, Sterne, SymbolKnopf, cx, eingabe, frage, melde } from "../ui";
import {
  FARBBEREICHE,
  SEITENVERHAELTNISSE,
  ausgabeGroesse,
  begrenzeZuschnitt,
  gedrehteGroesse,
  istStandard,
  ohneGeometrie,
  standard,
  vervollstaendige,
  zuschnittFuer,
  type Einstellungen,
  type Zuschnitt,
} from "./einstellungen";
import { Entwickler, automatisch, bildAlsBlob, type Histogramm } from "./gpu";
import Kurve, { HistogrammAnzeige } from "./Kurve";

const VORSCHAU_MAX = 2560;

const EINGEBAUT: { name: string; e: Partial<Einstellungen> }[] = [
  { name: "Schwarzweiß", e: { saettigung: -100, dynamik: 0, kontrast: 18, klarheit: 12 } },
  { name: "Schwarzweiß hart", e: { saettigung: -100, kontrast: 45, klarheit: 30, schwarz: -15, weiss: 10, koernung: 18 } },
  { name: "Kräftig", e: { dynamik: 35, kontrast: 18, klarheit: 15, dunst: 8 } },
  { name: "Matt", e: { kontrast: -12, kurven: { rgb: [[0, 0.08], [0.5, 0.5], [1, 0.94]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }, saettigung: -10 } },
  { name: "Warm", e: { temperatur: 22, toenung: 6, dynamik: 10 } },
  { name: "Kühl", e: { temperatur: -20, toenung: -4 } },
  { name: "Film", e: { kontrast: 10, lichter: -25, tiefen: 20, saettigung: -12, koernung: 25, vignette: -18, kurven: { rgb: [[0, 0.05], [0.25, 0.22], [0.75, 0.8], [1, 0.96]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0.04], [1, 0.97]] } } },
];

function Abschnitt({ titel, children, offen: anfangOffen = true, rechts }: { titel: string; children: ReactNode; offen?: boolean; rechts?: ReactNode }) {
  const [offen, setOffen] = useState(() => {
    try {
      const w = localStorage.getItem("captr-abschnitt-" + titel);
      return w === null ? anfangOffen : w === "1";
    } catch {
      return anfangOffen;
    }
  });
  return (
    <section className="border-b border-linie">
      <div className="flex items-center">
        <button
          className="flex h-10 flex-1 items-center gap-2 px-4 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-text-2 hover:text-text"
          onClick={() => {
            setOffen(!offen);
            try {
              localStorage.setItem("captr-abschnitt-" + titel, offen ? "0" : "1");
            } catch {
              /* egal */
            }
          }}
          aria-expanded={offen}
        >
          <ChevronDown size={13} className={cx("transition-transform", !offen && "-rotate-90")} />
          {titel}
        </button>
        {rechts && <div className="pr-3">{rechts}</div>}
      </div>
      {offen && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

// ---------- Zuschnitt-Ebene ----------

type Griff = "mitte" | "n" | "s" | "o" | "w" | "no" | "nw" | "so" | "sw";

function Zuschnittebene({
  e,
  gb,
  gh,
  onChange,
  onEnde,
}: {
  e: Einstellungen;
  gb: number;
  gh: number;
  onChange: (z: Zuschnitt) => void;
  onEnde: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ griff: Griff; x: number; y: number; z: Zuschnitt } | null>(null);
  const z = e.zuschnitt;
  const verh = SEITENVERHAELTNISSE.find((s) => s.wert === e.seitenverhaeltnis);
  const v = e.seitenverhaeltnis === "original" ? gb / gh : verh?.v;

  const rad = (e.winkel * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const mx = (z.x + z.b / 2) * gb;
  const my = (z.y + z.h / 2) * gh;
  const hb = (z.b * gb) / 2;
  const hh = (z.h * gh) / 2;
  const ecken = [
    [-hb, -hh],
    [hb, -hh],
    [hb, hh],
    [-hb, hh],
  ].map(([dx, dy]) => [mx + dx * c - dy * s, my + dx * s + dy * c]);
  const poly = ecken.map((p) => p.join(",")).join(" ");
  const drittel = [1 / 3, 2 / 3].flatMap((t) => {
    const a = (u: number, w: number) => [mx + (u * 2 - 1) * hb * c - (w * 2 - 1) * hh * s, my + (u * 2 - 1) * hb * s + (w * 2 - 1) * hh * c];
    return [
      [a(t, 0), a(t, 1)],
      [a(0, t), a(1, t)],
    ];
  });

  const runter = (griff: Griff) => (ev: React.PointerEvent) => {
    ev.stopPropagation();
    (ev.target as Element).setPointerCapture(ev.pointerId);
    start.current = { griff, x: ev.clientX, y: ev.clientY, z: { ...z } };
  };

  const bewegen = (ev: React.PointerEvent) => {
    const st = start.current;
    if (!st || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const dx = (ev.clientX - st.x) / r.width;
    const dy = (ev.clientY - st.y) / r.height;
    let { x, y, b, h } = st.z;
    const g = st.griff;
    if (g === "mitte") {
      x += dx;
      y += dy;
      x = Math.min(1 - b, Math.max(0, x));
      y = Math.min(1 - h, Math.max(0, y));
      // beim Verschieben die Groesse halten, nur Position begrenzen
      const neu = { x, y, b, h };
      const begrenzt = begrenzeZuschnitt(neu, gb, gh, e.winkel);
      if (Math.abs(begrenzt.b - b) < 1e-6) onChange(begrenzt);
      return;
    }
    if (g.includes("w")) {
      x += dx;
      b -= dx;
    }
    if (g.includes("o")) b += dx;
    if (g.includes("n")) {
      y += dy;
      h -= dy;
    }
    if (g.includes("s")) h += dy;
    b = Math.max(0.03, b);
    h = Math.max(0.03, h);
    if (v) {
      // Seitenverhaeltnis halten: die vom Griff vorgegebene Seite fuehrt
      const hAusB = (b * gb) / v / gh;
      const bAusH = (h * gh * v) / gb;
      if (g === "n" || g === "s") {
        const nb = bAusH;
        x += (b - nb) / 2;
        b = nb;
      } else if (g === "o" || g === "w") {
        const nh = hAusB;
        y += (h - nh) / 2;
        h = nh;
      } else {
        if (g.includes("n")) y += h - hAusB;
        h = hAusB;
      }
    }
    if (x < 0 || y < 0 || x + b > 1 || y + h > 1) {
      if (v) return; // mit festem Verhaeltnis nicht ueber den Rand
      if (x < 0) {
        b += x;
        x = 0;
      }
      if (y < 0) {
        h += y;
        y = 0;
      }
      b = Math.min(b, 1 - x);
      h = Math.min(h, 1 - y);
    }
    onChange(begrenzeZuschnitt({ x, y, b, h }, gb, gh, e.winkel));
  };

  const hoch = () => {
    if (start.current) onEnde();
    start.current = null;
  };

  // Griffe sitzen am nicht gedrehten Rechteck; bei kleinen Winkeln reicht das
  const griffe: [Griff, number, number, string][] = [
    ["nw", z.x, z.y, "cursor-nwse-resize"],
    ["no", z.x + z.b, z.y, "cursor-nesw-resize"],
    ["sw", z.x, z.y + z.h, "cursor-nesw-resize"],
    ["so", z.x + z.b, z.y + z.h, "cursor-nwse-resize"],
    ["n", z.x + z.b / 2, z.y, "cursor-ns-resize"],
    ["s", z.x + z.b / 2, z.y + z.h, "cursor-ns-resize"],
    ["w", z.x, z.y + z.h / 2, "cursor-ew-resize"],
    ["o", z.x + z.b, z.y + z.h / 2, "cursor-ew-resize"],
  ];

  return (
    <div ref={box} className="absolute inset-0 touch-none" onPointerMove={bewegen} onPointerUp={hoch} onPointerCancel={hoch}>
      <svg viewBox={`0 0 ${gb} ${gh}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <path d={`M0,0H${gb}V${gh}H0Z M${poly.split(" ").join(" L")}Z`} fill="rgba(0,0,0,0.55)" fillRule="evenodd" />
        {drittel.map(([a, b], i) => (
          <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="rgba(255,255,255,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        <polygon points={poly} fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div
        className="absolute cursor-move"
        style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.b * 100}%`, height: `${z.h * 100}%` }}
        onPointerDown={runter("mitte")}
      />
      {griffe.map(([g, x, y, cur]) => (
        <div
          key={g}
          onPointerDown={runter(g)}
          className={cx("absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2", cur)}
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        >
          <div
            className={cx(
              "absolute bg-white shadow",
              g.length === 2 ? "left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2" : g === "n" || g === "s" ? "left-0.5 right-0.5 top-[7px] h-[3px]" : "bottom-0.5 left-[7px] top-0.5 w-[3px]",
            )}
          />
        </div>
      ))}
    </div>
  );
}

// ---------- Export ----------

function ExportDialog({ bild, e, onSchliessen }: { bild: Bild; e: Einstellungen; onSchliessen: () => void }) {
  const [format, setFormat] = useState<"image/jpeg" | "image/png" | "image/webp">("image/jpeg");
  const [qualitaet, setQualitaet] = useState(92);
  const [seite, setSeite] = useState(0);
  const [name, setName] = useState(bild.name.replace(/\.[^.]+$/, ""));
  const [arbeitet, setArbeitet] = useState("");
  const [vb, vh] = ausgabeGroesse(bild.breite, bild.hoehe, e);

  const los = async () => {
    try {
      setArbeitet("Lade volle Auflösung …");
      const px = await ladePixel(bild.id, 0);
      setArbeitet("Entwickle …");
      await new Promise((r) => setTimeout(r, 20));
      const leinwand = new OffscreenCanvas(1, 1);
      const entw = new Entwickler(leinwand);
      try {
        entw.setzeBild(px);
        let [b, h] = ausgabeGroesse(px.breite, px.hoehe, e);
        if (seite > 0 && Math.max(b, h) > seite) {
          const f = seite / Math.max(b, h);
          b = Math.round(b * f);
          h = Math.round(h * f);
        }
        const daten = entw.rendere(e, b, h);
        setArbeitet("Speichere …");
        const blob = await bildAlsBlob(daten, format, qualitaet / 100);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${name || "captr"}.${format === "image/jpeg" ? "jpg" : format === "image/png" ? "png" : "webp"}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        melde(`Exportiert: ${b} × ${h}`);
        onSchliessen();
      } finally {
        entw.freigeben(true);
      }
    } catch (err) {
      melde("Export fehlgeschlagen: " + (err as Error).message, "fehler");
      setArbeitet("");
    }
  };

  return (
    <Dialog titel="Exportieren" onSchliessen={onSchliessen}>
      <div className="space-y-4">
        <Feld name="Dateiname">
          <input className={eingabe} value={name} onChange={(ev) => setName(ev.target.value)} onKeyDown={(ev) => ev.stopPropagation()} />
        </Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld name="Format">
            <select className={eingabe} value={format} onChange={(ev) => setFormat(ev.target.value as never)}>
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
              <option value="image/webp">WebP</option>
            </select>
          </Feld>
          <Feld name="Größe">
            <select className={eingabe} value={seite} onChange={(ev) => setSeite(Number(ev.target.value))}>
              <option value={0}>Original ({vb} × {vh})</option>
              <option value={3840}>Lange Seite 3840 px</option>
              <option value={2560}>Lange Seite 2560 px</option>
              <option value={2048}>Lange Seite 2048 px</option>
              <option value={1080}>Lange Seite 1080 px</option>
            </select>
          </Feld>
        </div>
        {format !== "image/png" && <Regler name="Qualität" wert={qualitaet} min={50} max={100} standard={92} onChange={setQualitaet} />}
        <div className="flex items-center justify-end gap-2 pt-1">
          {arbeitet && <Laedt text={arbeitet} />}
          <Knopf onClick={onSchliessen}>Abbrechen</Knopf>
          <Knopf art="licht" onClick={los} disabled={!!arbeitet}>
            <Download size={14} /> Exportieren
          </Knopf>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Vorlagen ----------

function Vorlagen({ anwenden, aktuell }: { anwenden: (e: Partial<Einstellungen>) => void; aktuell: Einstellungen }) {
  const [eigene, setEigene] = useState<Vorlage[]>([]);
  const [neu, setNeu] = useState<string | null>(null);
  useEffect(() => {
    api.vorlagen().then(setEigene, () => {});
  }, []);
  const zeile = "flex w-full items-center rounded px-2 py-1.5 text-left text-[12.5px] text-text-2 hover:bg-white/5 hover:text-text";
  return (
    <div className="p-3">
      <div className="mb-1 flex items-center justify-between px-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-3">Vorlagen</h3>
        <SymbolKnopf className="h-6 w-6" title="Aktuelle Einstellungen als Vorlage sichern" onClick={() => setNeu("")}>
          <Plus size={14} />
        </SymbolKnopf>
      </div>
      {eigene.map((v) => (
        <div key={v.id} className="group flex items-center">
          <button className={zeile} onClick={() => anwenden(v.einstellungen)}>
            {v.name}
          </button>
          <button
            className="hidden p-1 text-text-3 hover:text-gefahr group-hover:block"
            aria-label={`Vorlage ${v.name} löschen`}
            onClick={async () => {
              await api.vorlageLoeschen(v.id);
              setEigene(eigene.filter((x) => x.id !== v.id));
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {eigene.length > 0 && <div className="mx-2 my-2 h-px bg-linie" />}
      {EINGEBAUT.map((v) => (
        <button key={v.name} className={zeile} onClick={() => anwenden(v.e)}>
          {v.name}
        </button>
      ))}
      {neu !== null && (
        <Dialog titel="Vorlage sichern" onSchliessen={() => setNeu(null)}>
          <form
            onSubmit={async (ev) => {
              ev.preventDefault();
              try {
                const v = await api.vorlageAnlegen(neu.trim(), ohneGeometrie(aktuell));
                setEigene([...eigene, v].sort((a, b) => a.name.localeCompare(b.name)));
                setNeu(null);
              } catch (err) {
                melde((err as Error).message, "fehler");
              }
            }}
          >
            <Feld name="Name">
              <input className={eingabe} value={neu} onChange={(ev) => setNeu(ev.target.value)} onKeyDown={(ev) => ev.stopPropagation()} />
            </Feld>
            <p className="mt-2 text-[12px] text-text-3">Gesichert werden Farbe und Ton, nicht Zuschnitt und Drehung.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Knopf type="button" onClick={() => setNeu(null)}>
                Abbrechen
              </Knopf>
              <Knopf art="licht" disabled={!neu.trim()}>
                Sichern
              </Knopf>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

// ---------- Seite ----------

let zwischenablage: Partial<Einstellungen> | null = null;

export default function Entwickeln({ id }: { id: string }) {
  const { bilder, ersetze, laden: bibliothekLaden, geladen, aendere } = useBibliothek();
  const [bild, setBild] = useState<Bild | null>(() => bilder.find((b) => b.id === id) ?? null);
  const [e, setE] = useState<Einstellungen>(() => vervollstaendige(bild?.einstellungen));
  const [vorher, setVorher] = useState(false);
  const [zuschneiden, setZuschneiden] = useState(false);
  const [lupe, setLupe] = useState(false);
  const [bereit, setBereit] = useState(false);
  const [fehler, setFehler] = useState("");
  const [tex, setTex] = useState<[number, number]>([0, 0]);
  const [voll, setVoll] = useState(false);
  const [histo, setHisto] = useState<Histogramm | null>(null);
  const [exportieren, setExportieren] = useState(false);
  const [hslArt, setHslArt] = useState<"farbton" | "farbsaettigung" | "farbluminanz">("farbton");
  const [flaeche, setFlaeche] = useState<[number, number]>([800, 600]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const ansichtRef = useRef<HTMLDivElement>(null);
  const entw = useRef<Entwickler | null>(null);
  const verlauf = useRef<{ liste: string[]; i: number }>({ liste: [], i: -1 });
  const ladeNr = useRef(0);
  const eRef = useRef(e);
  eRef.current = e;

  // Bibliothek fuer den Filmstreifen
  useEffect(() => {
    if (!geladen) void bibliothekLaden();
  }, [geladen, bibliothekLaden]);

  // WebGL einmal anlegen
  useEffect(() => {
    try {
      entw.current = new Entwickler(canvas.current!);
    } catch (err) {
      setFehler((err as Error).message);
    }
    return () => entw.current?.freigeben();
  }, []);

  // Flaeche fuer das Bild beobachten
  useLayoutEffect(() => {
    const el = ansichtRef.current!;
    const ro = new ResizeObserver(() => setFlaeche([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setFlaeche([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, []);

  // ---------- Speichern ----------

  const speicherUhr = useRef<number | undefined>(undefined);
  const vorschauUhr = useRef<number | undefined>(undefined);
  const offen = useRef<{ id: string; e: Einstellungen } | null>(null);

  const schreibeVorschauen = useCallback(async (bid: string, einst: Einstellungen) => {
    const en = entw.current;
    if (!en?.hatBild) return;
    const [ab, ah] = ausgabeGroesse(en.breite, en.hoehe, einst);
    for (const [art, max, q] of [
      ["vorschau", 2048, 0.88],
      ["mini", 480, 0.82],
    ] as const) {
      const f = Math.min(1, max / Math.max(ab, ah));
      const daten = en.rendere(einst, Math.max(1, Math.round(ab * f)), Math.max(1, Math.round(ah * f)));
      await api.setzeVorschau(bid, art, await bildAlsBlob(daten, "image/jpeg", q));
    }
  }, []);

  const speichereJetzt = useCallback(async () => {
    window.clearTimeout(speicherUhr.current);
    window.clearTimeout(vorschauUhr.current);
    const o = offen.current;
    if (!o) return;
    offen.current = null;
    try {
      const bearbeitet = !istStandard(o.e);
      if (bearbeitet) await schreibeVorschauen(o.id, o.e);
      const neu = await api.aendern(o.id, { einstellungen: o.e, bearbeitet });
      ersetze(neu);
    } catch (err) {
      melde("Nicht gespeichert: " + (err as Error).message, "fehler");
    }
  }, [ersetze, schreibeVorschauen]);

  const merke = useCallback(
    (neu: Einstellungen) => {
      if (!bild) return;
      offen.current = { id: bild.id, e: neu };
      window.clearTimeout(speicherUhr.current);
      speicherUhr.current = window.setTimeout(async () => {
        const o = offen.current;
        if (!o) return;
        try {
          const bearbeitet = !istStandard(o.e);
          const b = await api.aendern(o.id, { einstellungen: o.e, bearbeitet });
          // die Vorschauen folgen etwas spaeter, sie kosten mehr
          window.clearTimeout(vorschauUhr.current);
          vorschauUhr.current = window.setTimeout(() => {
            if (offen.current?.e !== o.e) return;
            offen.current = null;
            (bearbeitet ? schreibeVorschauen(o.id, o.e) : Promise.resolve()).then(
              () => ersetze({ ...b, geaendert: new Date().toISOString() }),
              () => {},
            );
          }, 900);
        } catch (err) {
          melde("Nicht gespeichert: " + (err as Error).message, "fehler");
        }
      }, 500);
    },
    [bild, ersetze, schreibeVorschauen],
  );

  // beim Verlassen nichts verlieren
  useEffect(() => () => void speichereJetzt(), [speichereJetzt]);

  // ---------- Laden ----------

  useEffect(() => {
    let abbruch = false;
    const nr = ++ladeNr.current;
    const ctrl = new AbortController();
    (async () => {
      await speichereJetzt();
      setBereit(false);
      setVoll(false);
      setLupe(false);
      setZuschneiden(false);
      setHisto(null);
      setFehler("");
      let b = useBibliothek.getState().bilder.find((x) => x.id === id) ?? null;
      try {
        if (!b) b = await api.bild(id);
      } catch (err) {
        if (!abbruch) setFehler((err as Error).message);
        return;
      }
      if (abbruch) return;
      setBild(b);
      const einst = vervollstaendige(b.einstellungen);
      setE(einst);
      verlauf.current = { liste: [JSON.stringify(einst)], i: 0 };
      try {
        const px = await ladePixel(id, VORSCHAU_MAX, ctrl.signal);
        if (abbruch || nr !== ladeNr.current || !entw.current) return;
        entw.current.setzeBild(px);
        setTex([px.breite, px.hoehe]);
        setVoll(Math.max(px.breite, px.hoehe) < VORSCHAU_MAX);
        setBereit(true);
      } catch (err) {
        if (!abbruch && (err as Error).name !== "AbortError") setFehler((err as Error).message);
      }
    })();
    return () => {
      abbruch = true;
      ctrl.abort();
    };
  }, [id, speichereJetzt]);

  // volle Aufloesung fuer die Lupe nachladen
  useEffect(() => {
    if (!lupe || voll || !bereit || !bild) return;
    const nr = ladeNr.current;
    const ctrl = new AbortController();
    ladePixel(bild.id, 0, ctrl.signal).then(
      (px) => {
        if (nr !== ladeNr.current || !entw.current) return;
        entw.current.setzeBild(px);
        setTex([px.breite, px.hoehe]);
        setVoll(true);
      },
      () => {},
    );
    return () => ctrl.abort();
  }, [lupe, voll, bereit, bild]);

  // ---------- Zeichnen ----------

  const ansicht = useMemo<Einstellungen>(
    () => (zuschneiden ? { ...e, zuschnitt: { x: 0, y: 0, b: 1, h: 1 }, winkel: 0 } : e),
    [e, zuschneiden],
  );

  const [ab, ah] = tex[0] ? ausgabeGroesse(tex[0], tex[1], ansicht) : [1, 1];
  const dpr = window.devicePixelRatio || 1;
  const rand = 32;
  const passt = Math.min((flaeche[0] - rand * 2) / ab, (flaeche[1] - rand * 2) / ah);
  const massstab = lupe && !zuschneiden ? 1 / dpr : passt;
  const cssB = Math.max(1, Math.round(ab * massstab));
  const cssH = Math.max(1, Math.round(ah * massstab));
  const maxPx = entw.current ? Math.min(entw.current.gl.getParameter(entw.current.gl.MAX_VIEWPORT_DIMS)[0], 16384) : 4096;
  const pxB = Math.min(maxPx, Math.round(cssB * dpr));
  const pxH = Math.min(maxPx, Math.round(cssH * dpr));

  useEffect(() => {
    const en = entw.current;
    if (!en || !bereit) return;
    const c = canvas.current!;
    if (c.width !== pxB) c.width = pxB;
    if (c.height !== pxH) c.height = pxH;
    const f = requestAnimationFrame(() => en.zeichne(ansicht, vorher));
    return () => cancelAnimationFrame(f);
  }, [ansicht, vorher, bereit, pxB, pxH, tex]);

  useEffect(() => {
    const en = entw.current;
    if (!en || !bereit) return;
    const t = setTimeout(() => setHisto(en.histogramm(e)), 140);
    return () => clearTimeout(t);
  }, [e, bereit, tex]);

  // ---------- Aendern ----------

  const setze = useCallback(
    (teil: Partial<Einstellungen>, endgueltig = false) => {
      const neu = { ...eRef.current, ...teil };
      setE(neu);
      merke(neu);
      if (endgueltig) {
        const v = verlauf.current;
        const s = JSON.stringify(neu);
        if (v.liste[v.i] !== s) {
          v.liste = [...v.liste.slice(0, v.i + 1), s].slice(-200);
          v.i = v.liste.length - 1;
        }
      }
    },
    [merke],
  );
  const ende = useCallback(() => setze({}, true), [setze]);

  const schritt = useCallback(
    (r: -1 | 1) => {
      const v = verlauf.current;
      const i = v.i + r;
      if (i < 0 || i >= v.liste.length) return;
      v.i = i;
      const neu = vervollstaendige(JSON.parse(v.liste[i]));
      setE(neu);
      merke(neu);
    },
    [merke],
  );

  const regler = (name: string, k: keyof Einstellungen, min = -100, max = 100, extra: Partial<Parameters<typeof Regler>[0]> = {}) => (
    <Regler
      name={name}
      wert={e[k] as number}
      min={min}
      max={max}
      standard={standard()[k] as number}
      onChange={(v) => setze({ [k]: v })}
      onEnde={ende}
      {...extra}
    />
  );

  const [gb, gh] = tex[0] ? gedrehteGroesse(tex[0], tex[1], e.vierteldrehung) : [1, 1];

  const drehe = (r: 1 | -1) => {
    setze({ vierteldrehung: (e.vierteldrehung + r + 4) % 4, zuschnitt: { x: 0, y: 0, b: 1, h: 1 }, winkel: 0, seitenverhaeltnis: e.seitenverhaeltnis === "original" ? "original" : "frei" }, true);
  };

  const waehleVerhaeltnis = (wert: string) => {
    const s = SEITENVERHAELTNISSE.find((x) => x.wert === wert);
    const v = wert === "original" ? gb / gh : s?.v;
    setze({ seitenverhaeltnis: wert, ...(v ? { zuschnitt: begrenzeZuschnitt(zuschnittFuer(v, gb, gh), gb, gh, e.winkel) } : {}) }, true);
  };

  const anwenden = (teil: Partial<Einstellungen>) => {
    const geo = { vierteldrehung: e.vierteldrehung, spiegeln: e.spiegeln, winkel: e.winkel, zuschnitt: e.zuschnitt, seitenverhaeltnis: e.seitenverhaeltnis };
    const neu = vervollstaendige({ ...ohneGeometrie(standard()), ...ohneGeometrie(vervollstaendige(teil)), ...geo });
    // nur ueberschreiben, was die Vorlage tatsaechlich setzt
    const ergebnis = { ...e } as Record<string, unknown>;
    for (const k of Object.keys(teil)) ergebnis[k] = (neu as unknown as Record<string, unknown>)[k];
    setze(ergebnis as Partial<Einstellungen>, true);
  };

  const auto = () => {
    const en = entw.current;
    if (!en?.hatBild) return;
    const basis = { ...standard(), vierteldrehung: e.vierteldrehung, spiegeln: e.spiegeln, winkel: e.winkel, zuschnitt: e.zuschnitt, temperatur: e.temperatur, toenung: e.toenung };
    setze(automatisch(en.histogramm({ ...basis, schaerfe: 0 })), true);
  };

  // ---------- Navigation ----------

  const index = bilder.findIndex((b) => b.id === id);
  const geheZu = useCallback((r: number) => {
    const liste = useBibliothek.getState().bilder;
    const i = liste.findIndex((b) => b.id === id);
    const n = liste[i + r];
    if (n) location.hash = `#/entwickeln/${n.id}`;
  }, [id]);

  useEffect(() => {
    const taste = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || document.querySelector("[role=dialog]")) return;
      const k = ev.key.toLowerCase();
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && k === "z") {
        ev.preventDefault();
        schritt(ev.shiftKey ? 1 : -1);
        return;
      }
      if (mod && k === "y") {
        ev.preventDefault();
        schritt(1);
        return;
      }
      if (mod && ev.shiftKey && k === "c") {
        ev.preventDefault();
        zwischenablage = ohneGeometrie(eRef.current);
        melde("Einstellungen kopiert");
        return;
      }
      if (mod && ev.shiftKey && k === "v") {
        ev.preventDefault();
        if (zwischenablage) anwenden(zwischenablage);
        return;
      }
      if (mod || ev.altKey) return;
      if (k === "\\") setVorher((v) => !v);
      else if (k === "r") setZuschneiden((z) => !z);
      else if (k === "z" || k === " ") {
        ev.preventDefault();
        setLupe((l) => !l);
      } else if (k === "escape") {
        if (zuschneiden) setZuschneiden(false);
        else location.hash = "#/";
      } else if (k === "g") location.hash = "#/";
      else if (k === "arrowleft") geheZu(-1);
      else if (k === "arrowright") geheZu(1);
      else if (/^[0-5]$/.test(k) && bild) void aendere([bild.id], { bewertung: Number(k) }).then(() => setBild(useBibliothek.getState().bilder.find((b) => b.id === bild.id) ?? bild));
      else if (k === "p" && bild) void aendere([bild.id], { markierung: 1 });
      else if (k === "x" && bild) void aendere([bild.id], { markierung: -1 });
      else if (k === "u" && bild) void aendere([bild.id], { markierung: 0 });
    };
    window.addEventListener("keydown", taste);
    return () => window.removeEventListener("keydown", taste);
  });

  const aktuell = bilder.find((b) => b.id === id) ?? bild;

  return (
    <div className="flex h-full min-h-0">
      {/* Vorlagen */}
      <aside className="hidden w-[210px] shrink-0 overflow-y-auto border-r border-linie bg-flaeche xl:block">
        <Vorlagen anwenden={anwenden} aktuell={e} />
      </aside>

      {/* Bild */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-linie px-3">
          <a href="#/" className="mr-1">
            <SymbolKnopf title="Zur Bibliothek (G)" aria-label="Zur Bibliothek">
              <ArrowLeft size={16} />
            </SymbolKnopf>
          </a>
          <div className="mr-auto min-w-0 truncate text-[13px] text-text-2" title={bild?.name}>
            <span className="text-text">{bild?.name}</span>
            {bild && (
              <span className="ml-3 hidden text-text-3 md:inline">
                {[bild.kamera, bild.brennweite ? `${Math.round(bild.brennweite)} mm` : "", bild.blende ? `f/${bild.blende}` : "", formatiereBelichtung(bild.belichtungszeit), bild.iso ? `ISO ${bild.iso}` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
          {aktuell && (
            <div className="mr-2 hidden sm:block">
              <Sterne wert={aktuell.bewertung} onChange={(v) => aendere([aktuell.id], { bewertung: v })} />
            </div>
          )}
          <SymbolKnopf title="Rückgängig (Strg+Z)" aria-label="Rückgängig" onClick={() => schritt(-1)}>
            <Undo2 size={16} />
          </SymbolKnopf>
          <SymbolKnopf title="Wiederholen (Strg+Umschalt+Z)" aria-label="Wiederholen" onClick={() => schritt(1)}>
            <Redo2 size={16} />
          </SymbolKnopf>
          <div className="mx-1 h-5 w-px bg-linie" />
          <SymbolKnopf aktiv={vorher} title="Vorher/Nachher (\)" aria-label="Vorher/Nachher" onClick={() => setVorher(!vorher)}>
            <Columns2 size={16} />
          </SymbolKnopf>
          <SymbolKnopf aktiv={zuschneiden} title="Zuschneiden (R)" aria-label="Zuschneiden" onClick={() => setZuschneiden(!zuschneiden)}>
            <Crop size={16} />
          </SymbolKnopf>
          <button
            className={cx("zahl h-8 rounded-md px-2 text-[12px]", lupe ? "bg-licht/15 text-licht" : "text-text-2 hover:bg-white/6 hover:text-text")}
            title="1:1-Ansicht (Z)"
            onClick={() => setLupe(!lupe)}
          >
            {lupe ? "1:1" : `${Math.round(passt * (tex[0] && bild ? tex[0] / (bild.breite || tex[0]) : 1) * 100)} %`}
          </button>
          <div className="mx-1 h-5 w-px bg-linie" />
          <Knopf art="licht" onClick={() => setExportieren(true)} disabled={!bereit}>
            <Download size={14} /> Exportieren
          </Knopf>
        </div>

        <div
          ref={ansichtRef}
          className={cx("relative min-h-0 flex-1 bg-[#0e0e0e]", lupe && !zuschneiden ? "overflow-auto" : "overflow-hidden")}
        >
          <div
            className={cx("flex min-h-full min-w-full items-center justify-center", lupe && !zuschneiden ? "p-4" : "")}
            style={lupe && !zuschneiden ? { width: cssB + 32, height: cssH + 32 } : { height: "100%" }}
          >
            <div className="relative shadow-[0_6px_30px_rgba(0,0,0,0.6)]" style={{ width: cssB, height: cssH }}>
              {!bereit && bild && !fehler && (
                <img src={vorschauUrl(bild, true)} alt="" className="absolute inset-0 h-full w-full object-contain opacity-70" />
              )}
              <canvas
                ref={canvas}
                className={cx("block h-full w-full", !bereit && "invisible", !zuschneiden && (lupe ? "cursor-zoom-out" : "cursor-zoom-in"))}
                style={{ width: cssB, height: cssH }}
                onClick={(ev) => {
                  if (zuschneiden) return;
                  const r = ev.currentTarget.getBoundingClientRect();
                  const fx = (ev.clientX - r.left) / r.width;
                  const fy = (ev.clientY - r.top) / r.height;
                  setLupe((l) => {
                    if (!l)
                      requestAnimationFrame(() => {
                        const el = ansichtRef.current!;
                        el.scrollLeft = fx * el.scrollWidth - el.clientWidth / 2;
                        el.scrollTop = fy * el.scrollHeight - el.clientHeight / 2;
                      });
                    return !l;
                  });
                }}
              />
              {zuschneiden && bereit && (
                <Zuschnittebene e={e} gb={gb} gh={gh} onChange={(z) => setze({ zuschnitt: z })} onEnde={ende} />
              )}
              {vorher && <span className="absolute left-3 top-3 rounded bg-black/70 px-2 py-0.5 text-[11px] text-text">Vorher</span>}
            </div>
          </div>
          {!bereit && !fehler && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-3 py-1.5">
              <Laedt text={bild?.art === "raw" ? "Entwickle RAW …" : "Lade …"} />
            </div>
          )}
          {fehler && (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="max-w-md rounded-lg border border-gefahr/40 bg-[#2a1715] p-4 text-[13px] text-[#f3c4bd]">{fehler}</div>
            </div>
          )}
          {zuschneiden && (
            <div className="glass absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl px-3 py-2 shadow-xl">
              <select
                className="h-8 rounded-md border border-linie bg-feld px-2 text-[12px] text-text outline-none"
                value={e.seitenverhaeltnis}
                onChange={(ev) => waehleVerhaeltnis(ev.target.value)}
                aria-label="Seitenverhältnis"
              >
                {SEITENVERHAELTNISSE.map((s) => (
                  <option key={s.wert} value={s.wert}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className="w-48">
                <Regler
                  name="Winkel"
                  wert={e.winkel}
                  min={-45}
                  max={45}
                  schritt={0.1}
                  format={(v) => `${v.toFixed(1).replace(".", ",")}°`}
                  onChange={(v) => setze({ winkel: v, zuschnitt: begrenzeZuschnitt(e.zuschnitt, gb, gh, v) })}
                  onEnde={ende}
                />
              </div>
              <SymbolKnopf title="Zuschnitt zurücksetzen" onClick={() => setze({ zuschnitt: { x: 0, y: 0, b: 1, h: 1 }, winkel: 0, seitenverhaeltnis: "original" }, true)}>
                <RotateCcw size={15} />
              </SymbolKnopf>
              <Knopf art="licht" onClick={() => setZuschneiden(false)}>
                Fertig
              </Knopf>
            </div>
          )}
        </div>

        {/* Filmstreifen */}
        <div className="flex h-[84px] shrink-0 items-center gap-1.5 overflow-x-auto border-t border-linie bg-flaeche px-2">
          {bilder.map((b) => (
            <a
              key={b.id}
              href={`#/entwickeln/${b.id}`}
              ref={(el) => {
                if (el && b.id === id) el.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              className={cx(
                "flex h-[68px] w-[92px] shrink-0 items-center justify-center rounded border bg-[#121212]",
                b.id === id ? "border-licht/80" : "border-transparent opacity-60 hover:opacity-100",
              )}
              title={b.name}
            >
              <img src={miniUrl(b)} alt="" loading="lazy" className="max-h-[60px] max-w-[84px] object-contain" />
            </a>
          ))}
          {index < 0 && bilder.length === 0 && <span className="px-2 text-[12px] text-text-3">Keine weiteren Fotos</span>}
        </div>
      </div>

      {/* Regler */}
      <aside className="w-[300px] shrink-0 overflow-y-auto overflow-x-hidden border-l border-linie bg-flaeche">
        <div className="border-b border-linie p-3">
          <HistogrammAnzeige h={histo} />
        </div>
        <div className="flex items-center gap-1.5 border-b border-linie px-3 py-2.5">
          <Knopf art="rahmen" className="h-7 flex-1 px-2" onClick={auto} disabled={!bereit}>
            <Sparkles size={13} /> Automatisch
          </Knopf>
          <Knopf
            art="rahmen"
            className="h-7 flex-1 px-2"
            onClick={() =>
              frage({
                title: "Alles zurücksetzen?",
                message: "Alle Einstellungen dieses Fotos gehen auf den Ausgangszustand zurück, auch Zuschnitt und Drehung.",
                primaryActionText: "Zurücksetzen",
                onPrimaryAction: () => setze(standard(), true),
              })
            }
          >
            <RotateCcw size={13} /> Zurücksetzen
          </Knopf>
          <SymbolKnopf
            className="h-7 w-7"
            title="Einstellungen kopieren (Strg+Umschalt+C)"
            onClick={() => {
              zwischenablage = ohneGeometrie(e);
              melde("Einstellungen kopiert – mit Strg+Umschalt+V auf ein anderes Foto übertragen");
            }}
          >
            <Copy size={13} />
          </SymbolKnopf>
        </div>

        <Abschnitt titel="Grundeinstellungen">
          <div className="mb-1 text-[11px] uppercase tracking-wider text-text-3">Weißabgleich</div>
          {regler("Temperatur", "temperatur", -100, 100, { spur: "linear-gradient(90deg,#3f78d6,#9aa3ad,#e0a84a)" })}
          {regler("Tönung", "toenung", -100, 100, { spur: "linear-gradient(90deg,#3ea956,#9aa3ad,#c04fc0)" })}
          <div className="mb-1 mt-3 text-[11px] uppercase tracking-wider text-text-3">Ton</div>
          {regler("Belichtung", "belichtung", -5, 5, {
            schritt: 0.05,
            format: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")}`,
          })}
          {regler("Kontrast", "kontrast")}
          {regler("Lichter", "lichter")}
          {regler("Tiefen", "tiefen")}
          {regler("Weiß", "weiss")}
          {regler("Schwarz", "schwarz")}
          <div className="mb-1 mt-3 text-[11px] uppercase tracking-wider text-text-3">Präsenz</div>
          {regler("Klarheit", "klarheit")}
          {regler("Dunst entfernen", "dunst")}
          {regler("Dynamik", "dynamik")}
          {regler("Sättigung", "saettigung")}
        </Abschnitt>

        <Abschnitt titel="Gradationskurve" offen={false}>
          <Kurve kurven={e.kurven} histogramm={histo} onChange={(k) => setze({ kurven: k })} onEnde={ende} />
        </Abschnitt>

        <Abschnitt titel="Farbe" offen={false}>
          <div className="mb-2 flex rounded-md bg-feld p-[2px]">
            {(
              [
                ["farbton", "Farbton"],
                ["farbsaettigung", "Sättigung"],
                ["farbluminanz", "Luminanz"],
              ] as const
            ).map(([k, n]) => (
              <button
                key={k}
                className={cx("h-7 flex-1 rounded-[5px] text-[12px]", hslArt === k ? "bg-feld-hell text-text" : "text-text-2 hover:text-text")}
                onClick={() => setHslArt(k)}
              >
                {n}
              </button>
            ))}
          </div>
          {FARBBEREICHE.map((name, i) => {
            const grad = [0, 30, 60, 120, 180, 225, 270, 315][i];
            const farbe = `hsl(${grad} 70% 55%)`;
            const spur =
              hslArt === "farbton"
                ? `linear-gradient(90deg,hsl(${grad - 30} 70% 55%),${farbe},hsl(${grad + 30} 70% 55%))`
                : hslArt === "farbsaettigung"
                  ? `linear-gradient(90deg,hsl(${grad} 0% 55%),${farbe})`
                  : `linear-gradient(90deg,hsl(${grad} 70% 20%),${farbe},hsl(${grad} 70% 85%))`;
            return (
              <Regler
                key={name}
                name={name}
                wert={e[hslArt][i]}
                min={-100}
                max={100}
                spur={spur}
                onChange={(v) => setze({ [hslArt]: e[hslArt].map((x, j) => (j === i ? v : x)) })}
                onEnde={ende}
              />
            );
          })}
        </Abschnitt>

        <Abschnitt titel="Details & Effekte" offen={false}>
          {regler("Schärfen", "schaerfe", 0, 150)}
          {regler("Vignette", "vignette")}
          {regler("Körnung", "koernung", 0, 100)}
        </Abschnitt>

        <Abschnitt titel="Geometrie" offen={false}>
          <div className="mb-3 flex gap-1">
            <SymbolKnopf title="Links drehen" aria-label="Links drehen" onClick={() => drehe(-1)}>
              <RotateCcw size={15} />
            </SymbolKnopf>
            <SymbolKnopf title="Rechts drehen" aria-label="Rechts drehen" onClick={() => drehe(1)}>
              <RotateCw size={15} />
            </SymbolKnopf>
            <SymbolKnopf aktiv={e.spiegeln} title="Spiegeln" aria-label="Spiegeln" onClick={() => setze({ spiegeln: !e.spiegeln }, true)}>
              <FlipHorizontal2 size={15} />
            </SymbolKnopf>
            <Knopf art="rahmen" className="ml-auto h-8" onClick={() => setZuschneiden(true)}>
              <Crop size={13} /> Zuschneiden
            </Knopf>
          </div>
          <Regler
            name="Winkel"
            wert={e.winkel}
            min={-45}
            max={45}
            schritt={0.1}
            format={(v) => `${v.toFixed(1).replace(".", ",")}°`}
            onChange={(v) => setze({ winkel: v, zuschnitt: begrenzeZuschnitt(e.zuschnitt, gb, gh, v) })}
            onEnde={ende}
          />
          <p className="mt-2 text-[11px] text-text-3">
            Ergebnis: {tex[0] && bild ? ausgabeGroesse(bild.breite, bild.hoehe, e).join(" × ") : "–"} px
          </p>
        </Abschnitt>
        <div className="p-4 text-[11px] leading-relaxed text-text-3">
          Tasten: \ Vorher · R Zuschneiden · Z Lupe · ←/→ Foto · 0–5 Sterne · P/X Markieren · G Bibliothek
        </div>
      </aside>

      {exportieren && bild && <ExportDialog bild={bild} e={e} onSchliessen={() => setExportieren(false)} />}
      {fehler && !bild && (
        <div className="fixed inset-0 flex items-center justify-center">
          <Knopf onClick={() => (location.hash = "#/")}>
            <X size={14} /> Zurück
          </Knopf>
        </div>
      )}
    </div>
  );
}
