// Die Entwicklung laeuft ganz auf der Grafikkarte (WebGL2). Das Bild liegt
// als lineares Licht in einer Halbfloat-Textur mit Mipmaps; jeder Regler ist
// nur eine Uniform, darum reagiert alles ohne Verzoegerung.
//
// Ablauf je Bildpunkt: Geometrie (Zuschnitt, Drehung, Spiegeln) -> Schaerfe
// -> Weissabgleich und Belichtung -> Dunst -> Tonwerte (Weiss/Schwarz,
// Lichter/Tiefen, Klarheit, Kontrast) im wahrnehmungsnahen Raum, farbtreu
// ueber das Helligkeitsverhaeltnis -> sRGB -> HSL je Farbbereich -> Dynamik
// und Saettigung -> Gradationskurven -> Vignette -> Koernung.

import type { Pixel } from "../api";
import {
  BEREICH_GRAD,
  type Einstellungen,
  ausgabeGroesse,
  gedrehteGroesse,
  kurvenTabelle,
} from "./einstellungen";

const ECKE = `#version 300 es
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// 16-Bit-Ganzzahlen (sRGB-codiert) -> lineares Licht als Halbfloat
const UMWANDELN = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D uRoh;
in vec2 vUV;
out vec4 farbe;
vec3 linear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 g = textureSize(uRoh, 0);
  // Zeile 0 der Daten ist oben im Bild; in der Textur soll v=1 oben sein
  uvec3 w = texelFetch(uRoh, ivec2(p.x, g.y - 1 - p.y), 0).rgb;
  farbe = vec4(linear(vec3(w) / 65535.0), 1.0);
}`;

