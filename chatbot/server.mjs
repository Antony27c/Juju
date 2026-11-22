// Servidor local de "juju", el chatbot guía de Jujuy. Sin dependencias: node server.mjs
// - Sirve la página (public/) y guarda la API key de ElevenLabs del lado del servidor.
// - /api/sesion entrega una URL firmada (chat de texto) o un token WebRTC (voz en vivo).
// - /api/buscar y /api/plan consultan el directorio (las llama la herramienta del agente).
// - /api/pagos crea y consulta pagos (USD / cripto).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(AQUI, '.env'))) process.loadEnvFile(path.join(AQUI, '.env'));

const { buscar, planRapido, resumen, localidadMasCercana } = await import('./datos.mjs');
const { momento } = await import('./horarios.mjs');
const pagos = await import('./pagos.mjs');
const { contexto, comoTexto } = await import('./contexto.mjs');
const conTexto = (d) => ({ ...d, texto_modelo: comoTexto(d) }); // versión compacta para el modelo

const PUERTO = Number(process.env.PUERTO) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const API = (process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io').replace(/\/$/, '');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

const agente = () => process.env.ELEVENLABS_AGENT_ID || '';
const clave = () => process.env.ELEVENLABS_API_KEY || '';

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

function catalogoTexto() {
  const e = pagos.estadoPagos();
  const ps = pagos.productos();
  if (!ps.length) return 'No hay experiencias cargadas para reservar.';
  const modo = e.proveedor === 'simulado' ? ' (modo de prueba, no se cobra de verdad)' : e.red === 'testnet' ? ' (red de prueba, no es dinero real)' : '';
  const cobro = e.proveedor === 'ninguno' || e.proveedor === 'sin_configurar'
    ? 'El cobro en línea todavía no está conectado: las experiencias se pueden mostrar, pero no cobrar ni confirmar.'
    : `Se paga con ${e.monedas.map((m) => m.etiqueta).join(' o ')}${modo}.`;
  return `Hoy es ${pagos.hoyJujuy()}. ${cobro} Experiencias (id = nombre, salida, duración, precio por persona): `
    + ps.map((p) => `${p.id} = ${[p.nombre, p.localidad && `sale de ${p.localidad}`, p.duracion, `USD ${p.precio_usd}`].filter(Boolean).join(', ')}`).join('; ') + '.';
}

async function sesion(modo) {
  if (!clave() || !agente()) return [503, { error: 'Falta configurar ELEVENLABS_API_KEY y crear el agente (node crear-agente.mjs).' }];
  const ruta = modo === 'voz' ? 'conversation/token' : 'conversation/get-signed-url';
  const r = await fetch(`${API}/v1/convai/${ruta}?agent_id=${encodeURIComponent(agente())}`, { headers: { 'xi-api-key': clave() }, signal: AbortSignal.timeout(15000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return [502, { error: `ElevenLabs respondió ${r.status}`, detalle: d }];
  return [200, {
    signedUrl: d.signed_url, conversationToken: d.token,
    variables: { fecha_hora_local: momento().etiqueta, catalogo_pagos: catalogoTexto() },
  }];
}

const PAGINA_SIMULADA = (p) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pago de prueba</title>
<body style="font:16px system-ui;max-width:420px;margin:12vh auto;padding:0 16px;text-align:center">
<p style="background:#fde68a;color:#422006;padding:8px;border-radius:8px"><b>MODO DE PRUEBA</b> — no se cobra dinero real</p>
<h2>${p.concepto.replace(/[<>&]/g, '')}</h2><p style="font-size:28px;margin:8px">${p.monto} ${p.moneda}</p><p>Estado: <b id="e">${p.estado}</b></p>
<button id="b" style="font:inherit;padding:12px 20px;border-radius:10px;border:0;background:#b4532a;color:#fff;cursor:pointer">Simular pago aprobado</button>
<script>b.onclick=async()=>{const r=await fetch('/api/pagos/${p.id}/simular',{method:'POST'});const d=await r.json();e.textContent=d.estado||'error';b.remove();document.body.insertAdjacentHTML('beforeend','<p>Listo. Ya podés volver al chat.</p>')}</script></body></html>`;

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ruta = url.pathname;
  const base = `http://${req.headers.host || `localhost:${PUERTO}`}`;
  try {
    if (ruta === '/api/estado') {
      return json(res, 200, { agente_configurado: Boolean(clave() && agente()), datos: resumen(), ahora: momento().etiqueta, pagos: pagos.estadoPagos() });
    }
    if (ruta === '/api/sesion') { const [c, o] = await sesion(url.searchParams.get('modo')); return json(res, c, o); }
    if (ruta === '/api/buscar' && req.method === 'POST') return json(res, 200, conTexto(buscar(comoJson(await cuerpo(req)))));
    if (ruta === '/api/contexto' && req.method === 'POST') return json(res, 200, contexto(comoJson(await cuerpo(req))));
    if (ruta === '/api/plan' && req.method === 'POST') return json(res, 200, conTexto(planRapido(comoJson(await cuerpo(req)))));
    if (ruta === '/api/cerca') {
      const l = localidadMasCercana(Number(url.searchParams.get('lat')), Number(url.searchParams.get('lon')));
      return json(res, 200, l && l.km < 150 ? { localidad: l.nombre, km: Math.round(l.km) } : { localidad: null });
    }
    if (ruta === '/api/productos') return json(res, 200, { ...pagos.estadoPagos(), hoy: pagos.hoyJujuy(), lista: pagos.productos() });
    if (ruta === '/api/pagos' && req.method === 'POST') {
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
    const archivo = path.normalize(path.join(pub, ruta === '/' ? 'index.html' : decodeURIComponent(ruta)));
    if (!archivo.startsWith(pub + path.sep)) { res.writeHead(403); return res.end(); }
    const datos = await readFile(archivo).catch(() => null);
    if (!datos) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(datos);
  } catch (e) {
    console.error(ruta, e);
    if (!res.headersSent) json(res, 500, { error: e.message });
  }
});

servidor.listen(PUERTO, HOST, () => {
  const r = resumen();
  console.log(`juju en http://localhost:${PUERTO}`);
  console.log(`Datos: ${r.total} registros desde ${r.origen} (${r.con_horario} con horario cargado)`);
  console.log(`ElevenLabs: ${clave() ? 'API key OK' : 'FALTA ELEVENLABS_API_KEY en .env'} · ${agente() ? 'agente ' + agente() : 'FALTA crear el agente (node crear-agente.mjs)'}`);
  console.log(`Pagos: ${JSON.stringify(pagos.estadoPagos())}`);
});
