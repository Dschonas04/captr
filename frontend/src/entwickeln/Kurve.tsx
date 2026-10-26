import { useMemo, useRef, useState } from "react";
import { cx } from "../ui";
import { kurvenFunktion, type Kurven, type Punkt } from "./einstellungen";
import type { Histogramm } from "./gpu";

type Kanal = keyof Kurven;

const KANAELE: { k: Kanal; name: string; farbe: string }[] = [
  { k: "rgb", name: "RGB", farbe: "#e6e3de" },
  { k: "r", name: "Rot", farbe: "#e0665a" },
  { k: "g", name: "Grün", farbe: "#66c27a" },
  { k: "b", name: "Blau", farbe: "#5f97e6" },
];

const G = 240; // Zeichenflaeche in SVG-Einheiten

// Gradationskurve: klicken setzt einen Punkt, ziehen verschiebt, Doppelklick
// oder Herausziehen entfernt ihn. Endpunkte bleiben auf ihrer Seite.
export default function Kurve({
  kurven,
  histogramm,
  onChange,
  onEnde,
}: {
  kurven: Kurven;
  histogramm: Histogramm | null;
  onChange: (k: Kurven) => void;
  onEnde: () => void;
}) {
  const [kanal, setKanal] = useState<Kanal>("rgb");
  const svg = useRef<SVGSVGElement>(null);
  const zieht = useRef<number | null>(null);
  const punkte = kurven[kanal];
  const farbe = KANAELE.find((x) => x.k === kanal)!.farbe;

  const pfad = useMemo(() => {
    const f = kurvenFunktion(punkte);
    let d = "";
    for (let i = 0; i <= 96; i++) {
      const x = i / 96;
      const y = Math.min(1, Math.max(0, f(x)));
      d += `${i ? "L" : "M"}${(x * G).toFixed(1)},${((1 - y) * G).toFixed(1)}`;
    }
    return d;
  }, [punkte]);

  const huegel = useMemo(() => {
    if (!histogramm) return "";
    const werte = kanal === "rgb" ? histogramm.l : histogramm[kanal];
    let max = 1;
    for (let i = 2; i < 254; i++) max = Math.max(max, werte[i]);
    let d = `M0,${G}`;
    for (let i = 0; i < 256; i++) d += `L${((i / 255) * G).toFixed(1)},${(G - Math.min(1, werte[i] / max) * G * 0.9).toFixed(1)}`;
    return d + `L${G},${G}Z`;
  }, [histogramm, kanal]);

  const lage = (e: React.PointerEvent): Punkt => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };

  const setze = (neu: Punkt[]) => onChange({ ...kurven, [kanal]: neu });

  const runter = (e: React.PointerEvent) => {
    const [x, y] = lage(e);
    // naechster Punkt in der Naehe?
    let i = punkte.findIndex(([px, py]) => Math.hypot((px - x) * G, (py - y) * G) < 10);
    if (i < 0) {
      const neu = [...punkte, [x, y] as Punkt].sort((a, b) => a[0] - b[0]);
      i = neu.findIndex((p) => p[0] === x && p[1] === y);
      setze(neu);
    }
    zieht.current = i;
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const bewegen = (e: React.PointerEvent) => {
    const i = zieht.current;
    if (i === null) return;
    let [x, y] = lage(e);
    const neu = punkte.map((p) => [...p] as Punkt);
    const ende = i === 0 || i === neu.length - 1;
    if (!ende) {
      // zwischen den Nachbarn bleiben
      x = Math.min(neu[i + 1][0] - 0.01, Math.max(neu[i - 1][0] + 0.01, x));
      // weit nach oben/unten herausgezogen: entfernen
      const r = svg.current!.getBoundingClientRect();
      if (e.clientY < r.top - 24 || e.clientY > r.bottom + 24) {
        neu.splice(i, 1);
        zieht.current = null;
        setze(neu);
        return;
      }
    } else {
      x = i === 0 ? Math.min(x, neu[1][0] - 0.01) : Math.max(x, neu[i - 1][0] + 0.01);
    }
    neu[i] = [x, y];
    setze(neu);
  };

  const hoch = () => {
    if (zieht.current !== null) onEnde();
    zieht.current = null;
  };

  const doppel = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = 1 - (e.clientY - r.top) / r.height;
    const i = punkte.findIndex(([px, py]) => Math.hypot((px - x) * G, (py - y) * G) < 10);
    if (i > 0 && i < punkte.length - 1) {
      setze(punkte.filter((_, j) => j !== i));
      onEnde();
    } else if (i < 0) {
      // Doppelklick auf leere Flaeche: Kurve dieses Kanals zuruecksetzen
      setze([
        [0, 0],
        [1, 1],
      ]);
      onEnde();
    }
  };

  return (
    <div>
      <div className="mb-2 flex gap-1">
        {KANAELE.map((x) => (
          <button
            key={x.k}
            onClick={() => setKanal(x.k)}
            className={cx(
              "flex h-6 items-center gap-1.5 rounded px-2 text-[11.5px]",
              kanal === x.k ? "bg-feld-hell text-text" : "text-text-3 hover:text-text-2",
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: x.farbe }} />
            {x.name}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        viewBox={`-4 -4 ${G + 8} ${G + 8}`}
        className="aspect-square w-full touch-none select-none rounded bg-[#151515]"
        onPointerDown={runter}
        onPointerMove={bewegen}
        onPointerUp={hoch}
        onPointerCancel={hoch}
        onDoubleClick={doppel}
        aria-label="Gradationskurve"
      >
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} stroke="#2a2a2a" strokeWidth={1}>
            <line x1={t * G} y1={0} x2={t * G} y2={G} />
            <line x1={0} y1={t * G} x2={G} y2={t * G} />
          </g>
        ))}
        {huegel && <path d={huegel} fill={farbe} opacity={0.09} />}
        <line x1={0} y1={G} x2={G} y2={0} stroke="#333" strokeWidth={1} strokeDasharray="3 4" />
        <path d={pfad} fill="none" stroke={farbe} strokeWidth={1.6} />
        {punkte.map(([x, y], i) => (
          <circle key={i} cx={x * G} cy={(1 - y) * G} r={4} fill="#151515" stroke={farbe} strokeWidth={1.5} />
        ))}
      </svg>
      <p className="mt-1.5 text-[11px] text-text-3">Klicken setzt Punkte · Doppelklick entfernt · Doppelklick ins Leere setzt zurück</p>
    </div>
  );
}

