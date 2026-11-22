// Pasaporte de Jujuy: stops with signed QR codes, stamps, badges and the "what is left" route.
// - Stops live in pasaporte.json and point to directory records by id, so names, coordinates and
//   opening hours come from the directory (nothing about a place is invented here).
// - Progress lives on the tourist's phone (localStorage). The server signs and checks codes and
//   computes the passport state from the list of stamps the page sends; it stores nothing.
// - A QR holds /s/<slug>.<signature>. The signature is an HMAC with PASAPORTE_SECRETO, so a stamp
//   cannot be made up from the slug alone. Without that variable a random secret is kept in
//   .pasaporte-secreto, which is fine locally but changes on every fresh deploy (printed QRs stop working).

import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { km, registroPorId } from './datos.mjs';
import { momento, estadoHorario } from './horarios.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(path.join(HERE, 'pasaporte.json'), 'utf8'));
const GPS_RADIUS_M = Number(process.env.PASAPORTE_RADIO_M) || CONFIG.radio_gps_m || 300;
const FAR_KM = 120; // farther than this from the tourist: suggested for another day
const DEFAULT_ORIGIN = { lat: -24.1858, lon: -65.2995, nombre: 'San Salvador de Jujuy' }; // where most trips start

// ---------- stops and badges ----------
export const stops = CONFIG.paradas.map((p) => {
  const r = registroPorId(p.id);
  if (!r || typeof r.lat !== 'number' || typeof r.lon !== 'number') {
    console.warn(`Pasaporte: skipping "${p.slug}": directory record ${p.id} is missing or has no coordinates`);
    return null;
  }
  return {
    slug: p.slug, nombre: p.titulo || r.nombre, region: r.region, localidad: r.localidad,
    tema: p.tema === 'naturaleza' ? 'naturaleza' : 'cultura', aire_libre: Boolean(p.aire_libre || p.tema === 'naturaleza'),
    etiquetas: Array.isArray(p.etiquetas) ? p.etiquetas : [],
    lat: r.lat, lon: r.lon, horario: r.horario || null, descripcion: r.descripcion || null,
  };
}).filter(Boolean);
const bySlug = new Map(stops.map((s) => [s.slug, s]));
export const badges = CONFIG.insignias || [];
const REGION_COLORS = CONFIG.regiones || {};

const mapsLink = (s) => `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`;
const directionsLink = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
function publicStop(s) {
  return {
    slug: s.slug, nombre: s.nombre, region: s.region, localidad: s.localidad, tema: s.tema, etiquetas: s.etiquetas,
    lat: s.lat, lon: s.lon, descripcion: s.descripcion, color: REGION_COLORS[s.region] || 'f1',
    mapa: mapsLink(s), como_llegar: directionsLink(s),
  };
}

// ---------- signed codes ----------
let secretSource = 'env';
function loadSecret() {
  if (process.env.PASAPORTE_SECRETO) return process.env.PASAPORTE_SECRETO;
  const file = path.join(HERE, '.pasaporte-secreto');
  try { const s = readFileSync(file, 'utf8').trim(); if (s) { secretSource = 'file'; return s; } } catch {}
  const s = randomBytes(24).toString('base64url');
  try { writeFileSync(file, s); secretSource = 'file'; } catch { secretSource = 'memory'; }
  return s;
}
const SECRET = loadSecret();
if (secretSource !== 'env' && process.env.PORT) {
  console.warn('Pasaporte: PASAPORTE_SECRETO is not set. The QR codes change on every new deploy; set it before printing them.');
}

const sign = (slug) => createHmac('sha256', SECRET).update(`pasaporte:${slug}`).digest('base64url').slice(0, 12);
export const codeFor = (slug) => `${slug}.${sign(slug)}`;

/** The stop a code belongs to, or null when the code is malformed or its signature does not match. */
export function verifyCode(code) {
  const m = /^([a-z0-9-]{2,60})\.([A-Za-z0-9_-]{12})$/.exec(String(code || '').trim());
  if (!m || !bySlug.has(m[1])) return null;
  const given = Buffer.from(m[2]), expected = Buffer.from(sign(m[1]));
  return given.length === expected.length && timingSafeEqual(given, expected) ? bySlug.get(m[1]) : null;
}

