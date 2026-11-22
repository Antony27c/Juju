// Servidor de "juju", la guía de Jujuy. Sin dependencias: node server.mjs
// Corre igual en la máquina local y en un hosting (Railway u otro): ahí usa PORT y escucha en 0.0.0.0.
// - Sirve la página (public/) y guarda la API key de ElevenLabs del lado del servidor.
// - /api/sesion entrega una URL firmada (chat de texto) o un token WebRTC (voz en vivo).
// - /api/buscar y /api/plan consultan el directorio (las llama la herramienta del agente).
// - /api/pagos crea y consulta pagos (USD / cripto).

import http from 'node:http';
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obtenerPerfil, clasificar, AVISO_CONSENTIMIENTO } from './estilo-viaje.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(AQUI, '.env'))) process.loadEnvFile(path.join(AQUI, '.env'));

const { buscar, planRapido, resumen, localidadMasCercana, lugarPorNombre, coincidenciaNombre } = await import('./datos.mjs');
const { momento } = await import('./horarios.mjs');
const pagos = await import('./pagos.mjs');
const { contexto, comoTexto } = await import('./contexto.mjs');
const { confirmDemoReservation } = await import('./reservas.mjs');
const conTexto = (d) => ({ ...d, texto_modelo: comoTexto(d) }); // versión compacta para el modelo