export function HistogrammAnzeige({ h }: { h: Histogramm | null }) {
  const pfade = useMemo(() => {
    if (!h) return null;
    let max = 1;
    for (const k of ["r", "g", "b"] as const) for (let i = 1; i < 255; i++) max = Math.max(max, h[k][i]);
    const pfad = (w: Uint32Array) => {
      let d = "M0,100";
      for (let i = 0; i < 256; i++) d += `L${((i / 255) * 256).toFixed(1)},${(100 - Math.min(1, Math.sqrt(w[i] / max)) * 96).toFixed(1)}`;
      return d + "L256,100Z";
    };
    const anteil = (n: number) => n / h.anzahl;
    const tiefen = anteil(h.l[0]);
    const lichter = anteil(h.r[255] + h.g[255] + h.b[255]) / 3;
    return { r: pfad(h.r), g: pfad(h.g), b: pfad(h.b), tiefen, lichter };
  }, [h]);
  return (
    <div className="relative h-[100px] w-full overflow-hidden rounded bg-[#151515]">
      {pfade && (
        <svg viewBox="0 0 256 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ mixBlendMode: "screen" }}>
          <path d={pfade.r} fill="#d4493d" opacity={0.75} style={{ mixBlendMode: "screen" }} />
          <path d={pfade.g} fill="#3ea956" opacity={0.75} style={{ mixBlendMode: "screen" }} />
          <path d={pfade.b} fill="#3f78d6" opacity={0.75} style={{ mixBlendMode: "screen" }} />
        </svg>
      )}
      {pfade && pfade.tiefen > 0.004 && <span className="absolute left-1 top-1 h-2 w-2 rounded-sm bg-[#4f8fd9]" title="Tiefen abgeschnitten" />}
      {pfade && pfade.lichter > 0.004 && <span className="absolute right-1 top-1 h-2 w-2 rounded-sm bg-white" title="Lichter abgeschnitten" />}
    </div>
  );
}