// ---------- stamping ----------
const meters = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`);

/** Validates a stamp: { codigo } from a QR, or { slug, lat, lon } when the tourist is at the place. */
export function stamp({ codigo, slug, lat, lon } = {}) {
  const at = new Date().toISOString();
  if (codigo) {
    const s = verifyCode(codigo);
    return s ? { ok: true, metodo: 'qr', en: at, parada: publicStop(s) } : { ok: false, error: 'Este QR no es del Pasaporte de Jujuy o está incompleto.' };
  }
  const s = bySlug.get(slug);
  if (!s) return { ok: false, error: 'No existe esa parada del pasaporte.' };
  if (typeof lat !== 'number' || typeof lon !== 'number') return { ok: false, error: 'Para sellar sin QR hace falta tu ubicación.' };
  const m = Math.round(km(lat, lon, s.lat, s.lon) * 1000);
  if (m > GPS_RADIUS_M) return { ok: false, distancia_m: m, error: `Estás a ${meters(m)} de ${s.nombre}. Acercate a menos de ${GPS_RADIUS_M} m para sellar.` };
  return { ok: true, metodo: 'gps', en: at, parada: publicStop(s) };
}

// ---------- state: badges, what is left and what to skip now ----------
function badgeProgress(b, visited) {
  const r = b.regla || {};
  let done = 0, goal = 1;
  if (r.tipo === 'cantidad') { goal = r.n; done = visited.length; }
  else if (r.tipo === 'tema') { goal = r.n; done = visited.filter((s) => s.tema === r.tema).length; }
  else if (r.tipo === 'etiqueta') { goal = stops.filter((s) => s.etiquetas.includes(r.etiqueta)).length; done = visited.filter((s) => s.etiquetas.includes(r.etiqueta)).length; }
  else if (r.tipo === 'region') { goal = stops.filter((s) => s.region === r.region).length; done = visited.filter((s) => s.region === r.region).length; }
  else if (r.tipo === 'regiones') { goal = new Set(stops.map((s) => s.region)).size; done = new Set(visited.map((s) => s.region)).size; }
  else if (r.tipo === 'todas') { goal = stops.length; done = visited.length; }
  goal = Math.max(1, goal);
  done = Math.min(done, goal);
  return { id: b.id, nombre: b.nombre, descripcion: b.descripcion, pista: b.pista, icono: b.icono, color: b.color, hecho: done, meta: goal, ganada: done >= goal };
}

/** Whether a pending stop is a good idea right now: 'si', 'no' (closed, or outdoors at night) or 'otro_dia' (far). */
function advice(s, mom, distanceKm) {
  const h = estadoHorario(s.horario, mom);
  if (h.abierto === 'no') return { ahora: 'no', motivo: h.abre ? `Cerrado ahora, abre a las ${h.abre}` : 'Cerrado ahora' };
  if (mom.es_de_noche && s.aire_libre) return { ahora: 'no', motivo: 'De noche no conviene: es al aire libre' };
  if (distanceKm != null && distanceKm > FAR_KM) return { ahora: 'otro_dia', motivo: `Queda a ${distanceKm} km: mejor otro día` };
  if (h.abierto === 'si') return { ahora: 'si', motivo: h.cierra && h.cierra !== 'no cierra' ? `Abierto hasta las ${h.cierra}` : 'Abierto' };
  return { ahora: 'si', motivo: s.aire_libre ? 'Al aire libre: andá con luz de día' : 'Sin horario cargado: confirmá antes de ir' };
}

/** Visiting order for the pending stops: always the nearest one next, starting from the origin. */
function nearestFirst(origin, list) {
  const left = [...list], out = [];
  let at = origin;
  while (left.length) {
    let best = 0, bestKm = Infinity;
    left.forEach((s, i) => { const d = km(at.lat, at.lon, s.lat, s.lon); if (d < bestKm) { bestKm = d; best = i; } });
    const [next] = left.splice(best, 1);
    out.push(next); at = next;
  }
  return out;
}

/**
 * Passport state from the stamps the page keeps: { visitas: [{ slug, en }], lat?, lon?, hora? }.
 * Distances and the suggested route start at the tourist's location, else at the last stamp, else at San Salvador.
 */
export function passportState({ visitas = [], lat, lon, hora } = {}) {
  const mom = momento({ hora });
  const seen = new Map();
  for (const v of Array.isArray(visitas) ? visitas.slice(0, 500) : []) {
    const s = bySlug.get(v?.slug);
    if (s && !seen.has(s.slug)) seen.set(s.slug, { s, en: typeof v.en === 'string' ? v.en.slice(0, 40) : null, metodo: v.metodo === 'gps' ? 'gps' : 'qr' });
  }
  const visited = [...seen.values()].sort((a, b) => String(a.en || '').localeCompare(String(b.en || '')));
  const here = typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : null;
  const last = visited.at(-1)?.s;
  const origin = here || (last ? { lat: last.lat, lon: last.lon } : DEFAULT_ORIGIN);
  const fromLabel = here ? 'tu ubicación' : last ? last.nombre : DEFAULT_ORIGIN.nombre;

  const pending = nearestFirst(origin, stops.filter((s) => !seen.has(s.slug))).map((s, i) => {
    const d = Math.round(km(origin.lat, origin.lon, s.lat, s.lon));
    return { ...publicStop(s), orden: i + 1, distancia_km: d, ...advice(s, mom, d) };
  });
  const earned = badges.map((b) => badgeProgress(b, visited.map((v) => v.s)));
  const byRegion = {};
  for (const s of stops) {
    byRegion[s.region] ||= { region: s.region, color: REGION_COLORS[s.region] || 'f1', hechas: 0, total: 0 };
    byRegion[s.region].total += 1;
    if (seen.has(s.slug)) byRegion[s.region].hechas += 1;
  }
  const state = {
    titulo: CONFIG.titulo, momento: mom.etiqueta, es_de_noche: mom.es_de_noche, total: stops.length, sellados: visited.length,
    desde: fromLabel, radio_gps_m: GPS_RADIUS_M, regiones: Object.values(byRegion),
    visitadas: visited.map(({ s, en, metodo }) => ({ ...publicStop(s), en, metodo })),
    pendientes: pending,
    insignias: earned,
  };
  return { ...state, texto_modelo: modelText(state) };
}

function modelText(st) {
  const now = st.pendientes.filter((p) => p.ahora === 'si').slice(0, 4);
  const notNow = st.pendientes.filter((p) => p.ahora === 'no').slice(0, 3);
  const later = st.pendientes.filter((p) => p.ahora === 'otro_dia').slice(0, 3);
  const won = st.insignias.filter((b) => b.ganada).map((b) => b.nombre);
  const close = st.insignias.filter((b) => !b.ganada && b.hecho > 0).sort((a, b) => b.hecho / b.meta - a.hecho / a.meta).slice(0, 2);
  return [
    `PASAPORTE DE JUJUY del usuario: ${st.sellados} de ${st.total} sellos. Momento: ${st.momento}. Distancias en línea recta desde ${st.desde}.`,
    `Insignias ganadas: ${won.length ? won.join(', ') : 'ninguna todavía'}.` + (close.length ? ` Más cerca de ganar: ${close.map((b) => `${b.nombre} (${b.hecho} de ${b.meta})`).join(', ')}.` : ''),
    now.length ? `CONVIENE AHORA, en orden sugerido:\n${now.map((p) => `- ${p.nombre} | ${p.localidad}, ${p.region} | ${p.distancia_km} km | ${p.motivo}`).join('\n')}` : 'CONVIENE AHORA: ninguna parada pendiente conviene en este momento.',
    notNow.length ? `AHORA NO:\n${notNow.map((p) => `- ${p.nombre} | ${p.motivo}`).join('\n')}` : '',
    later.length ? `PARA OTRO DÍA: ${later.map((p) => `${p.nombre} (${p.distancia_km} km)`).join(', ')}.` : '',
    st.visitadas.length ? `YA VISITADAS: ${st.visitadas.map((v) => v.nombre).join(', ')}.` : 'Todavía no selló ninguna parada.',
    'La página del pasaporte (botón "Pasaporte") muestra el mapa con su recorrido y lo que le falta.',
  ].filter(Boolean).join('\n');
}

// ---------- HTTP ----------
/** Only the organizers may list every code: with PASAPORTE_CLAVE (?clave=), or from this same machine. */
function canListCodes(req, url) {
  const key = process.env.PASAPORTE_CLAVE || '';
  if (key) {
    const given = Buffer.from(url.searchParams.get('clave') || ''), expected = Buffer.from(key);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
  const ip = req.socket.remoteAddress || '';
  return !req.headers['x-forwarded-for'] && /^(127\.|::1$|::ffff:127\.)/.test(ip);
}

/** Routes of the passport. Returns true when it answered the request. */
export async function handlePasaporte(req, res, { url, base, json, readBody, asJson }) {
  const p = url.pathname;
  if (p === '/pasaporte' || p === '/qr') { res.writeHead(302, { Location: `${p}.html${url.search}` }); res.end(); return true; }
  const short = p.match(/^\/s\/([A-Za-z0-9._-]{4,80})$/); // what the QR opens
  if (short) { res.writeHead(302, { Location: `/pasaporte.html?sello=${encodeURIComponent(short[1])}` }); res.end(); return true; }
  if (!p.startsWith('/api/pasaporte')) return false;

  if (p === '/api/pasaporte/sello' && req.method === 'POST') {
    const r = stamp(asJson(await readBody(req)));
    json(res, r.ok ? 200 : 400, r); return true;
  }
  if (p === '/api/pasaporte/estado' && req.method === 'POST') { json(res, 200, passportState(asJson(await readBody(req)))); return true; }
  if (p === '/api/pasaporte/qr') {
    if (!canListCodes(req, url)) {
      json(res, 403, { error: 'Los QR solo se ven desde el servidor o con la clave de organizador: configurá PASAPORTE_CLAVE y abrí /qr.html?clave=...' });
      return true;
    }
    json(res, 200, {
      titulo: CONFIG.titulo, base, secreto_fijo: secretSource === 'env',
      paradas: stops.map((s) => ({ ...publicStop(s), codigo: codeFor(s.slug), url: `${base}/s/${codeFor(s.slug)}` })),
    });
    return true;
  }
  json(res, 404, { error: 'ruta desconocida' }); return true;
}
