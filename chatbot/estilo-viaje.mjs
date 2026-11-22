// estilo-viaje.mjs: estima si un perfil público de Instagram o X (Twitter) viaja más "hippie"
// (mochila, camping, naturaleza, bajo costo) o "luxury" (resorts, spa, hoteles de lujo).
//
//   obtenerPerfil('@usuario' | 'instagram:usuario' | 'x:usuario' | URL del perfil) -> perfil normalizado
//   clasificar(perfil) -> { estilo, probabilidades: { hippie, luxury }, fuente, razones }
//
// Sin GEMINI_API_KEY clasifica por palabras clave y emojis. Con la clave, además le manda a Gemini
// el texto y hasta 5 fotos del perfil, y mezcla las dos estimaciones (80% Gemini, 20% palabras clave).
//
// Uso desde la consola:  node estilo-viaje.mjs @usuario --es-mi-perfil
//
// Privacidad: solo se analiza el perfil propio, con permiso. Antes de llamar a obtenerPerfil hay que
// mostrar AVISO_CONSENTIMIENTO y esperar que la persona confirme (la consola lo pide con --es-mi-perfil).
// No se guarda nada. Las imágenes solo se bajan por https desde los CDN de Instagram y X, con tope
// de tamaño y de tiempo, para que el servidor no descargue cualquier dirección.
//
// Ojo: Instagram no tiene una API pública para esto. Se usa el mismo pedido que hace su sitio web,
// que Instagram puede bloquear (sobre todo desde servidores) o cambiar sin aviso. Para X se usa
// FxTwitter (api.fxtwitter.com), un servicio de terceros.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const IG_APP_ID = '936619743392459'; // el que usa instagram.com en el navegador
const MAX_IMAGENES = 5;
const MAX_BYTES_IMAGEN = 4 * 1024 * 1024;
const PESO_GEMINI = 0.8;
const MODELO_GEMINI = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const ESPERA_MS = 10000;

// Hosts desde los que se aceptan imágenes (siempre por https). Evita que el servidor descargue cualquier URL.
const HOSTS_IMAGEN = ['cdninstagram.com', 'fbcdn.net', 'twimg.com'];

// Rutas de los sitios que no son un usuario.
const RESERVADAS = {
  instagram: new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about', 'developer', 'legal', 'api', 'web']),
  twitter: new Set(['home', 'i', 'search', 'explore', 'notifications', 'messages', 'settings', 'intent', 'share', 'hashtag', 'compose', 'login', 'signup', 'tos', 'privacy']),
};
const PATRON = { instagram: /^[A-Za-z0-9._]{1,30}$/, twitter: /^[A-Za-z0-9_]{1,15}$/ };
const DOMINIOS = { 'instagram.com': 'instagram', 'www.instagram.com': 'instagram', 'm.instagram.com': 'instagram', 'twitter.com': 'twitter', 'www.twitter.com': 'twitter', 'mobile.twitter.com': 'twitter', 'x.com': 'twitter', 'www.x.com': 'twitter' };

function error(mensaje, status) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// ---------------------------------------------------------------- consentimiento

// Texto que hay que mostrarle a la persona antes de analizar su perfil. Solo se analiza el perfil
// propio: quien integre esto (página, agente, consola) tiene que pedir esta confirmación primero.
export const AVISO_CONSENTIMIENTO = 'juju va a leer tu perfil público (bio, foto y últimas publicaciones) para sugerirte un estilo de viaje. '
  + 'Si hay clave de Gemini, el texto y hasta 5 fotos se envían a Google para analizarlos. No se guarda nada. '
  + 'Usalo solo con tu propio perfil.';

// ---------------------------------------------------------------- entrada

