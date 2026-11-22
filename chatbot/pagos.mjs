// Pagos en USD o cripto.
// - Los precios salen SIEMPRE de productos.json (el modelo de IA no puede fijar montos).
// - Proveedor "simulado": flujo de prueba, no mueve dinero.
// - Proveedor "cosmospay": adaptador HTTP genérico que se completa en cosmospay.config.json
//   con los datos de la documentación oficial (URL base, rutas, nombres de campos).
//   No hay ninguna ruta ni campo de CosmosPay escrito de memoria en este archivo.
// - Un webhook nunca se da por bueno solo: se verifica la firma (si está configurada)
//   y además se vuelve a consultar el estado del pago al proveedor.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const leer = (f, def) => { try { return JSON.parse(readFileSync(path.join(AQUI, f), 'utf8').replace(/^﻿/, '')); } catch { return def; } };
const ARCHIVO = path.join(AQUI, 'pagos.json');

const cfg = () => leer('cosmospay.config.json', {});
export const productos = () => (leer('productos.json', { productos: [] }).productos || []).filter((p) => p.id && p.precio_usd > 0);
const monedas = () => (process.env.PAGO_MONEDAS || 'USD,USDT').split(',').map((m) => m.trim().toUpperCase()).filter(Boolean);

function cosmosListo() {
  const c = cfg();
  return Boolean(process.env.COSMOSPAY_API_KEY && c.base_url && c.crear_pago?.ruta && (c.crear_pago?.respuesta?.url_pago || c.crear_pago?.respuesta?.direccion));
}

export function proveedor() {
  const pedido = (process.env.PAGOS_PROVEEDOR || '').toLowerCase();
  if (pedido === 'cosmospay') return cosmosListo() ? 'cosmospay' : 'sin_configurar';
  if (pedido === 'simulado') return 'simulado';
  return cosmosListo() ? 'cosmospay' : 'ninguno';
}

export const estadoPagos = () => ({
  proveedor: proveedor(), monedas: monedas(), productos: productos().length,
  falta: proveedor() === 'sin_configurar' ? 'Completar cosmospay.config.json y COSMOSPAY_API_KEY en .env' : undefined,
});

// --- registro local de pagos (archivo chico; si el disco está lleno sigue en memoria) ---
const pagos = new Map((leer('pagos.json', [])).map((p) => [p.id, p]));
function guardar() { try { writeFileSync(ARCHIVO, JSON.stringify([...pagos.values()].slice(-500), null, 1)); } catch { /* sin espacio */ } }

// --- utilidades del adaptador genérico ---
const dato = (obj, ruta) => String(ruta || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? o : o[k]), obj);
function plantilla(v, vars) {
  if (typeof v === 'string') {
    const exacto = v.match(/^\{\{(\w+)\}\}$/);
    if (exacto) return vars[exacto[1]]; // conserva números como números
    return v.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
  }
  if (Array.isArray(v)) return v.map((x) => plantilla(x, vars));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('_')).map(([k, x]) => [k, plantilla(x, vars)]));
  return v;
}
function estadoNormal(valor) {
  const e = cfg().estados || {};
  const v = String(valor ?? '').toLowerCase();
  for (const k of ['pagado', 'vencido', 'fallido', 'pendiente']) if ((e[k] || []).map((x) => String(x).toLowerCase()).includes(v)) return k;
  return 'pendiente';
}
async function llamar(def, vars) {
  const c = cfg();
  const auth = c.auth || {};
  const url = c.base_url.replace(/\/$/, '') + plantilla(def.ruta, vars);
  const metodo = (def.metodo || 'POST').toUpperCase();
  const r = await fetch(url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', [auth.header || 'Authorization']: (auth.prefijo ?? 'Bearer ') + process.env.COSMOSPAY_API_KEY, ...(c.headers_extra || {}) },
    body: metodo === 'GET' ? undefined : JSON.stringify(plantilla(def.cuerpo || {}, vars)),
    signal: AbortSignal.timeout(20000),
  });
  const txt = await r.text();
  let json; try { json = JSON.parse(txt); } catch { json = {}; }
  if (!r.ok) throw new Error(`CosmosPay respondió ${r.status}: ${txt.slice(0, 300)}`);
  return json;
}