const ENTWICKELN = `#version 300 es
precision highp float;
uniform sampler2D uBild;
uniform sampler2D uKurve;
uniform mat3 uGeo;
uniform vec4 uKachel;      // Versatz und Groesse der Kachel im Gesamtbild (0..1)
uniform vec2 uZiel;        // Gesamtgroesse der Ausgabe in Pixeln
uniform float uLodUnschaerfe;
uniform bool uUnbearbeitet;
uniform vec3 uWB;
uniform float uKontrast, uLichter, uTiefen, uWeiss, uSchwarz, uKlarheit, uDunst;
uniform float uDynamik, uSaett, uSchaerfe, uVignette, uKorn;
uniform float uFarbton[8], uFarbSaett[8], uFarbLum[8], uGrad[8];
uniform vec3 uLeer;
in vec2 vUV;
out vec4 farbe;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float winkelAbstand(float a, float b) {
  float d = mod(a - b + 540.0, 360.0) - 180.0;
  return d;
}

float zufall(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float kontrastKurve(float x, float k) {
  const float mitte = 0.46;
  float y = clamp(x, 0.0, 1.0);
  y = y < mitte ? mitte * pow(y / mitte, k) : 1.0 - (1.0 - mitte) * pow((1.0 - y) / (1.0 - mitte), k);
  return y + (x - clamp(x, 0.0, 1.0));
}

void main() {
  // p: Position im Gesamtbild, oben links (0,0)
  vec2 p = uKachel.xy + vec2(vUV.x, 1.0 - vUV.y) * uKachel.zw;
  vec2 uv = (uGeo * vec3(p, 1.0)).xy;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    farbe = vec4(uLeer, 1.0);
    return;
  }
  // Textur: v=1 ist oben
  vec2 t = vec2(uv.x, 1.0 - uv.y);
  vec3 lin = texture(uBild, t).rgb;
  if (uUnbearbeitet) {
    farbe = vec4(srgb(lin), 1.0);
    return;
  }

  // Schaerfe: unscharfe Maske auf der Helligkeit, Radius ein Ausgabepixel
  if (uSchaerfe > 0.0) {
    vec2 dx = dFdx(t);
    vec2 dy = dFdy(t);
    float lc = dot(lin, LUMA);
    float ln = dot(texture(uBild, t + dx).rgb + texture(uBild, t - dx).rgb +
                   texture(uBild, t + dy).rgb + texture(uBild, t - dy).rgb, LUMA) * 0.25;
    float gc = pow(max(lc, 0.0), 1.0 / 2.2);
    float gn = pow(max(ln, 0.0), 1.0 / 2.2);
    float d = clamp((gc - gn) * uSchaerfe, -0.12, 0.12);
    float ziel = pow(max(gc + d, 0.0), 2.2);
    lin *= ziel / max(lc, 1.0e-5);
  }

  lin *= uWB;
  vec3 umgebung = textureLod(uBild, t, uLodUnschaerfe).rgb * uWB;

  // Dunst: abziehen, was als gleichmaessiger Schleier ueber allem liegt
  if (uDunst != 0.0) {
    float schleier = min(dot(umgebung, LUMA), 1.0);
    if (uDunst > 0.0) {
      float a = uDunst * 0.35 * schleier;
      lin = max(lin - a * 0.6, 0.0) / (1.0 - a * 0.6);
    } else {
      lin = mix(lin, vec3(schleier) * 0.9 + 0.1, -uDunst * 0.45);
    }
  }

  float L = dot(lin, LUMA);
  float g = pow(max(L, 0.0), 1.0 / 2.2);
  float gU = pow(max(dot(umgebung, LUMA), 0.0), 1.0 / 2.2);

  // Endpunkte
  float sp = -uSchwarz * 0.1;
  float wp = 1.0 - uWeiss * 0.18;
  g = (g - sp) / max(wp - sp, 0.05);

  // Lichter und Tiefen, gesteuert ueber die Umgebung, damit Flaechen
  // gleichmaessig bleiben
  float m = mix(clamp(g, 0.0, 1.2), gU, 0.6);
  float wl = smoothstep(0.4, 1.0, m);
  float wt = 1.0 - smoothstep(0.0, 0.6, m);
  g += uLichter < 0.0 ? uLichter * 0.4 * wl * g : uLichter * 0.3 * wl * (1.0 - min(g, 1.0));
  g += uTiefen > 0.0 ? uTiefen * 0.45 * wt * (1.0 - min(g, 1.0)) : uTiefen * 0.35 * wt * g;

  // Klarheit: lokaler Kontrast in den Mitteltoenen
  float mt = clamp(4.0 * m * (1.0 - m), 0.0, 1.0);
  g += uKlarheit * 0.7 * mt * (g - gU);

  g = kontrastKurve(g, 1.0 + uKontrast * (uKontrast > 0.0 ? 0.9 : 0.6));

  float L2 = pow(max(g, 0.0), 2.2);
  lin = L > 1.0e-5 ? lin * (L2 / L) : vec3(L2);
  // was ueber 1 hinausgeht, sanft in Richtung Weiss entsaettigen statt Farbe abzuschneiden
  float ueber = max(max(lin.r, max(lin.g, lin.b)) - 1.0, 0.0);
  lin = mix(lin, vec3(max(L2, 1.0)), clamp(ueber, 0.0, 1.0));

  vec3 c = srgb(lin);

  // Farbbereiche: Dreiecksgewichte ueber den Farbkreis, sie ergeben ueberall 1
  vec3 hsv = rgb2hsv(c);
  float h = hsv.x * 360.0;
  float dh = 0.0, ds = 0.0, dl = 0.0;
  for (int i = 0; i < 8; i++) {
    float vor = uGrad[(i + 7) % 8];
    float nach = uGrad[(i + 1) % 8];
    float mitte = uGrad[i];
    float d = winkelAbstand(h, mitte);
    float breite = d < 0.0 ? abs(winkelAbstand(mitte, vor)) : abs(winkelAbstand(nach, mitte));
    float w = max(0.0, 1.0 - abs(d) / breite);
    dh += w * uFarbton[i];
    ds += w * uFarbSaett[i];
    dl += w * uFarbLum[i];
  }
  if (dh != 0.0 || ds != 0.0 || dl != 0.0) {
    float chroma = hsv.y;
    hsv.x = fract(hsv.x + dh * 30.0 / 360.0);
    hsv.y = clamp(hsv.y * (1.0 + ds), 0.0, 1.0);
    c = hsv2rgb(hsv);
    c *= 1.0 + dl * 0.6 * chroma;
  }

  // Dynamik schont bereits kraeftige Farben, Saettigung wirkt gleichmaessig
  float l = dot(c, LUMA);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, 1.0 + uDynamik * (uDynamik > 0.0 ? (1.0 - sat) * 1.2 : 1.0));
  c = mix(vec3(l), c, 1.0 + uSaett);
  c = clamp(c, 0.0, 1.0);

  // Gradationskurven aus der Tabelle (1024 Stuetzstellen)
  float s = 1023.0 / 1024.0;
  float o = 0.5 / 1024.0;
  c = vec3(texture(uKurve, vec2(c.r * s + o, 0.5)).r,
           texture(uKurve, vec2(c.g * s + o, 0.5)).g,
           texture(uKurve, vec2(c.b * s + o, 0.5)).b);

  // Vignette nach dem Zuschnitt, rund auch bei schmalen Formaten
  if (uVignette != 0.0) {
    vec2 q = (p - 0.5) * 2.0;
    q *= uZiel / max(uZiel.x, uZiel.y);
    float r = length(q) / 1.2;
    float v = smoothstep(0.3, 1.05, r);
    c = uVignette < 0.0 ? c * (1.0 + uVignette * 0.85 * v) : mix(c, vec3(1.0), uVignette * 0.75 * v);
  }

  vec2 px = p * uZiel;
  if (uKorn > 0.0) {
    float korngroesse = max(1.0, max(uZiel.x, uZiel.y) / 2400.0);
    float n = zufall(floor(px / korngroesse)) - 0.5;
    float mittel = 1.0 - abs(dot(c, LUMA) - 0.5) * 1.4;
    c += n * uKorn * 0.16 * mittel;
  }
  // gegen Stufen in Verlaeufen
  c += (zufall(px + 17.0) - 0.5) / 255.0;
  farbe = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function baue(gl: WebGL2RenderingContext, ecke: string, flaeche: string): WebGLProgram {
  const shader = (art: number, quelle: string) => {
    const s = gl.createShader(art)!;
    gl.shaderSource(s, quelle);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("Shader: " + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl.VERTEX_SHADER, ecke));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, flaeche));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("Programm: " + gl.getProgramInfoLog(p));
  return p;
}

// Matrix (Spalten zuerst) von Ausgabe-Koordinaten (0..1, oben links) auf
// Quellkoordinaten (0..1, oben links).
function geometrie(e: Einstellungen, qb: number, qh: number): Float32Array {
  const [gb, gh] = gedrehteGroesse(qb, qh, e.vierteldrehung);
  const z = e.zuschnitt;
  const rad = (e.winkel * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // Ausgabe p -> gedrehter Raum in Pixeln: M = T(mitte) * R * S(groesse) * T(-0.5)
  const sb = z.b * gb;
  const sh = z.h * gh;
  const mx = (z.x + z.b / 2) * gb;
  const my = (z.y + z.h / 2) * gh;
  // als 3x3 (Zeilen): [a b tx; d e ty; 0 0 1]
  let a = c * sb,
    b = -s * sh,
    d = s * sb,
    ee = c * sh;
  let tx = mx - 0.5 * a - 0.5 * b;
  let ty = my - 0.5 * d - 0.5 * ee;
  // normieren auf 0..1 im gedrehten Raum
  a /= gb;
  b /= gb;
  tx /= gb;
  d /= gh;
  ee /= gh;
  ty /= gh;
  // spiegeln: u -> 1-u
  if (e.spiegeln) {
    a = -a;
    b = -b;
    tx = 1 - tx;
  }
  // Vierteldrehung rueckgaengig: gedreht (u,v) -> Quelle
  const k = ((e.vierteldrehung % 4) + 4) % 4;
  let r: number[];
  const zeile = (ua: number, ub: number, ut: number, va: number, vb: number, vt: number) => [ua, ub, ut, va, vb, vt];
  switch (k) {
    case 1: // Quelle = (v, 1-u)
      r = zeile(d, ee, ty, -a, -b, 1 - tx);
      break;
    case 2: // Quelle = (1-u, 1-v)
      r = zeile(-a, -b, 1 - tx, -d, -ee, 1 - ty);
      break;
    case 3: // Quelle = (1-v, u)
      r = zeile(-d, -ee, 1 - ty, a, b, tx);
      break;
    default:
      r = zeile(a, b, tx, d, ee, ty);
  }
  // Spalten zuerst fuer WebGL
  return new Float32Array([r[0], r[3], 0, r[1], r[4], 0, r[2], r[5], 1]);
}

function weissabgleich(e: Einstellungen): [number, number, number] {
  const t = e.temperatur / 100;
  const ti = e.toenung / 100;
  let r = Math.pow(2, t * 0.55);
  let g = Math.pow(2, -ti * 0.35);
  let b = Math.pow(2, -t * 0.55);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const ev = Math.pow(2, e.belichtung);
  r = (r / l) * ev;
  g = (g / l) * ev;
  b = (b / l) * ev;
  return [r, g, b];
}

export interface Histogramm {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  l: Uint32Array;
  anzahl: number;
}

export class Entwickler {
  readonly gl: WebGL2RenderingContext;
  private umwandeln: WebGLProgram;
  private entwickeln: WebGLProgram;
  private ort: Record<string, WebGLUniformLocation | null> = {};
  private bild: WebGLTexture | null = null;
  private kurve: WebGLTexture;
  private kurvenSchluessel = "";
  breite = 0;
  hoehe = 0;
  leer: [number, number, number] = [0.07, 0.07, 0.07];

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("Dieser Browser kann kein WebGL2.");
    if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float"))
      throw new Error("Der Grafikkarte fehlt EXT_color_buffer_float.");
    this.gl = gl;

    const puffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, puffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.umwandeln = baue(gl, ECKE, UMWANDELN);
    this.entwickeln = baue(gl, ECKE, ENTWICKELN);
    const namen = [
      "uBild", "uKurve", "uGeo", "uKachel", "uZiel", "uLodUnschaerfe", "uUnbearbeitet", "uWB", "uKontrast",
      "uLichter", "uTiefen", "uWeiss", "uSchwarz", "uKlarheit", "uDunst", "uDynamik", "uSaett", "uSchaerfe",
      "uVignette", "uKorn", "uFarbton", "uFarbSaett", "uFarbLum", "uGrad", "uLeer",
    ];
    for (const n of namen) this.ort[n] = gl.getUniformLocation(this.entwickeln, n);

    this.kurve = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.kurve);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  get maxGroesse(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE);
  }

  // setzeBild laedt die Bildpunkte auf die Grafikkarte.
  setzeBild(px: Pixel) {
    const gl = this.gl;
    const max = this.maxGroesse;
    if (px.breite > max || px.hoehe > max) throw new Error(`Bild größer als ${max} Pixel, das schafft diese Grafikkarte nicht.`);
    const roh = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, roh);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16UI, px.breite, px.hoehe, 0, gl.RGB_INTEGER, gl.UNSIGNED_SHORT, px.daten);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    if (this.bild) gl.deleteTexture(this.bild);
    const lin = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, lin);
    const stufen = Math.floor(Math.log2(Math.max(px.breite, px.hoehe))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, stufen, gl.RGBA16F, px.breite, px.hoehe);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lin, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Halbfloat-Ziel nicht möglich");
    gl.viewport(0, 0, px.breite, px.hoehe);
    gl.useProgram(this.umwandeln);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, roh);
    gl.uniform1i(gl.getUniformLocation(this.umwandeln, "uRoh"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(roh);

    gl.bindTexture(gl.TEXTURE_2D, lin);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.bild = lin;
    this.breite = px.breite;
    this.hoehe = px.hoehe;
  }

  get hatBild() {
    return this.bild !== null;
  }

  private setzeKurve(e: Einstellungen) {
    const schluessel = JSON.stringify(e.kurven);
    if (schluessel === this.kurvenSchluessel) return;
    this.kurvenSchluessel = schluessel;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.kurve);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1024, 1, 0, gl.RGBA, gl.FLOAT, kurvenTabelle(e.kurven));
  }

  private vorbereiten(e: Einstellungen, unbearbeitet: boolean, zielB: number, zielH: number) {
    const gl = this.gl;
    gl.useProgram(this.entwickeln);
    this.setzeKurve(e);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.bild);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.kurve);
    const o = this.ort;
    gl.uniform1i(o.uBild, 0);
    gl.uniform1i(o.uKurve, 1);
    gl.uniformMatrix3fv(o.uGeo, false, geometrie(e, this.breite, this.hoehe));
    gl.uniform2f(o.uZiel, zielB, zielH);
    gl.uniform1f(o.uLodUnschaerfe, Math.max(0, Math.log2(Math.max(this.breite, this.hoehe) / 40)));
    gl.uniform1i(o.uUnbearbeitet, unbearbeitet ? 1 : 0);
    gl.uniform3fv(o.uWB, weissabgleich(e));
    const p = (v: number) => v / 100;
    gl.uniform1f(o.uKontrast, p(e.kontrast));
    gl.uniform1f(o.uLichter, p(e.lichter));
    gl.uniform1f(o.uTiefen, p(e.tiefen));
    gl.uniform1f(o.uWeiss, p(e.weiss));
    gl.uniform1f(o.uSchwarz, p(e.schwarz));
    gl.uniform1f(o.uKlarheit, p(e.klarheit));
    gl.uniform1f(o.uDunst, p(e.dunst));
    gl.uniform1f(o.uDynamik, p(e.dynamik));
    gl.uniform1f(o.uSaett, p(e.saettigung));
    gl.uniform1f(o.uSchaerfe, p(e.schaerfe) * 1.6);
    gl.uniform1f(o.uVignette, p(e.vignette));
    gl.uniform1f(o.uKorn, p(e.koernung));
    gl.uniform1fv(o.uFarbton, e.farbton.map(p));
    gl.uniform1fv(o.uFarbSaett, e.farbsaettigung.map(p));
    gl.uniform1fv(o.uFarbLum, e.farbluminanz.map(p));
    gl.uniform1fv(o.uGrad, BEREICH_GRAD);
    gl.uniform3fv(o.uLeer, this.leer);
  }

  // zeichne bringt das entwickelte Bild in die Leinwand (canvas) in deren
  // aktueller Groesse.
  zeichne(e: Einstellungen, unbearbeitet = false) {
    if (!this.bild) return;
    const gl = this.gl;
    this.vorbereiten(e, unbearbeitet, this.canvas.width, this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform4f(this.ort.uKachel, 0, 0, 1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // rendere erzeugt das Ergebnis in beliebiger Groesse als RGBA-Bytes,
  // oben links beginnend. Grosse Bilder entstehen in Kacheln.
  rendere(e: Einstellungen, breite: number, hoehe: number, unbearbeitet = false): ImageData {
    const gl = this.gl;
    this.vorbereiten(e, unbearbeitet, breite, hoehe);
    const KACHEL = Math.min(2048, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const ziel = new ImageData(breite, hoehe);
    const fbo = gl.createFramebuffer();
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, KACHEL, KACHEL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
    const zeile = new Uint8Array(KACHEL * KACHEL * 4);
    for (let y0 = 0; y0 < hoehe; y0 += KACHEL) {
      for (let x0 = 0; x0 < breite; x0 += KACHEL) {
        const kb = Math.min(KACHEL, breite - x0);
        const kh = Math.min(KACHEL, hoehe - y0);
        gl.viewport(0, 0, kb, kh);
        gl.uniform4f(this.ort.uKachel, x0 / breite, y0 / hoehe, kb / breite, kh / hoehe);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.readPixels(0, 0, kb, kh, gl.RGBA, gl.UNSIGNED_BYTE, zeile);
        // readPixels liefert von unten nach oben
        for (let y = 0; y < kh; y++) {
          const quelle = (kh - 1 - y) * kb * 4;
          ziel.data.set(zeile.subarray(quelle, quelle + kb * 4), ((y0 + y) * breite + x0) * 4);
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteRenderbuffer(rb);
    return ziel;
  }

  histogramm(e: Einstellungen): Histogramm {
    const [ab, ah] = ausgabeGroesse(this.breite, this.hoehe, e);
    const f = Math.min(1, 320 / Math.max(ab, ah));
    const bild = this.rendere(e, Math.max(1, Math.round(ab * f)), Math.max(1, Math.round(ah * f)));
    const h: Histogramm = {
      r: new Uint32Array(256),
      g: new Uint32Array(256),
      b: new Uint32Array(256),
      l: new Uint32Array(256),
      anzahl: bild.width * bild.height,
    };
    const d = bild.data;
    for (let i = 0; i < d.length; i += 4) {
      h.r[d[i]]++;
      h.g[d[i + 1]]++;
      h.b[d[i + 2]]++;
      h.l[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
    }
    return h;
  }

  // freigeben gibt den Speicher auf der Grafikkarte frei. Den Kontext selbst
  // nur bei Wegwerf-Leinwaenden verwerfen: ein Canvas bekommt nach
  // loseContext keinen neuen.
  freigeben(kontextVerwerfen = false) {
    const gl = this.gl;
    if (this.bild) gl.deleteTexture(this.bild);
    this.bild = null;
    if (kontextVerwerfen) gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

// bildAlsBlob macht aus ImageData eine Datei.
export async function bildAlsBlob(bild: ImageData, typ: "image/jpeg" | "image/png" | "image/webp", qualitaet = 0.92): Promise<Blob> {
  const c = new OffscreenCanvas(bild.width, bild.height);
  c.getContext("2d")!.putImageData(bild, 0, 0);
  return c.convertToBlob({ type: typ, quality: qualitaet });
}

// Automatische Tonwerte aus dem Histogramm des unbearbeiteten Bildes.
export function automatisch(h: Histogramm): Partial<Einstellungen> {
  const quantil = (q: number) => {
    let summe = 0;
    const ziel = h.anzahl * q;
    for (let i = 0; i < 256; i++) {
      summe += h.l[i];
      if (summe >= ziel) return i / 255;
    }
    return 1;
  };
  const median = Math.max(quantil(0.5), 0.02);
  const hell = quantil(0.995);
  const dunkel = quantil(0.005);
  // Mitte auf etwa 18 % Grau bringen, in Blenden
  const ziel = 0.45;
  const belichtung = Math.max(-2, Math.min(2, Math.log2(Math.pow(ziel / median, 2.2)) * 0.6));
  const faktor = Math.pow(2, belichtung / 2.2);
  const hellNeu = Math.min(1.5, hell * faktor);
  const dunkelNeu = dunkel * faktor;
  const r = (v: number) => Math.round(Math.max(-100, Math.min(100, v)));
  return {
    belichtung: Math.round(belichtung * 100) / 100,
    weiss: r(((1 - hellNeu) / 0.18) * 100 * 0.8),
    schwarz: r((-dunkelNeu / 0.1) * 100 * 0.8),
    lichter: hellNeu > 0.98 ? r(-35 - (hellNeu - 0.98) * 100) : 0,
    tiefen: median < 0.25 ? r(30 + (0.25 - median) * 100) : 0,
    kontrast: 8,
    dynamik: 12,
  };
}