// En un hosting el puerto llega en PORT y hay que escuchar en todas las interfaces; en la máquina local, solo en 127.0.0.1.
const PUERTO = Number(process.env.PORT || process.env.PUERTO) || 3000;
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const URL_PUBLICA = (process.env.URL_PUBLICA || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')).replace(/\/$/, '');
const API = (process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io').replace(/\/$/, '');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

// Archivos de texto comprimidos (la librería de voz pesa 1,1 MB y viaja en ~170 KB). Se comprime una vez por archivo y
// por forma, y se rehace solo si el archivo cambió.
const COMPRIMIR = { br: promisify(zlib.brotliCompress), gzip: promisify(zlib.gzip) };
const comprimidos = new Map(); // 'forma archivo' → { mtimeMs, datos }
function comprimido(archivo, info, forma) {
  const clave = `${forma} ${archivo}`, hay = comprimidos.get(clave);
  if (hay?.mtimeMs === info.mtimeMs) return hay.datos;
  const datos = readFile(archivo).then((crudo) => COMPRIMIR[forma](crudo));
  comprimidos.set(clave, { mtimeMs: info.mtimeMs, datos });
  datos.catch(() => comprimidos.delete(clave));
  return datos;
}

const agente = () => process.env.ELEVENLABS_AGENT_ID || '';
const clave = () => process.env.ELEVENLABS_API_KEY || '';
// Live voice runs on a second agent in Eleven Realtime mode (speech to speech). Without it,
// voice falls back to the text agent.
const voiceAgent = () => process.env.ELEVENLABS_VOICE_AGENT_ID || '';
const realtimeModel = () => process.env.ELEVENLABS_REALTIME_MODEL || 'eleven_realtime_v1_mini';
const agentFor = (modo) => (modo === 'voz' && voiceAgent()) || agente();

// Con ELEVENLABS_API_KEY sola alcanza: al arrancar se buscan (o se crean) los agentes y sus herramientas en la cuenta
// y los ids quedan en memoria. Corre en segundo plano: el servidor atiende mientras tanto, y un error solo se registra.
// ELEVENLABS_SINCRONIZAR=off lo desactiva y usa los ids de las variables tal como están.
let preparacion = null, errorAgente = '';
// Con qué nivel de configuración aceptó ElevenLabs cada agente (3 = con detección de idioma, o sea inglés por voz).
const niveles = { texto: null, voz: null };
function prepararAgente() {
  if (!clave() || /^(off|no|0|false)$/i.test(process.env.ELEVENLABS_SINCRONIZAR || '')) return;
  const archivo = path.join(AQUI, 'agente.json');
  const tarea = (async () => {
    let ids = {};
    try {
      const { prepararAgentes } = await import('./crear-agente.mjs');
      try { if (existsSync(archivo)) ids = JSON.parse(await readFile(archivo, 'utf8')); } catch {}
      if (agente()) ids.agente = agente();
      if (voiceAgent()) ids.voice_agent = voiceAgent();
      const guardar = (x) => writeFile(archivo, JSON.stringify(x, null, 1)).catch(() => {}); // en un hosting el disco es efímero: da igual
      const { text, voice } = await prepararAgentes({ ids, guardar, log: () => {} });
      process.env.ELEVENLABS_AGENT_ID = text.id;
      if (voice) process.env.ELEVENLABS_VOICE_AGENT_ID = voice.id;
      errorAgente = '';
      niveles.texto = text.level; niveles.voz = voice ? voice.level : null;
      console.log(`ElevenLabs: agente ${text.id} ${text.action === 'created' ? 'creado' : 'actualizado'} · voz: ${voice ? `tiempo real, agente ${voice.id}` : 'con el agente de texto'}`);
    } catch (e) {
      errorAgente = String(e.message || e).slice(0, 400);
      console.error(`ElevenLabs: no pude preparar el agente. ${errorAgente}`);
      // Si el agente ya existía en la cuenta y solo falló la actualización, se usa como está.
      if (!agente() && ids.agente) process.env.ELEVENLABS_AGENT_ID = ids.agente;
      if (!voiceAgent() && ids.voice_agent) process.env.ELEVENLABS_VOICE_AGENT_ID = ids.voice_agent;
    } finally { if (preparacion === tarea) preparacion = null; }
  })();
  preparacion = tarea;
}

// El lugar a reservar tiene que existir en el directorio con ese nombre. Only a real name match counts
// (lugarPorNombre): never "the first search result", so a booking can't land on the wrong place.
const findPlace = (p = {}) => lugarPorNombre(p);

// A catalog experience the user named without producto_id ("reservame Hornocal"): only a full name match.
function findProduct(lugar) {
  if (!lugar) return null;
  return pagos.productos().find((x) => coincidenciaNombre(lugar, `${x.nombre} ${x.id.replace(/-/g, ' ')}`) === 1) || null;
}

function json(res, codigo, obj) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function cuerpo(req, max = 100_000) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > max) throw new Error('cuerpo demasiado grande'); }
  return s;
}
const comoJson = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// Tope por visitante para las rutas que gastan crédito de ElevenLabs o crean pagos: en un deploy público cualquiera puede llamarlas.
const cupos = new Map();
const TOPES = { sesion: Number(process.env.LIMITE_SESIONES) || 30, pago: Number(process.env.LIMITE_PAGOS) || 20, estilo: 15 }; // por visitante cada 10 minutos
function excedido(req, clase) {
  // The last x-forwarded-for entry is the one the hosting proxy appended (the visitor can't fake it);
  // x-real-ip can come from the visitor, so it is only a fallback.
  const ip = String(String(req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.headers['x-real-ip'] || req.socket.remoteAddress || '').trim();
  const k = `${clase}|${ip}`, ahora = Date.now(), c = cupos.get(k);
  if (!c || ahora > c.hasta) {
    if (cupos.size > 5000) for (const [kk, v] of cupos) if (ahora > v.hasta) cupos.delete(kk);
    cupos.set(k, { n: 1, hasta: ahora + 10 * 60_000 }); return false;
  }
  return ++c.n > TOPES[clase];
}
const DEMASIADO = { error: 'Demasiados pedidos seguidos. Esperá unos minutos y probá de nuevo.' };

// Estilo de viaje: lee el perfil público de Instagram (o X) que el usuario dio como propio y estima si viaja más
// low cost o más fancy. No guarda nada. Si lo leído no alcanza, estilo va en null y la página se lo pregunta.
const AVISO_ESTILO = () => (process.env.GEMINI_API_KEY ? AVISO_CONSENTIMIENTO
  : 'juju lee tu perfil público de Instagram para sugerirte un estilo de viaje. No se guarda nada. Usalo solo con tu propio perfil.');
async function estiloDePerfil({ perfil, es_mi_perfil } = {}) {
  if (es_mi_perfil !== true) return [400, { error: AVISO_ESTILO(), falta: 'consentimiento' }];
  try {
    const p = await obtenerPerfil(String(perfil || '').trim().slice(0, 200));
    let c;
    try { c = await clasificar(p); } catch (e) { console.warn('estilo: sin Gemini,', e.message); c = await clasificar(p, { apiKey: '' }); }
    const estilo = { hippie: 'low_cost', luxury: 'fancy' }[c.estilo] || null;
    return [200, {
      red: p.red, usuario: p.usuario, nombre: p.nombre, resumen: p.resumen || null, parcial: Boolean(p.parcial), estilo,
      confianza: Math.round(Math.max(c.probabilidades.hippie, c.probabilidades.luxury) * 100), fuente: c.fuente, razones: c.razones.slice(0, 3).map((r) => String(r).slice(0, 160)),
    }];
  } catch (e) {
    return [e.status >= 400 && e.status < 600 ? e.status : 502, { error: e.message }];
  }
}

// Catalog experiences the assistant books through the `reservar` tool (the payment is a demo unless Cosmos Pay is set up).
function catalogoTexto() {
  const ps = pagos.productos();
  if (!ps.length) return 'No hay experiencias cargadas para reservar.';
  return `Hoy es ${pagos.hoyJujuy()}. Experiencias (producto_id = nombre, salida, duración, precio por persona): `
    + ps.map((p) => `${p.id} = ${[p.nombre, p.localidad && `sale de ${p.localidad}`, p.duracion, `USD ${p.precio_usd}`].filter(Boolean).join(', ')}`).join('; ') + '.';
}

// clasica: la voz con el agente del chat en vez del de tiempo real (la página lo pide con ?voz=clasica)
async function sesion(modo, clasica = false) {
  if (!clave()) return [503, { error: 'Falta cargar ELEVENLABS_API_KEY en el servidor.' }];
  // si el agente todavía se está preparando, el pedido espera un rato en vez de fallar
  if (preparacion) await Promise.race([preparacion, new Promise((ok) => setTimeout(ok, 25000))]);
  if (!agente()) return [503, { error: errorAgente ? `No se pudo preparar el agente en ElevenLabs. ${errorAgente}` : 'El agente de ElevenLabs todavía se está preparando. Probá de nuevo en unos segundos.' }];
  const ruta = modo === 'voz' ? 'conversation/token' : 'conversation/get-signed-url';
  const r = await fetch(`${API}/v1/convai/${ruta}?agent_id=${encodeURIComponent(clasica ? agente() : agentFor(modo))}`, { headers: { 'xi-api-key': clave() }, signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return [502, { error: `ElevenLabs respondió ${r.status}`, detalle: d }];
  return [200, {
    signedUrl: d.signed_url, conversationToken: d.token, realtime: modo === 'voz' && !clasica && Boolean(voiceAgent()),
    // idiomas en los que se puede abrir la sesión (la página manda overrides.agent.language)
    idiomas: (modo === 'voz' && !clasica && voiceAgent() ? niveles.voz : niveles.texto) >= 3 ? ['es', 'en'] : ['es'],
    variables: { fecha_hora_local: momento().etiqueta, catalogo_pagos: catalogoTexto() },
  }];
}

// Página del pago de prueba, con los mismos colores y tipografías que juju.
const PAGINA_SIMULADA = (p) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pago de prueba · juju</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;600&family=JetBrains+Mono:wght@500&display=swap">
<style>
:root{--suelo:#f2f5f8;--papel:#fff;--tinta:#171a2b;--tenue:#5a6177;--linea:#dbe1e8;--acento:#c4175c;--sobre:#fff;--si:#1b7a4b;--pf:#ffe9a8;--pt:#3d2c00;color-scheme:light}
@media(prefers-color-scheme:dark){:root{--suelo:#0f1120;--papel:#181b30;--tinta:#eceef7;--tenue:#9aa1ba;--linea:#2a2e4a;--acento:#ff6b9d;--sobre:#1a0610;--si:#5fd39a;--pf:#4a3a08;--pt:#ffe9a8;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--suelo);color:var(--tinta);font:400 16px/1.5 Figtree,system-ui,sans-serif}
main{width:min(100%,400px);background:var(--papel);border:1px solid var(--linea);border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:12px}
.marca{font:800 26px/1 "Bricolage Grotesque",system-ui,sans-serif;letter-spacing:-.04em}
.prueba{align-self:flex-start;font:500 11px/1 "JetBrains Mono",Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;background:var(--pf);color:var(--pt);border-radius:6px;padding:5px 8px}
h1{margin:0;font:600 20px/1.25 "Bricolage Grotesque",system-ui,sans-serif;text-wrap:balance}p{margin:0;color:var(--tenue)}
.monto{font:800 34px/1 "Bricolage Grotesque",system-ui,sans-serif;letter-spacing:-.03em;color:var(--tinta)}
button{font:600 16px Figtree,system-ui,sans-serif;padding:12px;border-radius:10px;border:0;background:var(--acento);color:var(--sobre);cursor:pointer}
.ok{color:var(--si);font-weight:600}[hidden]{display:none}
</style></head><body><main>
<span class="marca">juju</span><span class="prueba">Modo de prueba · no se cobra</span>
<h1>${p.concepto.replace(/[<>&]/g, '')}</h1><p class="monto">${p.monto} ${p.moneda}</p>
<p>${p.codigo ? `Código ${p.codigo} · ` : ''}estado: <b id="e">${p.estado}</b></p>
<button id="b" type="button"${p.estado === 'pendiente' ? '' : ' hidden'}>Simular pago aprobado</button>
<p class="ok" id="f"${p.estado === 'pagado' ? '' : ' hidden'}>Listo. Ya podés volver a juju.</p>
</main><script>b.onclick=async()=>{b.disabled=true;const r=await fetch('/api/pagos/${p.id}/simular',{method:'POST'});const d=await r.json().catch(()=>({}));e.textContent=d.estado||'error';b.hidden=true;f.hidden=d.estado!=='pagado'}</script></body></html>`;

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ruta = url.pathname;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() === 'https' ? 'https' : 'http'; // detrás de un proxy llega https
  const base = URL_PUBLICA || `${proto}://${req.headers.host || `localhost:${PUERTO}`}`;
  try {
    if (ruta === '/api/estado') {
      return json(res, 200, {
        // mientras el agente se prepara cuenta como configurado: /api/sesion espera a que termine
        agente_configurado: Boolean(clave() && (agente() || preparacion)), clave_cargada: Boolean(clave()), ...(errorAgente ? { error_agente: errorAgente } : {}),
        datos: resumen(), ahora: momento().etiqueta, pagos: pagos.estadoPagos(),
        voz: { tiempo_real: Boolean(voiceAgent()), modelo: voiceAgent() ? realtimeModel() : null },
        estilo: { aviso: AVISO_ESTILO(), con_imagenes: Boolean(process.env.GEMINI_API_KEY) },
        // null = todavía no se sabe (el agente se está preparando, o no se sincronizó en este arranque)
        ingles_por_voz: { chat: niveles.texto == null ? null : niveles.texto >= 3, tiempo_real: niveles.voz == null ? null : niveles.voz >= 3 },
      });
    }
    if (ruta === '/api/estilo' && req.method === 'POST') {
      if (excedido(req, 'estilo')) return json(res, 429, DEMASIADO);
      const [c, o] = await estiloDePerfil(comoJson(await cuerpo(req))); return json(res, c, o);
    }
    if (ruta === '/api/reservas' && req.method === 'POST') {
      if (excedido(req, 'pago')) return json(res, 429, DEMASIADO);
      const p = comoJson(await cuerpo(req));
      const product = p.producto_id ? pagos.productos().find((x) => x.id === p.producto_id) || null : findProduct(p.lugar);
      if (p.producto_id && !product) return json(res, 404, { error: `no existe la experiencia "${String(p.producto_id).slice(0, 60)}" en el catálogo` });
      const place = product ? null : findPlace(p);
      if (!product && !place) return json(res, 404, { error: p.lugar ? `"${String(p.lugar).slice(0, 80)}" no figura en el directorio` : 'falta el nombre del lugar o el producto_id' });
      try { return json(res, 200, confirmDemoReservation(p, place, product, pagos.hoyJujuy())); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (ruta === '/api/sesion') { if (excedido(req, 'sesion')) return json(res, 429, DEMASIADO); const [c, o] = await sesion(url.searchParams.get('modo'), url.searchParams.get('voz') === 'clasica'); return json(res, c, o); }
    if (ruta === '/api/buscar' && req.method === 'POST') return json(res, 200, conTexto(buscar(comoJson(await cuerpo(req)))));
    if (ruta === '/api/contexto' && req.method === 'POST') return json(res, 200, contexto(comoJson(await cuerpo(req))));
    if (ruta === '/api/plan' && req.method === 'POST') return json(res, 200, conTexto(planRapido(comoJson(await cuerpo(req)))));
    if (ruta === '/api/cerca') {
      const l = localidadMasCercana(Number(url.searchParams.get('lat')), Number(url.searchParams.get('lon')));
      return json(res, 200, l && l.km < 150 ? { localidad: l.nombre, km: Math.round(l.km) } : { localidad: null });
    }
    if (ruta === '/api/productos') return json(res, 200, { ...pagos.estadoPagos(), hoy: pagos.hoyJujuy(), lista: pagos.productos() });
    if (ruta === '/api/pagos' && req.method === 'POST') {
      if (excedido(req, 'pago')) return json(res, 429, DEMASIADO);
      try { return json(res, 200, await pagos.crearPago(comoJson(await cuerpo(req)), base)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (ruta === '/api/pagos/webhook' && req.method === 'POST') {
      const r = await pagos.recibirWebhook(await cuerpo(req, 1_000_000), req.headers);
      return json(res, r.ok ? 200 : 401, r);
    }
    const mp = ruta.match(/^\/api\/pagos\/([0-9a-f-]{36})(\/simular)?$/);
    if (mp) {
      const p = mp[2] ? (req.method === 'POST' ? pagos.simularAprobacion(mp[1]) : null) : await pagos.consultarPago(mp[1]);
      return p ? json(res, 200, p) : json(res, 404, { error: 'pago no encontrado' });
    }
    if (ruta === '/pago-simulado') {
      const p = await pagos.consultarPago(url.searchParams.get('id') || '');
      if (!p || p.proveedor !== 'simulado') { res.writeHead(404); return res.end('No encontrado'); }
      res.writeHead(200, { 'Content-Type': TIPOS['.html'] });
      return res.end(PAGINA_SIMULADA(p));
    }
    if (ruta.startsWith('/api/')) return json(res, 404, { error: 'ruta desconocida' });

    // archivos estáticos (solo dentro de public/)
    const pub = path.join(AQUI, 'public');
    let pedido;
    try { pedido = ruta === '/' ? 'index.html' : decodeURIComponent(ruta); } catch { res.writeHead(400); return res.end('Dirección inválida'); }
    const archivo = path.normalize(path.join(pub, pedido));
    if (!archivo.startsWith(pub + path.sep)) { res.writeHead(403); return res.end(); }
    const info = await stat(archivo).catch(() => null);
    if (!info?.isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    const tipo = TIPOS[path.extname(archivo)] || 'application/octet-stream';
    // vendor/ lleva la versión en el nombre del archivo: el navegador lo guarda un año y no lo vuelve a pedir
    const cabeceras = { 'Content-Type': tipo, 'Cache-Control': ruta.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
    const acepta = String(req.headers['accept-encoding'] || '');
    const forma = !/^(text|application\/json|image\/svg)/.test(tipo) || info.size < 1024 ? '' : /\bbr\b/.test(acepta) ? 'br' : /\bgzip\b/.test(acepta) ? 'gzip' : '';
    if (!forma) { res.writeHead(200, cabeceras); return res.end(await readFile(archivo)); }
    res.writeHead(200, { ...cabeceras, 'Content-Encoding': forma, Vary: 'Accept-Encoding' });
    res.end(await comprimido(archivo, info, forma));
  } catch (e) {
    console.error(ruta, e);
    if (!res.headersSent) json(res, 500, { error: 'Error interno del servidor.' });
  }
});

servidor.listen(PUERTO, HOST, () => {
  const r = resumen();
  console.log(`juju escuchando en ${HOST}:${PUERTO}${URL_PUBLICA ? ` · ${URL_PUBLICA}` : HOST === '127.0.0.1' ? ` · http://localhost:${PUERTO}` : ''}`);
  console.log(`Datos: ${r.total} registros desde ${r.origen} (${r.con_horario} con horario cargado)`);
  console.log(`ElevenLabs: ${clave() ? 'API key OK' : 'FALTA ELEVENLABS_API_KEY'} · ${agente() ? 'agente ' + agente() : clave() ? 'sin id de agente: lo busco o lo creo ahora' : 'sin clave no hay agente'}`);
  console.log(`Voice: ${voiceAgent() ? `Eleven Realtime (${realtimeModel()}) on agent ${voiceAgent()}` : 'text agent (no realtime voice agent configured)'}`);
  console.log(`Pagos: ${JSON.stringify(pagos.estadoPagos())}`);
  prepararAgente();
  // la librería de voz queda comprimida desde el arranque: el primer visitante no espera esos 2 segundos
  const vendor = path.join(AQUI, 'public', 'vendor');
  readdir(vendor).then((nombres) => Promise.all(nombres.map(async (nombre) => {
    const archivo = path.join(vendor, nombre), info = await stat(archivo);
    if (info.isFile()) await Promise.all([comprimido(archivo, info, 'br'), comprimido(archivo, info, 'gzip')]);
  }))).catch(() => {});
});