export function interpretarEntrada(entrada) {
  const invalida = () => error('Escribí un usuario como @usuario, instagram:usuario, x:usuario o el link del perfil.', 400);
  if (typeof entrada !== 'string') throw invalida();
  const texto = entrada.trim();
  if (!texto) throw invalida();

  let red, usuario;
  if (/^https?:\/\//i.test(texto)) {
    let url;
    try { url = new URL(texto); } catch { throw invalida(); }
    red = DOMINIOS[url.hostname.toLowerCase()];
    const partes = url.pathname.split('/').filter(Boolean);
    if (!red || partes.length !== 1) throw invalida();
    usuario = partes[0];
  } else {
    const m = texto.match(/^(instagram|ig|twitter|x):(.*)$/i);
    if (m) {
      red = /^(instagram|ig)$/i.test(m[1]) ? 'instagram' : 'twitter';
      usuario = m[2];
    } else {
      red = 'instagram';
      usuario = texto;
    }
    usuario = usuario.replace(/^@/, '');
  }
  if (!PATRON[red].test(usuario) || RESERVADAS[red].has(usuario.toLowerCase())) throw invalida();
  return { red, usuario };
}

// ---------------------------------------------------------------- perfiles

async function pedirJSON(url, opciones, fetchFn, nombreRed) {
  let r;
  try {
    r = await fetchFn(url, { ...opciones, signal: AbortSignal.timeout(ESPERA_MS) });
  } catch {
    throw error(`No se pudo conectar con ${nombreRed}.`, 502);
  }
  if (r.status === 401 || r.status === 403 || r.status === 429) throw error(`${nombreRed} tiene el acceso bloqueado por ahora. Probá más tarde.`, 502);
  if (r.status === 404) throw error('Ese perfil no existe.', 404);
  if (!r.ok) throw error(`${nombreRed} respondió con un error (HTTP ${r.status}).`, 502);
  try {
    return await r.json();
  } catch {
    throw error(`${nombreRed} devolvió algo inesperado: probablemente tiene el acceso bloqueado.`, 502);
  }
}

const textoDe = v => (typeof v === 'string' ? v.trim() : '');
const urlDe = v => (typeof v === 'string' && v ? v : null);

// Respaldo: cuando Instagram bloquea el pedido completo (pasa seguido, sobre todo desde servidores), la página pública
// del perfil igual trae, en sus etiquetas de vista previa, el nombre y los números (seguidores, publicaciones). No trae
// la bio ni las publicaciones, así que el estilo solo sale si el nombre o el usuario lo dicen ("mochilera", "luxury").
const ENTIDADES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
const sinEntidades = t => t.replace(/&#x([0-9a-f]+);|&#(\d+);|&([a-z]+);/gi, (m, h, d, n) => (h ? String.fromCodePoint(parseInt(h, 16)) : d ? String.fromCodePoint(Number(d)) : ENTIDADES[n.toLowerCase()] ?? m));

async function perfilInstagramPublico(usuario, fetchFn) {
  const r = await fetchFn(`https://www.instagram.com/${encodeURIComponent(usuario)}/`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(ESPERA_MS) });
  if (!r.ok) return null;
  const html = (await r.text()).slice(0, 2_000_000);
  const meta = p => { const m = html.match(new RegExp(`<meta property="og:${p}" content="([^"]*)"`)); return m ? sinEntidades(m[1]) : ''; };
  const m = meta('title').match(/^(.*?)\s*\(@([A-Za-z0-9._]+)\)/);
  if (!m || m[2].toLowerCase() !== usuario.toLowerCase()) return null; // no es la página de ese perfil
  const nombre = m[1].trim() || usuario;
  // palabras del usuario pegadas ("mochilerosxelmundo"): se buscan las señales largas adentro
  const pegado = normalizar(usuario + ' ' + nombre).replace(/[^a-z0-9]+/g, '');
  const dentro = Object.values(SENALES).flatMap(s => s.palabras).filter(p => p.length >= 6 && pegado.includes(p));
  return {
    red: 'instagram', usuario, nombre, bio: '', imagenes: [meta('image')].filter(Boolean), parcial: true, origen: 'pagina',
    resumen: meta('description').split(' - ')[0].trim().slice(0, 80) || null,
    textos: [nombre, usuario.replace(/[._]+/g, ' '), [...new Set(dentro)].join(' ')].filter(Boolean),
  };
}

