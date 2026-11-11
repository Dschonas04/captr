// Schnittstelle zum Captr-Dienst.

import type { Einstellungen } from "./entwickeln/einstellungen";

export type Art = "raw" | "jpeg" | "png" | "tiff" | "webp" | "heic" | "gif" | "bmp";
export type Farbe = "" | "rot" | "gelb" | "gruen" | "blau" | "lila";

export interface Bild {
  id: string;
  name: string;
  art: Art;
  bytes: number;
  breite: number;
  hoehe: number;
  aufgenommen: string;
  kamera: string;
  objektiv: string;
  iso: number;
  blende: number;
  belichtungszeit: number;
  brennweite: number;
  bewertung: number;
  markierung: -1 | 0 | 1;
  farbe: Farbe;
  einstellungen: Partial<Einstellungen>;
  bearbeitet: boolean;
  angelegt: string;
  geaendert: string;
}

export interface Leinwand {
  id: string;
  name: string;
  breite: number;
  hoehe: number;
  szene?: string;
  angelegt: string;
  geaendert: string;
}

export interface Vorlage {
  id: string;
  name: string;
  einstellungen: Partial<Einstellungen>;
  angelegt: string;
}

export interface Status {
  kennwort: boolean;
  angemeldet: boolean;
  freistellen: boolean;
}

export class ApiFehler extends Error {
  constructor(
    public status: number,
    text: string,
  ) {
    super(text);
  }
}

async function anfrage<T>(weg: string, init?: RequestInit): Promise<T> {
  const res = await fetch(weg, { credentials: "same-origin", ...init });
  if (!res.ok) {
    let text = res.statusText;
    try {
      const j = await res.json();
      if (res.status === 401 && typeof j.sso === "string") {
        location.href = j.sso + "?ziel=" + encodeURIComponent("/" + location.hash);
      }
      text = typeof j.fehler === "string" ? j.fehler : Array.isArray(j.fehler) ? j.fehler.join(", ") : text;
    } catch {
      /* kein JSON */
    }
    if (res.status === 401) window.dispatchEvent(new Event("captr:anmelden"));
    throw new ApiFehler(res.status, text);
  }
  return res.json() as Promise<T>;
}

const json = (methode: string, wert: unknown): RequestInit => ({
  method: methode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(wert),
});

export interface Filter {
  bewertung?: number;
  markierung?: "" | "ausgewaehlt" | "abgelehnt" | "ohne-abgelehnte";
  art?: "" | "raw";
  farbe?: Farbe;
  suche?: string;
  ordnung?: "aufgenommen" | "angelegt" | "name" | "bewertung";
}

export const api = {
  status: () => anfrage<Status>("/api/status"),
  anmelden: (kennwort: string) => anfrage<{ ok: boolean }>("/api/anmelden", json("POST", { kennwort })),

  bilder: (f: Filter = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
    return anfrage<Bild[]>("/api/bilder?" + q);
  },
  bild: (id: string) => anfrage<Bild>(`/api/bilder/${id}`),
  aendern: (id: string, ae: Partial<Pick<Bild, "name" | "bewertung" | "markierung" | "farbe" | "einstellungen" | "bearbeitet">>) =>
    anfrage<Bild>(`/api/bilder/${id}`, json("PATCH", ae)),
  loeschen: (id: string) => anfrage<{ ok: boolean }>(`/api/bilder/${id}`, { method: "DELETE" }),
  setzeVorschau: (id: string, art: "mini" | "vorschau", jpeg: Blob) =>
    anfrage<{ ok: boolean }>(`/api/bilder/${id}/${art}`, { method: "PUT", body: jpeg, headers: { "Content-Type": "image/jpeg" } }),

  freistellen: (bild: Blob) =>
    anfrage<{ id: string; url: string }>("/api/freistellen", { method: "POST", body: bild, headers: { "Content-Type": bild.type || "image/png" } }),

  leinwaende: () => anfrage<Leinwand[]>("/api/leinwaende"),
  leinwand: (id: string) => anfrage<Leinwand>(`/api/leinwaende/${id}`),
  leinwandAnlegen: (l: Pick<Leinwand, "name" | "breite" | "hoehe"> & { szene?: string }) =>
    anfrage<Leinwand>("/api/leinwaende", json("POST", l)),
  leinwandSpeichern: (l: Pick<Leinwand, "id" | "name" | "breite" | "hoehe" | "szene">) =>
    anfrage<Leinwand>(`/api/leinwaende/${l.id}`, json("PUT", l)),
  leinwandLoeschen: (id: string) => anfrage<{ ok: boolean }>(`/api/leinwaende/${id}`, { method: "DELETE" }),
  leinwandVorschau: (id: string, jpeg: Blob) =>
    anfrage<{ ok: boolean }>(`/api/leinwaende/${id}/vorschau`, { method: "PUT", body: jpeg, headers: { "Content-Type": "image/jpeg" } }),

  vorlagen: () => anfrage<Vorlage[]>("/api/vorlagen"),
  vorlageAnlegen: (name: string, einstellungen: Partial<Einstellungen>) =>
    anfrage<Vorlage>("/api/vorlagen", json("POST", { name, einstellungen })),
  vorlageLoeschen: (id: string) => anfrage<{ ok: boolean }>(`/api/vorlagen/${id}`, { method: "DELETE" }),
};

