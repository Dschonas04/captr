// Was sich an einem Bild einstellen laesst. Alles ist zerstoerungsfrei: der
// Dienst speichert nur diese Werte, das Original bleibt unberuehrt.

export type Punkt = [number, number]; // x, y jeweils 0..1

export interface Kurven {
  rgb: Punkt[];
  r: Punkt[];
  g: Punkt[];
  b: Punkt[];
}

export const FARBBEREICHE = ["Rot", "Orange", "Gelb", "Grün", "Aquamarin", "Blau", "Lila", "Magenta"] as const;
// Mitte jedes Bereichs auf dem Farbkreis, in Grad
export const BEREICH_GRAD = [0, 30, 60, 120, 180, 225, 270, 315];

export interface Zuschnitt {
  x: number; // links oben, 0..1 im gedrehten Bild
  y: number;
  b: number;
  h: number;
}

export interface Einstellungen {
  temperatur: number; // -100..100
  toenung: number; // -100..100
  belichtung: number; // -5..5 Blenden
  kontrast: number; // -100..100
  lichter: number;
  tiefen: number;
  weiss: number;
  schwarz: number;
  klarheit: number;
  dunst: number;
  dynamik: number;
  saettigung: number;
  farbton: number[]; // 8 Bereiche, -100..100
  farbsaettigung: number[];
  farbluminanz: number[];
  kurven: Kurven;
  schaerfe: number; // 0..150
  vignette: number; // -100..100
  koernung: number; // 0..100
  // Geometrie
  vierteldrehung: number; // 0..3, im Uhrzeigersinn
  spiegeln: boolean;
  winkel: number; // -45..45 Grad
  zuschnitt: Zuschnitt;
  seitenverhaeltnis: string; // "frei", "original", "1:1", "4:5", ...
}

const linie = (): Punkt[] => [
  [0, 0],
  [1, 1],
];

export function standard(): Einstellungen {
  return {
    temperatur: 0,
    toenung: 0,
    belichtung: 0,
    kontrast: 0,
    lichter: 0,
    tiefen: 0,
    weiss: 0,
    schwarz: 0,
    klarheit: 0,
    dunst: 0,
    dynamik: 0,
    saettigung: 0,
    farbton: Array(8).fill(0),
    farbsaettigung: Array(8).fill(0),
    farbluminanz: Array(8).fill(0),
    kurven: { rgb: linie(), r: linie(), g: linie(), b: linie() },
    schaerfe: 25,
    vignette: 0,
    koernung: 0,
    vierteldrehung: 0,
    spiegeln: false,
    winkel: 0,
    zuschnitt: { x: 0, y: 0, b: 1, h: 1 },
    seitenverhaeltnis: "original",
  };
}

// vervollstaendige fuellt Luecken mit Standardwerten auf, damit auch alte
// oder fremde Einstellungen sicher funktionieren.
export function vervollstaendige(teil: Partial<Einstellungen> | undefined | null): Einstellungen {
  const s = standard();
  if (!teil || typeof teil !== "object") return s;
  const e = { ...s, ...teil } as Einstellungen;
  for (const k of ["farbton", "farbsaettigung", "farbluminanz"] as const) {
    const a = Array.isArray(teil[k]) ? teil[k]! : [];
    e[k] = s[k].map((v, i) => (typeof a[i] === "number" ? a[i] : v));
  }
  e.kurven = { ...s.kurven, ...(teil.kurven ?? {}) };
  e.zuschnitt = { ...s.zuschnitt, ...(teil.zuschnitt ?? {}) };
  return e;
}

export function istStandard(e: Einstellungen): boolean {
  return JSON.stringify(e) === JSON.stringify(standard());
}

// Fuer Vorlagen: nur Farbe und Ton, keine Geometrie.
export function ohneGeometrie(e: Einstellungen): Partial<Einstellungen> {
  const { vierteldrehung: _v, spiegeln: _s, winkel: _w, zuschnitt: _z, seitenverhaeltnis: _a, ...rest } = e;
  return rest;
}

// ---------- Gradationskurve ----------