// Primer respaldo: el embed público del perfil (la vista que Instagram ofrece para insertar un perfil en otra página).
// Trae el nombre, los seguidores y las últimas publicaciones con su foto y su texto. No trae la bio.
async function perfilInstagramEmbed(usuario, fetchFn) {
  const r = await fetchFn(`https://www.instagram.com/${encodeURIComponent(usuario)}/embed/`, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(ESPERA_MS) });
  if (!r.ok) return null;
  const html = (await r.text()).slice(0, 3_000_000);
  const m = html.match(/"contextJSON":"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  let c;
  try { c = JSON.parse(JSON.parse(`"${m[1]}"`))?.context; } catch { return null; }
  if (!c || String(c.username || '').toLowerCase() !== usuario.toLowerCase()) return null;
  const posts = (Array.isArray(c.graphql_media) ? c.graphql_media : []).map(x => x?.shortcode_media).filter(Boolean);
  if (!posts.length) return null; // privado o sin publicaciones: sigue el otro respaldo
  const nombre = textoDe(c.full_name) || usuario;
  const leyendas = posts.map(n => textoDe(n.edge_media_to_caption?.edges?.[0]?.node?.text)).filter(Boolean);
  return {
    red: 'instagram', usuario, nombre, bio: '', origen: 'embed',
    resumen: [Number.isFinite(c.followers_count) ? `${c.followers_count} seguidores` : '', Number.isFinite(c.posts_count) ? `${c.posts_count} publicaciones` : ''].filter(Boolean).join(', ') || null,
    // las fotos de las publicaciones, en el tamaño más chico que ofrece Instagram (640 px de ancho)
    imagenes: posts.map(n => urlDe(n.display_resources?.[0]?.src) || urlDe(n.display_url)).filter(Boolean),
    textos: [nombre, ...leyendas].filter(Boolean),
  };
}

async function perfilInstagram(usuario, fetchFn) {
  try {
    return await perfilInstagramCompleto(usuario, fetchFn);
  } catch (e) {
    if (e.status !== 502 && e.status !== 404) throw e; // bloqueado, o un 404 que Instagram también da cuando bloquea
    const embed = await perfilInstagramEmbed(usuario, fetchFn).catch(() => null);
    if (embed) return embed;
    const publico = await perfilInstagramPublico(usuario, fetchFn).catch(() => null);
    if (publico) return publico;
    throw e;
  }
}

async function perfilInstagramCompleto(usuario, fetchFn) {
  const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(usuario)}`;
  const d = await pedirJSON(url, { headers: { 'x-ig-app-id': IG_APP_ID, accept: 'application/json' } }, fetchFn, 'Instagram');
  const u = d?.data?.user;
  if (!u || typeof u !== 'object') throw error('Ese perfil no existe o Instagram tiene el acceso bloqueado.', 404);
  if (u.is_private) throw error('Ese perfil es privado: no se pueden ver sus publicaciones.', 403);
  const bio = textoDe(u.biography);
  const posts = (u.edge_owner_to_timeline_media?.edges || []).map(e => e?.node).filter(Boolean);
  const leyendas = posts.map(n => textoDe(n.edge_media_to_caption?.edges?.[0]?.node?.text)).filter(Boolean);
  return {
    red: 'instagram',
    usuario,
    nombre: textoDe(u.full_name) || usuario,
    bio,
    imagenes: [urlDe(u.profile_pic_url_hd) || urlDe(u.profile_pic_url), ...posts.map(n => urlDe(n.display_url))].filter(Boolean),
    textos: [bio, ...leyendas].filter(Boolean),
  };
}

async function perfilTwitter(usuario, fetchFn) {
  const d = await pedirJSON(`https://api.fxtwitter.com/${encodeURIComponent(usuario)}`, { headers: { accept: 'application/json' } }, fetchFn, 'X');
  const u = d?.user;
  if (!u || typeof u !== 'object' || (d.code && d.code !== 200)) throw error('Ese perfil no existe o X tiene el acceso bloqueado.', 404);
  if (u.protected) throw error('Ese perfil es privado: no se pueden ver sus publicaciones.', 403);
  const bio = textoDe(u.description);
  return {
    red: 'twitter',
    usuario,
    nombre: textoDe(u.name) || usuario,
    bio,
    imagenes: [urlDe(u.avatar_url), urlDe(u.banner_url)].filter(Boolean),
    textos: [bio].filter(Boolean),
  };
}

export async function obtenerPerfil(entrada, { fetch: fetchFn = globalThis.fetch } = {}) {
  const { red, usuario } = interpretarEntrada(entrada);
  return red === 'instagram' ? perfilInstagram(usuario, fetchFn) : perfilTwitter(usuario, fetchFn);
}