/** Crea un pago para un producto del catálogo. moneda: una de PAGO_MONEDAS. */
export async function crearPago({ producto_id, moneda }, baseUrl) {
  const prod = productos().find((p) => p.id === producto_id);
  if (!prod) throw new Error('Ese producto no está en el catálogo.');
  const mon = String(moneda || '').toUpperCase();
  if (!monedas().includes(mon)) throw new Error(`Moneda no habilitada. Opciones: ${monedas().join(', ')}`);
  const prov = proveedor();
  if (prov === 'ninguno' || prov === 'sin_configurar') throw new Error('Los pagos todavía no están configurados.');
  const id = randomUUID();
  const pago = { id, proveedor: prov, producto_id: prod.id, concepto: prod.nombre, monto: prod.precio_usd, moneda: mon, estado: 'pendiente', creado: new Date().toISOString() };
  if (prov === 'simulado') {
    pago.url_pago = `${baseUrl}/pago-simulado?id=${id}`;
  } else {
    const c = cfg();
    const publica = (process.env.URL_PUBLICA || baseUrl).replace(/\/$/, '');
    const resp = await llamar(c.crear_pago, {
      monto: prod.precio_usd, monto_texto: prod.precio_usd.toFixed(2), moneda: mon, concepto: prod.nombre, referencia: id,
      url_exito: `${publica}/?pago=${id}`, url_cancelado: `${publica}/?pago=${id}`, url_webhook: `${publica}/api/pagos/webhook`,
    });
    const m = c.crear_pago.respuesta;
    pago.id_proveedor = dato(resp, m.id);
    pago.url_pago = dato(resp, m.url_pago);
    pago.direccion = dato(resp, m.direccion) || undefined; // dirección de billetera, si el proveedor la devuelve
    pago.vence = dato(resp, m.vence) || undefined;
    if (m.estado) pago.estado = estadoNormal(dato(resp, m.estado));
    if (!pago.url_pago && !pago.direccion) throw new Error('CosmosPay no devolvió un link de pago; revisar el mapeo "respuesta" en cosmospay.config.json.');
  }
  pagos.set(id, pago);
  guardar();
  return pago;
}

/** Estado actual; si es de CosmosPay y sigue pendiente, lo vuelve a consultar al proveedor. */
export async function consultarPago(id) {
  const pago = pagos.get(id);
  if (!pago) return null;
  const c = cfg();
  if (pago.proveedor === 'cosmospay' && pago.estado === 'pendiente' && c.consultar_pago?.ruta && pago.id_proveedor) {
    try {
      const resp = await llamar({ metodo: 'GET', ...c.consultar_pago }, { id: pago.id_proveedor, referencia: pago.id });
      const nuevo = estadoNormal(dato(resp, c.consultar_pago.respuesta?.estado));
      if (nuevo !== pago.estado) { pago.estado = nuevo; pago.actualizado = new Date().toISOString(); guardar(); }
    } catch (e) { pago.ultimo_error = e.message; }
  }
  return pago;
}

/** Webhook del proveedor. cuerpoCrudo: string exacto recibido. */
export async function recibirWebhook(cuerpoCrudo, headers) {
  const w = cfg().webhook || {};
  const secreto = process.env.COSMOSPAY_WEBHOOK_SECRET;
  if (w.header_firma && secreto) {
    const recibida = String(headers[w.header_firma.toLowerCase()] || '').replace(/^sha256=/, '');
    const esperada = createHmac(w.algoritmo || 'sha256', secreto).update(cuerpoCrudo).digest(w.codificacion || 'hex');
    const a = Buffer.from(recibida); const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, motivo: 'firma inválida' };
  }
  let ev; try { ev = JSON.parse(cuerpoCrudo); } catch { return { ok: false, motivo: 'cuerpo inválido' }; }
  const ref = dato(ev, w.referencia); const idProv = dato(ev, w.id);
  const pago = [...pagos.values()].find((p) => (ref && p.id === ref) || (idProv && p.id_proveedor === idProv));
  if (!pago) return { ok: true, motivo: 'pago desconocido' };
  await consultarPago(pago.id); // la confirmación real viene de la API, no del contenido del webhook
  return { ok: true, estado: pago.estado };
}

/** Solo para el proveedor simulado. */
export function simularAprobacion(id) {
  const pago = pagos.get(id);
  if (!pago || pago.proveedor !== 'simulado') return null;
  pago.estado = 'pagado'; pago.actualizado = new Date().toISOString();
  guardar();
  return pago;
}