export const miniUrl = (b: Bild) => `/api/bilder/${b.id}/mini?v=${encodeURIComponent(b.geaendert)}`;
export const vorschauUrl = (b: Bild, roh = false) =>
  `/api/bilder/${b.id}/vorschau?v=${encodeURIComponent(b.geaendert)}${roh ? "&roh=1" : ""}`;

export interface Hochladefortschritt {
  datei: string;
  nummer: number;
  anzahl: number;
  anteil: number; // 0..1 der aktuellen Datei
}

// Laedt Dateien einzeln hoch, damit ein kaputtes RAW nicht alle anderen
// mitreisst und der Fortschritt je Datei sichtbar ist.
export async function hochladen(
  dateien: File[],
  fortschritt: (f: Hochladefortschritt) => void,
): Promise<{ bilder: Bild[]; fehler: string[] }> {
  const bilder: Bild[] = [];
  const fehler: string[] = [];
  for (let i = 0; i < dateien.length; i++) {
    const datei = dateien[i];
    try {
      const erg = await new Promise<{ bilder: Bild[]; fehler: string[] }>((ok, nein) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/bilder");
        xhr.upload.onprogress = (e) =>
          fortschritt({ datei: datei.name, nummer: i + 1, anzahl: dateien.length, anteil: e.lengthComputable ? e.loaded / e.total : 0 });
        xhr.onload = () => {
          try {
            const j = JSON.parse(xhr.responseText);
            if (xhr.status === 401) window.dispatchEvent(new Event("captr:anmelden"));
            if (j.bilder) ok(j);
            else nein(new Error(j.fehler ?? xhr.statusText));
          } catch {
            nein(new Error(xhr.statusText || "Übertragung fehlgeschlagen"));
          }
        };
        xhr.onerror = () => nein(new Error("Übertragung fehlgeschlagen"));
        const fd = new FormData();
        fd.append("dateien", datei, datei.name);
        xhr.send(fd);
      });
      bilder.push(...erg.bilder);
      fehler.push(...erg.fehler);
    } catch (e) {
      fehler.push(`${datei.name}: ${(e as Error).message}`);
    }
  }
  return { bilder, fehler };
}

// Bildpunkte mit 16 Bit je Kanal, wie sie der Dienst liefert.
export interface Pixel {
  breite: number;
  hoehe: number;
  daten: Uint16Array;
}

export async function ladePixel(id: string, max: number, signal?: AbortSignal): Promise<Pixel> {
  const res = await fetch(`/api/bilder/${id}/pixel?max=${max}`, { signal, credentials: "same-origin" });
  if (!res.ok) {
    let text = res.statusText;
    try {
      text = (await res.json()).fehler ?? text;
    } catch {
      /* egal */
    }
    throw new ApiFehler(res.status, text);
  }
  const puffer = await res.arrayBuffer();
  const kopf = new DataView(puffer, 0, 12);
  const art = String.fromCharCode(...new Uint8Array(puffer, 0, 4));
  const breite = kopf.getUint32(4, true);
  const hoehe = kopf.getUint32(8, true);
  const n = breite * hoehe * 3;
  if (art === "CPX1") return { breite, hoehe, daten: new Uint16Array(puffer, 12, n) };
  if (art !== "CPX2" || puffer.byteLength < 12 + 2 * n) throw new Error("unbekanntes Format");
  // 12 Bit, je Zeile und Kanal als Abstand zum linken Nachbarn, hohe und tiefe Bytes getrennt
  const hoch = new Uint8Array(puffer, 12, n);
  const tief = new Uint8Array(puffer, 12 + n, n);
  const daten = new Uint16Array(n);
  const zeile = breite * 3;
  for (let y = 0; y < hoehe; y++) {
    let r = 0, g = 0, b = 0;
    for (let i = y * zeile, ende = i + zeile; i < ende; i += 3) {
      r = (r + ((hoch[i] << 8) | tief[i])) & 0xffff;
      g = (g + ((hoch[i + 1] << 8) | tief[i + 1])) & 0xffff;
      b = (b + ((hoch[i + 2] << 8) | tief[i + 2])) & 0xffff;
      daten[i] = (r << 4) | (r >> 8);
      daten[i + 1] = (g << 4) | (g >> 8);
      daten[i + 2] = (b << 4) | (b >> 8);
    }
  }
  return { breite, hoehe, daten };
}

export function formatiereBelichtung(s: number): string {
  if (!s) return "";
  if (s >= 1) return `${Math.round(s * 10) / 10} s`;
  return `1/${Math.round(1 / s)} s`;
}

export function formatiereBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function formatiereDatum(s: string): string {
  if (!s) return "";
  const d = new Date(s.length === 19 ? s : s);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------- SSO ----------

export interface SSOKonfig {
  aktiv: boolean;
  aussteller: string;
  clientId: string;
  adresse: string;
  erlaubt: string;
}
export interface SSOStand {
  einstellung: SSOKonfig;
  geheimnisDa: boolean;
  rueckweg: string;
  abmeldeweg: string;
  notaus: boolean;
}
export interface SSOStatus {
  aktiv: boolean;
  angemeldet: boolean;
  nutzer?: { name: string; nutzer: string; email: string };
}
export const sso = {
  status: () => anfrage<SSOStatus>("/api/sso/status"),
  lesen: () => anfrage<SSOStand>("/api/sso/einstellungen"),
  speichern: (k: SSOKonfig & { geheimnis: string }) =>
    anfrage<SSOStand>("/api/sso/einstellungen", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(k) }),
  testen: (aussteller: string) =>
    anfrage<{ ok: boolean; meldung: string }>("/api/sso/testen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aussteller }),
    }),
};