// ---------------------------------------------------------------- palabras clave

const SENALES = {
  hippie: {
    palabras: ['mochilero', 'mochilera', 'mochileros', 'mochila', 'backpacker', 'backpacking', 'camping', 'acampar', 'carpa', 'hiking', 'trekking', 'senderismo', 'hostel', 'hostal', 'ecologico', 'ecologica', 'eco', 'sustentable', 'sostenible', 'vegano', 'vegana', 'yoga', 'artesanal', 'naturaleza', 'nature', 'aventura', 'adventure', 'budget', 'lowcost', 'vanlife', 'autostop', 'hitchhiking', 'montana', 'mountains', 'outdoors'],
    frases: ['a dedo', 'low cost', 'van life', 'bajo costo'],
    emojis: ['🎒', '🌿', '⛺', '🏕', '🌱', '🍃', '🥾', '🌄', '✌'],
  },
  luxury: {
    palabras: ['lujo', 'lujoso', 'lujosa', 'luxury', 'resort', 'resorts', 'yacht', 'yate', 'spa', 'suite', 'vip', 'gourmet', 'champagne', 'champan', 'premium', 'boutique', 'glamping', 'villa', 'concierge', 'michelin', 'jet'],
    frases: ['5 estrellas', 'cinco estrellas', 'five star', '5 star', 'primera clase', 'first class', 'business class', 'jet privado', 'private jet'],
    emojis: ['💎', '🥂', '🍾', '🛥', '💅', '⌚', '🛎'],
  },
};

const normalizar = t => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

function contarSenales(perfil) {
  const crudo = [perfil?.bio, ...(Array.isArray(perfil?.textos) ? perfil.textos : [])].filter(t => typeof t === 'string').join(' \n ');
  const texto = normalizar(crudo);
  const palabras = texto.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const plano = ` ${palabras.join(' ')} `;
  const resultado = {};
  for (const [estilo, s] of Object.entries(SENALES)) {
    const halladas = [];
    for (const p of palabras) if (s.palabras.includes(p)) halladas.push(p);
    for (const f of s.frases) if (plano.includes(` ${f} `)) halladas.push(f);
    for (const e of s.emojis) for (const _ of crudo.matchAll(new RegExp(e, 'gu'))) halladas.push(e);
    resultado[estilo] = halladas;
  }
  return resultado;
}

export function clasificarPorPalabras(perfil) {
  const { hippie, luxury } = contarSenales(perfil);
  const total = hippie.length + luxury.length;
  // Suavizado de Laplace: sin señales queda 50/50, y una sola palabra no da certeza total.
  const ph = total ? (hippie.length + 1) / (total + 2) : 0.5;
  const razones = [];
  if (hippie.length) razones.push(`Señales mochileras: ${[...new Set(hippie)].join(', ')}`);
  if (luxury.length) razones.push(`Señales de lujo: ${[...new Set(luxury)].join(', ')}`);
  return { hippie: ph, luxury: 1 - ph, razones };
}

// ---------------------------------------------------------------- Gemini

