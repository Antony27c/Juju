// Demo reservations for juju.
// The assistant asks how the user wants to pay (USDC or bank transfer) and then calls the
// `reservar` tool. This module pretends the payment went through and confirms the booking at
// once, so the demo never waits on a payment provider. Nothing is charged and nothing is booked.
// No imports on purpose: server.mjs resolves the place and the product and passes them in.

// Reference prices in USD per tier, in line with "rangos_precio" in estructura.json.
const NIGHTLY_USD = { $: 25, $$: 50, $$$: 110, $$$$: 180 }; // lodging, per night
const PER_PERSON_USD = { $: 7, $$: 14, $$$: 30, $$$$: 50 }; // food, tours and the rest, per person
const DEFAULT_TIER = '$$';

const METHOD_LABELS = { usdc: 'USDC', banco: 'transferencia bancaria' };
const METHOD_ALIASES = {
  usdc: 'usdc', usd_coin: 'usdc', cripto: 'usdc', crypto: 'usdc',
  banco: 'banco', bank: 'banco', transferencia: 'banco', transferencia_bancaria: 'banco', cuenta_bancaria: 'banco',
};

/** Normalizes what the assistant sends as payment method to "usdc" | "banco", or null. */
export function paymentMethod(value) {
  const key = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_');
  return METHOD_ALIASES[key] || null;
}

const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

function modelText(r) {
  const details = [
    r.date, r.time && `${r.time} hs`, `${r.people} ${r.people === 1 ? 'persona' : 'personas'}`,
    r.nights && `${r.nights} ${r.nights === 1 ? 'noche' : 'noches'}`,
  ].filter(Boolean).join(', ');
  const paid = r.amount_usd > 0 ? `Pago acreditado: USD ${r.amount_usd} con ${r.method_label}.` : 'No requiere pago.';
  const where = r.item.locality ? `${r.item.name} (${r.item.locality})` : r.item.name;
  const what = r.kind === 'product' ? `Reserva confirmada: ${where}` : `Reserva confirmada en ${where}`;
  return `${paid} ${what} para ${details}. Código de reserva: ${r.code}. `
    + 'Decile al usuario en una o dos frases que el pago se acreditó y que la reserva quedó confirmada, con el lugar, la fecha y el código.';
}

/**
 * Confirms a demo reservation and returns it, payment included.
 * @param {object} request tool parameters: lugar, localidad, producto_id, fecha, hora, personas, noches, metodo_pago
 * @param {object|null} place directory entry in the compact shape returned by buscar(), when found
 * @param {object|null} product catalog entry from productos.json, when the user hires a product
 */
export function confirmDemoReservation(request = {}, place = null, product = null) {
  const method = paymentMethod(request.metodo_pago);
  if (!method) throw new Error('metodo_pago must be "usdc" or "banco"');
  const name = product?.nombre || place?.nombre || String(request.lugar || '').trim().slice(0, 120);
  if (!name) throw new Error('lugar or producto_id is required');

  const lodging = !product && (place ? place.categoria === 'alojamiento' : Number(request.noches) > 0);
  const people = clampInt(request.personas, 1, 20, 1);
  const nights = lodging ? clampInt(request.noches, 1, 30, 1) : null;
  const tier = place?.precio ? place.precio.split(' ')[0] : DEFAULT_TIER;
  let amount;
  if (product) amount = product.precio_usd * people; // catalog prices are per person
  else if (tier === 'gratis') amount = 0;
  else if (lodging) amount = (NIGHTLY_USD[tier] ?? NIGHTLY_USD[DEFAULT_TIER]) * nights;
  else amount = (PER_PERSON_USD[tier] ?? PER_PERSON_USD[DEFAULT_TIER]) * people;

  const reservation = {
    code: `JUJ-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    status: 'confirmed',
    demo: true,
    kind: product ? 'product' : 'place',
    item: {
      name, type: product ? null : place?.tipo || null, locality: place?.localidad || request.localidad || null,
      address: place?.direccion || null, phone: place?.telefono || null, map: place?.mapa || null,
    },
    date: String(request.fecha || 'hoy').trim().slice(0, 60),
    time: /^\d{1,2}:\d{2}$/.test(String(request.hora || '')) ? request.hora : null,
    people,
    nights,
    amount_usd: Math.round(amount * 100) / 100,
    method,
    method_label: METHOD_LABELS[method],
    paid_at: new Date().toISOString(),
  };
  return { ...reservation, texto_modelo: modelText(reservation) };
}
