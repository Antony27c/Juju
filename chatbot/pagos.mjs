// Pagos de juju.
// - Los precios salen SIEMPRE de productos.json (el modelo de IA no puede fijar montos).
// - Proveedor "simulado": flujo de prueba, no mueve dinero.
// - Proveedor "cosmospay": API de Cosmos Pay (https://dev.cosmospay.lat/docs/api/).
//   Cosmos Pay cobra en cripto. Acá se usan solo monedas estables en dólares sobre Stellar
//   (USDC, USDT0...), 1 a 1 con el precio en USD del catálogo. El emisor de cada moneda se toma
//   del registro verificado de Cosmos Pay (GET /v1/assets), no está escrito a mano.
//   Clave dv_... = red de prueba (testnet); clave prod_... = red real (mainnet).
// - Un webhook nunca se da por bueno solo: se verifica su firma y además se vuelve a
//   consultar el estado del pago a la API.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const leer = (f, def) => { try { return JSON.parse(readFileSync(path.join(AQUI, f), 'utf8').replace(/^﻿/, '')); } catch { return def; } };
const ARCHIVO = path.join(AQUI, 'pagos.json');
const API = () => (process.env.COSMOSPAY_API_BASE || 'https://api.cosmospay.lat/cosmos-api').replace(/\/$/, '');
const CHECKOUT = 'https://payments.cosmospay.lat';

// Solo monedas atadas al dólar: así "USD 5" del catálogo equivale a 5 unidades de la moneda.
const ESTABLES_USD = { USDC: 'USDC (dólar digital)', USDT0: 'USDT (dólar digital)', PYUSD: 'PayPal USD (dólar digital)' };
const ESTADOS = { PENDING: 'pendiente', SUBMITTED: 'pendiente', SUCCEEDED: 'pagado', FAILED: 'fallido', CANCELLED: 'fallido', EXPIRED: 'vencido' };

const cfg = () => leer('cosmospay.config.json', {});
const clave = () => process.env.COSMOSPAY_API_KEY || '';
const red = () => (clave().startsWith('prod_') ? 'public' : 'testnet');
export const productos = () => (leer('productos.json', { productos: [] }).productos || []).filter((p) => p.id && p.precio_usd > 0);

const cosmosListo = () => Boolean(clave() && /^G[A-Z2-7]{55}$/.test(cfg().destino || ''));

export function proveedor() {
  const pedido = (process.env.PAGOS_PROVEEDOR || '').toLowerCase();
  if (pedido === 'cosmospay') return cosmosListo() ? 'cosmospay' : 'sin_configurar';
  if (pedido === 'simulado') return 'simulado';
  return cosmosListo() ? 'cosmospay' : 'ninguno';
}

function monedas() {
  if (proveedor() === 'cosmospay') {
    return (cfg().monedas || ['USDC']).map((m) => String(m).toUpperCase()).filter((m) => ESTABLES_USD[m]).map((m) => ({ id: m, etiqueta: ESTABLES_USD[m] }));
  }
  return [{ id: 'USD', etiqueta: 'dólares (USD)' }, { id: 'USDT', etiqueta: 'cripto (USDT)' }];
}

export const estadoPagos = () => {
  const p = proveedor();
  return {
    proveedor: p, monedas: monedas(), productos: productos().length,
    red: p === 'cosmospay' ? red() : undefined,
    falta: p === 'sin_configurar' ? 'Falta COSMOSPAY_API_KEY en .env o una cuenta Stellar válida (G...) en "destino" de cosmospay.config.json' : undefined,
  };
};

// --- registro local de pagos (archivo chico; si el disco está lleno sigue en memoria) ---
const pagos = new Map((leer('pagos.json', [])).map((p) => [p.id, p]));
function guardar() { try { writeFileSync(ARCHIVO, JSON.stringify([...pagos.values()].slice(-500), null, 1)); } catch { /* sin espacio */ } }