function imagenPermitida(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && HOSTS_IMAGEN.some(h => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

async function bajarImagen(url, fetchFn) {
  try {
    const r = await fetchFn(url, { signal: AbortSignal.timeout(ESPERA_MS) });
    if (!r.ok) return null;
    const tipo = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!tipo.startsWith('image/')) return null;
    if (Number(r.headers.get('content-length')) > MAX_BYTES_IMAGEN) return null;
    const datos = Buffer.from(await r.arrayBuffer());
    if (!datos.length || datos.length > MAX_BYTES_IMAGEN) return null;
    return { inlineData: { mimeType: tipo, data: datos.toString('base64') } };
  } catch {
    return null; // una imagen que falla no frena la clasificación
  }
}

const PROMPT = `Sos un analista de turismo. Mirá el perfil de redes sociales (los textos de las publicaciones y hasta 5 fotos) y clasificá el estilo de viaje de la persona en uno de tres:
- low cost ("hippie"): mochila, camping, hostels, naturaleza, bajo presupuesto, experiencias sencillas.
- fancy ("luxury"): hoteles de lujo, resorts, spa, gastronomía gourmet, comodidad y servicio.
- neutral: no se ve una preferencia clara, o hay de las dos cosas.
Respondé SOLO con JSON: {"hippie": número entre 0 y 1, "luxury": número entre 0 y 1, "razones": ["frase corta en español", ...]}. Las dos probabilidades suman 1; para neutral poné las dos cerca de 0.5. En "razones" poné 2 o 3 frases cortas con lo que se ve en las fotos y los textos. Basate solo en eso: no supongas nada por el nombre, el género, la edad ni el aspecto de la persona.`;

function leerJSONGemini(texto) {
  const limpio = String(texto || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let d;
  try { d = JSON.parse(limpio); } catch { throw error('Gemini devolvió una respuesta inválida (no es JSON).', 502); }
  const valido = d && typeof d === 'object'
    && [d.hippie, d.luxury].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
    && d.hippie + d.luxury > 0
    && Array.isArray(d.razones) && d.razones.every(r => typeof r === 'string');
  if (!valido) throw error('Gemini devolvió una respuesta inválida.', 502);
  const suma = d.hippie + d.luxury;
  return { hippie: d.hippie / suma, luxury: d.luxury / suma, razones: d.razones };
}

// El modelo es Gemini 3.8 Flash (o el de GEMINI_MODEL). Los nombres cambian, se retiran, y a veces un modelo está saturado
// (HTTP 503): en esos casos se le pregunta a la API qué modelos tiene la clave y se prueba con los Flash estables más
// parecidos, del más nuevo al más viejo. El que respondió queda para los pedidos siguientes.
const REINTENTAR_CON_OTRO = new Set([404, 429, 500, 503]);
const API_GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
let modeloElegido = null;
let modelosVistos = null; // lo que devolvió la lista de modelos la última vez que hizo falta consultarla
export const modeloGeminiEnUso = () => modeloElegido;
export const modelosGeminiVistos = () => modelosVistos;
async function modelosDisponibles(apiKey, fetchFn) {
  try {
    const r = await fetchFn(`${API_GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(ESPERA_MS) });
    if (!r.ok) return [];
    const d = await r.json();
    return (Array.isArray(d?.models) ? d.models : []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name || '').replace(/^models\//, ''));
  } catch {
    return [];
  }
}
export function ordenModelos(nombres) {
  const utiles = nombres.filter(n => /^gemini-/.test(n) && !/tts|image|imagen|embedding|live|audio|native|computer|robotics|learnlm|gemma|aqa|omni|transcribe|banana/i.test(n));
  const estables = utiles.filter(n => !/preview|exp|latest/i.test(n));
  const version = n => parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
  const porVersion = lista => [...lista].sort((a, b) => version(b) - version(a) || a.length - b.length);
  const flash = porVersion(estables.filter(n => /flash/.test(n) && !/lite/.test(n)));
  const lite = porVersion(estables.filter(n => /flash/.test(n) && /lite/.test(n)));
  return [...new Set([...flash, ...lite, ...porVersion(estables), ...porVersion(utiles)])];
}
export const mejorModelo = nombres => ordenModelos(nombres)[0] || null;

async function clasificarConGemini(perfil, apiKey, fetchFn) {
  const urls = (Array.isArray(perfil?.imagenes) ? perfil.imagenes : []).filter(imagenPermitida).slice(0, MAX_IMAGENES);
  const imagenes = (await Promise.all(urls.map(u => bajarImagen(u, fetchFn)))).filter(Boolean);
  const descripcion = [
    `Red: ${perfil?.red || '?'}`,
    `Nombre: ${perfil?.nombre || ''}`,
    `Bio: ${perfil?.bio || ''}`,
    perfil?.resumen ? `Números del perfil: ${perfil.resumen}` : '',
    ...(Array.isArray(perfil?.textos) ? perfil.textos : []).slice(0, 12).map(t => `Publicación: ${String(t).slice(0, 500)}`),
  ].filter(Boolean).join('\n');
  const cuerpo = {
    contents: [{ parts: [{ text: `${PROMPT}\n\n${descripcion}` }, ...imagenes] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  };
  const pedir = async (modelo) => {
    try {
      return await fetchFn(`${API_GEMINI}/models/${encodeURIComponent(modelo)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(30000) });
    } catch (e) {
      throw error(`No se pudo conectar con Gemini (modelo ${modelo}: ${e?.name || 'error'}${e?.cause?.code ? ' ' + e.cause.code : ''}).`, 502);
    }
  };
  let modelo = modeloElegido || MODELO_GEMINI();
  let r = await pedir(modelo);
  if (REINTENTAR_CON_OTRO.has(r.status)) { // no existe o está saturado: se prueba con los más parecidos
    const vistos = await modelosDisponibles(apiKey, fetchFn);
    modelosVistos = vistos.filter(n => /^gemini-/.test(n)).slice(0, 60);
    const probados = new Set([modelo]);
    for (const otro of ordenModelos(vistos).filter(n => !probados.has(n)).slice(0, 3)) {
      probados.add(otro); modelo = otro; r = await pedir(otro);
      if (!REINTENTAR_CON_OTRO.has(r.status)) break;
    }
  }
  if (!r.ok) {
    const detalle = await r.json?.().then(d => String(d?.error?.message || '').slice(0, 160), () => '').catch(() => '') || '';
    throw error(`Gemini respondió con un error (HTTP ${r.status}${detalle ? `: ${detalle}` : ''}, modelo ${modelo}).`, 502);
  }
  modeloElegido = modelo;
  let d;
  try { d = await r.json(); } catch { throw error('Gemini devolvió una respuesta inválida.', 502); }
  const texto = (d?.candidates?.[0]?.content?.parts || []).map(p => p?.text || '').join('');
  return { ...leerJSONGemini(texto), modelo, fotos: imagenes.length };
}

// ---------------------------------------------------------------- clasificación

// El resultado para la página y el agente, siempre uno de tres: 'fancy', 'low_cost' o 'neutral' (ninguno llega al 60%).
export const UMBRAL_ESTILO = 0.6;
export const estiloDeViaje = ({ hippie, luxury }) => (luxury >= UMBRAL_ESTILO ? 'fancy' : hippie >= UMBRAL_ESTILO ? 'low_cost' : 'neutral');

// La clave de Google AI Studio: GEMINI_API_KEY o, como está cargada en Railway, GA.
export const claveGemini = () => process.env.GEMINI_API_KEY || process.env.GA || '';

export async function clasificar(perfil, { apiKey = claveGemini(), fetch: fetchFn = globalThis.fetch } = {}) {
  const palabras = clasificarPorPalabras(perfil);
  let probabilidades = { hippie: palabras.hippie, luxury: palabras.luxury };
  let razones = palabras.razones;
  let fuente = 'palabras-clave';
  let modelo, fotos = 0;
  if (apiKey) {
    const g = await clasificarConGemini(perfil, apiKey, fetchFn);
    const hippie = PESO_GEMINI * g.hippie + (1 - PESO_GEMINI) * palabras.hippie;
    probabilidades = { hippie, luxury: 1 - hippie };
    razones = [...g.razones, ...palabras.razones];
    fuente = 'gemini+palabras-clave';
    modelo = g.modelo; fotos = g.fotos;
  }
  const estilo = probabilidades.hippie === probabilidades.luxury ? 'neutral' : probabilidades.hippie > probabilidades.luxury ? 'hippie' : 'luxury';
  return { estilo, probabilidades, fuente, razones, ...(modelo ? { modelo, fotos } : {}) };
}

// ---------------------------------------------------------------- consola

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const env = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
  if (existsSync(env)) process.loadEnvFile(env);
  const args = process.argv.slice(2);
  const entrada = args.find(a => !a.startsWith('--'));
  if (!entrada) {
    console.error('Uso: node estilo-viaje.mjs @usuario --es-mi-perfil   (también instagram:usuario, x:usuario o el link del perfil)');
    process.exit(1);
  }
  if (!args.includes('--es-mi-perfil')) {
    console.error(AVISO_CONSENTIMIENTO + '\nSi es tu perfil y estás de acuerdo, volvé a correrlo con --es-mi-perfil.');
    process.exit(1);
  }
  try {
    const perfil = await obtenerPerfil(entrada);
    const r = await clasificar(perfil);
    console.log(JSON.stringify({ perfil: { red: perfil.red, usuario: perfil.usuario, nombre: perfil.nombre }, ...r }, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