// Monotone kubische Interpolation (Fritsch-Carlson): die Kurve schiesst nie
// ueber, auch wenn Punkte eng beieinander liegen.
export function kurvenFunktion(punkte: Punkt[]): (x: number) => number {
  const p = [...punkte].sort((a, b) => a[0] - b[0]);
  if (p.length < 2) return (x) => x;
  const n = p.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = p[i + 1][0] - p[i][0] || 1e-6;
    d.push((p[i + 1][1] - p[i][1]) / dx);
  }
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > p[i + 1][0]) i++;
    const h = p[i + 1][0] - p[i][0] || 1e-6;
    const t = (x - p[i][0]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * p[i][1] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * p[i + 1][1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

// Tabelle fuer den Shader: 1024 Stuetzstellen, je Kanal Kanal-Kurve nach
// Gesamtkurve.
export function kurvenTabelle(k: Kurven): Float32Array {
  const N = 1024;
  const gesamt = kurvenFunktion(k.rgb);
  const kanal = [kurvenFunktion(k.r), kurvenFunktion(k.g), kurvenFunktion(k.b)];
  const t = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    const g = Math.min(1, Math.max(0, gesamt(x)));
    for (let c = 0; c < 3; c++) t[i * 4 + c] = Math.min(1, Math.max(0, kanal[c](g)));
    t[i * 4 + 3] = 1;
  }
  return t;
}

// ---------- Geometrie ----------

export const SEITENVERHAELTNISSE: { wert: string; name: string; v?: number }[] = [
  { wert: "frei", name: "Frei" },
  { wert: "original", name: "Original" },
  { wert: "1:1", name: "1 : 1", v: 1 },
  { wert: "4:5", name: "4 : 5", v: 4 / 5 },
  { wert: "5:4", name: "5 : 4", v: 5 / 4 },
  { wert: "2:3", name: "2 : 3", v: 2 / 3 },
  { wert: "3:2", name: "3 : 2", v: 3 / 2 },
  { wert: "16:9", name: "16 : 9", v: 16 / 9 },
  { wert: "9:16", name: "9 : 16", v: 9 / 16 },
];

// Groesse des Bilds nach Vierteldrehung (ohne Zuschnitt).
export function gedrehteGroesse(b: number, h: number, viertel: number): [number, number] {
  return viertel % 2 ? [h, b] : [b, h];
}

// Groesse des Ergebnisses in Pixeln.
export function ausgabeGroesse(b: number, h: number, e: Einstellungen): [number, number] {
  const [gb, gh] = gedrehteGroesse(b, h, e.vierteldrehung);
  return [Math.max(1, Math.round(gb * e.zuschnitt.b)), Math.max(1, Math.round(gh * e.zuschnitt.h))];
}

// passtHinein prueft, ob der um winkel gedrehte Zuschnitt ganz im Bild liegt.
function passtHinein(z: Zuschnitt, gb: number, gh: number, winkel: number): boolean {
  const rad = (winkel * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const mx = (z.x + z.b / 2) * gb;
  const my = (z.y + z.h / 2) * gh;
  const hb = (z.b * gb) / 2;
  const hh = (z.h * gh) / 2;
  for (const [dx, dy] of [
    [-hb, -hh],
    [hb, -hh],
    [hb, hh],
    [-hb, hh],
  ]) {
    const x = mx + dx * c - dy * s;
    const y = my + dx * s + dy * c;
    if (x < -0.5 || y < -0.5 || x > gb + 0.5 || y > gh + 0.5) return false;
  }
  return true;
}

// begrenzeZuschnitt verkleinert den Zuschnitt um seine Mitte, bis er trotz
// Drehung keine leeren Ecken zeigt -- so wie man es von Lightroom kennt.
export function begrenzeZuschnitt(z: Zuschnitt, gb: number, gh: number, winkel: number): Zuschnitt {
  const r = { ...z };
  r.b = Math.min(1, Math.max(0.02, r.b));
  r.h = Math.min(1, Math.max(0.02, r.h));
  r.x = Math.min(1 - r.b, Math.max(0, r.x));
  r.y = Math.min(1 - r.h, Math.max(0, r.y));
  if (passtHinein(r, gb, gh, winkel)) return r;
  const bei = (f: number, mx: number, my: number): Zuschnitt => ({
    b: r.b * f,
    h: r.h * f,
    x: mx - (r.b * f) / 2,
    y: my - (r.h * f) / 2,
  });
  // groesster Faktor, mit dem der Zuschnitt um die gegebene Mitte passt
  const groesster = (mx: number, my: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 28; i++) {
      const f = (lo + hi) / 2;
      if (passtHinein(bei(f, mx, my), gb, gh, winkel)) lo = f;
      else hi = f;
    }
    return lo;
  };
  const eigen = groesster(r.x + r.b / 2, r.y + r.h / 2);
  const mittig = groesster(0.5, 0.5);
  return mittig > eigen * 1.02 ? bei(mittig, 0.5, 0.5) : bei(eigen, r.x + r.b / 2, r.y + r.h / 2);
}

// Zuschnitt mit festem Seitenverhaeltnis, so gross wie moeglich, mittig.
export function zuschnittFuer(verhaeltnis: number, gb: number, gh: number): Zuschnitt {
  const bild = gb / gh;
  if (verhaeltnis > bild) {
    const h = bild / verhaeltnis;
    return { x: 0, y: (1 - h) / 2, b: 1, h };
  }
  const b = verhaeltnis / bild;
  return { x: (1 - b) / 2, y: 0, b, h: 1 };
}