// --- Cosmos Pay ---
async function cosmos(metodo, ruta, body) {
  const r = await fetch(API() + ruta, {
    method: metodo,
    headers: { Authorization: `Bearer ${clave()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch { d = {}; }
  if (!r.ok) {
    const msg = Array.isArray(d.message) ? d.message.join('; ') : d.message || txt.slice(0, 200);
    const e = new Error(`Cosmos Pay respondió ${r.status}${d.code ? ` (${d.code})` : ''}: ${msg}`);
    e.code = d.code; throw e;
  }
  return d;
}

let registro = { red: null, hasta: 0, datos: [] };
async function emisorDe(codigo) {
  if (registro.red !== red() || Date.now() > registro.hasta) {
    const d = await cosmos('GET', `/v1/assets?network=${red()}&verified=true`);
    registro = { red: red(), hasta: Date.now() + 10 * 60000, datos: d.data || [] };
  }
  const hallados = registro.datos.filter((a) => a.code === codigo && a.verified && a.issuer);
  if (hallados.length !== 1) throw new Error(`${codigo} no está disponible en la red ${red() === 'public' ? 'real' : 'de prueba'} de Cosmos Pay.`);
  return hallados[0].issuer;
}

/** Crea un pago para un producto del catálogo. moneda: un id de estadoPagos().monedas. */
export async function crearPago({ producto_id, moneda }, baseUrl) {
  const prod = productos().find((p) => p.id === producto_id);
  if (!prod) throw new Error('Ese producto no está en el catálogo.');
  const prov = proveedor();
  if (prov === 'ninguno' || prov === 'sin_configurar') throw new Error('Los pagos todavía no están configurados.');
  const mon = monedas().find((m) => m.id === String(moneda || '').toUpperCase());
  if (!mon) throw new Error(`Moneda no habilitada. Opciones: ${monedas().map((m) => m.id).join(', ')}`);
  const id = randomUUID();
  const pago = { id, proveedor: prov, producto_id: prod.id, concepto: prod.nombre, monto: prod.precio_usd, moneda: mon.id, estado: 'pendiente', creado: new Date().toISOString() };
  if (prov === 'simulado') {
    pago.url_pago = `${baseUrl}/pago-simulado?id=${id}`;
  } else {
    const c = cfg();
    const intento = await cosmos('POST', '/v1/payment-intents/pay', {
      chain: 'stellar', destination: c.destino,
      amount: prod.precio_usd.toFixed(2), // en unidades de la moneda (estable 1:1 con USD)
      assetCode: mon.id, assetIssuer: await emisorDe(mon.id),
      msg: `juju: ${prod.nombre}`.slice(0, 300),
      ...(c.checkoutTheme ? { checkoutTheme: c.checkoutTheme } : {}),
    });
    Object.assign(pago, {
      id_proveedor: intento.id, red: intento.network, estado: ESTADOS[intento.status] || 'pendiente',
      url_pago: `${CHECKOUT}/${intento.id}`, // checkout alojado por Cosmos Pay
      qr: intento.qr, direccion: intento.destination, memo: intento.memo, vence: intento.expiresAt,
    });
    cosmos('PATCH', `/v1/payment-intents/${intento.id}`, { reference: id }).catch(() => {}); // referencia propia, para conciliar
  }
  pagos.set(id, pago);
  guardar();
  return pago;
}

/** Estado actual; si es de Cosmos Pay y no es final, lo vuelve a consultar a la API. */
export async function consultarPago(id) {
  const pago = pagos.get(id);
  if (!pago) return null;
  // "vencido" no es final: Cosmos Pay todavía lo acredita si después verifica el pago.
  if (pago.proveedor === 'cosmospay' && pago.id_proveedor && ['pendiente', 'vencido'].includes(pago.estado) && clave()) {
    try {
      const intento = await cosmos('GET', `/v1/payment-intents/${pago.id_proveedor}`);
      const nuevo = ESTADOS[intento.status] || 'pendiente';
      if (nuevo !== pago.estado || intento.txHash !== pago.tx) { pago.estado = nuevo; pago.tx = intento.txHash || undefined; pago.actualizado = new Date().toISOString(); guardar(); }
    } catch (e) { pago.ultimo_error = e.message; }
  }
  return pago;
}

/** Webhook de Cosmos Pay. Firma: x-cosmos-signature: t=<unix>,v1=<hex HMAC-SHA256 de "<t>.<cuerpo crudo>">. */
export async function recibirWebhook(cuerpoCrudo, headers) {
  const secreto = process.env.COSMOSPAY_WEBHOOK_SECRET;
  if (!secreto) return { ok: false, motivo: 'webhook sin secreto configurado' };
  const partes = Object.fromEntries(String(headers['x-cosmos-signature'] || '').split(',').map((x) => x.trim().split('=')));
  const t = Number(partes.t);
  if (!t || !partes.v1 || Math.abs(Date.now() / 1000 - t) > 300) return { ok: false, motivo: 'firma ausente o vencida' };
  const esperada = Buffer.from(createHmac('sha256', secreto).update(`${partes.t}.${cuerpoCrudo}`).digest('hex'));
  const recibida = Buffer.from(partes.v1);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return { ok: false, motivo: 'firma inválida' };
  let ev; try { ev = JSON.parse(cuerpoCrudo); } catch { return { ok: false, motivo: 'cuerpo inválido' }; }
  const pago = [...pagos.values()].find((p) => p.id_proveedor && p.id_proveedor === ev?.data?.id);
  if (!pago) return { ok: true, motivo: 'evento ignorado' };
  await consultarPago(pago.id); // la confirmación real viene de la API, no del contenido del webhook
  return { ok: true, estado: pago.estado };
}

/** Registra en Cosmos Pay la URL pública que recibe los avisos. Devuelve el secreto (se muestra una sola vez). */
export async function registrarWebhook(url) {
  return cosmos('POST', '/v1/webhooks', { url, description: 'juju', eventTypes: ['PAYMENT_INTENT_SUCCEEDED', 'PAYMENT_INTENT_FAILED', 'PAYMENT_INTENT_CANCELLED'] });
}

/** Solo para el proveedor simulado. */
export function simularAprobacion(id) {
  const pago = pagos.get(id);
  if (!pago || pago.proveedor !== 'simulado') return null;
  pago.estado = 'pagado'; pago.actualizado = new Date().toISOString();
  guardar();
  return pago;
}
