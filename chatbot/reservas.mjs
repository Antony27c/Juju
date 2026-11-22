// Demo reservations for juju.
// The assistant calls the `reservar` tool to quote (cotizar), asks how the user wants to pay (their
// Wells Fargo account, or USDC through Cosmos Pay), asks them to confirm the activity, the amount and
// the time, and only then calls it again to confirm. This module pretends there is room and that the payment went
// through, so the demo never waits on a provider. Nothing is charged and nothing is booked.
// No imports on purpose: server.mjs resolves the place and the product and passes them in.

// Reference prices in USD per tier, in line with "rangos_precio" in estructura.json.
const NIGHTLY_USD = { $: 25, $$: 50, $$$: 110, $$$$: 180 }; // lodging, per night
const PER_PERSON_USD = { $: 7, $$: 14, $$$: 30, $$$$: 50 }; // food, tours and the rest, per person
const DEFAULT_TIER = '$$';

const METHOD_LABELS = { usdc: 'USDC por Cosmos Pay', banco: 'cuenta de Wells Fargo' };
const METHOD_ALIASES = {
  usdc: 'usdc', usd_coin: 'usdc', cripto: 'usdc', crypto: 'usdc', cosmos_pay: 'usdc', cosmospay: 'usdc', cosmopay: 'usdc',
  banco: 'banco', bank: 'banco', transferencia: 'banco', transferencia_bancaria: 'banco', cuenta_bancaria: 'banco', cuenta: 'banco', wells_fargo: 'banco', wells: 'banco',
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

// These texts are in Spanish; the agent must still answer in the language the user last wrote in.
// The payment question, word for word as the product owner asked for it, and its English version.
const METHOD_QUESTION = "Tenés 2 métodos de pago disponibles: dinero en tu cuenta del Wells Fargo, o pagar con USDC a través de Cosmos Pay. ¿Con cuál querés pagar?";
const METHOD_QUESTION_EN = "You have 2 payment methods available: money in your Wells Fargo account, or paying with USDC through Cosmos Pay. Which one do you want to pay with?";
const LANGUAGE_NOTE = 'Decilo en el idioma del último mensaje del usuario: si fue en inglés, en inglés; si fue en español, en español.';

function modelText(r) {
  const details = [
    r.date, r.time && `${r.time} hs`, `${r.people} ${r.people === 1 ? 'persona' : 'personas'}`,
    r.nights && `${r.nights} ${r.nights === 1 ? 'noche' : 'noches'}`,
  ].filter(Boolean).join(', ');
  const paid = r.amount_usd > 0 ? `Pago acreditado: USD ${r.amount_usd} con ${r.method_label}.` : 'No requiere pago.';
  const where = r.item.locality ? `${r.item.name} (${r.item.locality})` : r.item.name;
  const what = r.kind === 'product' ? `Reserva confirmada: ${where}` : `Reserva confirmada en ${where}`;
  return `${paid} ${what} para ${details}. Código de reserva: ${r.code}. `
    + 'Decile al usuario en una o dos frases que el pago se acreditó y que la reserva quedó confirmada, con el lugar, la fecha y el código. '
    + LANGUAGE_NOTE;
}

// Lo que el agente tiene que decir después de cotizar: el usuario confirma actividad, monto y hora antes de pagar.
function quoteText(r) {
  const when = [r.date, r.time && `a las ${r.time}`].filter(Boolean).join(' ');
  const details = [`${r.people} ${r.people === 1 ? 'persona' : 'personas'}`, r.nights && `${r.nights} ${r.nights === 1 ? 'noche' : 'noches'}`].filter(Boolean).join(', ');
  const total = r.amount_usd > 0 ? `Total: USD ${r.amount_usd}${r.method_label ? ` con ${r.method_label}` : ''}.` : 'No tiene costo.';
  const summary = `Hay disponibilidad, pero todavía NO está reservado ni pagado. ${r.item.name}${r.item.locality ? ` (${r.item.locality})` : ''}, ${when}, ${details}. ${total} `;
  // No method yet: the only thing to ask now is how they pay. The confirmation comes with the next call.
  if (!r.method && r.amount_usd > 0) {
    return summary
      + `Falta el método de pago. Decile que hay disponibilidad y preguntale cómo paga con esta frase, sin cambiarla: "Hay disponibilidad. ${METHOD_QUESTION}" `
      + `Si el usuario habla en inglés, la frase es: "There is availability. ${METHOD_QUESTION_EN}" `
      + 'Cuando elija, llamá de nuevo a reservar con los mismos datos y metodo_pago ("banco" si elige la cuenta de Wells Fargo, "usdc" si elige USDC), todavía sin confirmado: todavía no se paga. '
      + LANGUAGE_NOTE;
  }
  const ask = r.amount_usd > 0
    ? `"Para conectar la reserva y pagar, confirmame por favor que querés pagar ${r.item.name} por USD ${r.amount_usd} con ${r.method_label}, ${when}."`
    : `"Confirmame por favor que querés reservar ${r.item.name}, ${when}."`;
  return summary
    + `Pedile la confirmación en una sola frase, con la actividad, el monto y la hora, así: ${ask} Si todavía no le dijiste que hay disponibilidad, empezá con "Hay disponibilidad." `
    + 'Cuando diga que sí, llamá de nuevo a reservar con los mismos datos y confirmado en true. Si dice que no o cambia algo, no reserves. '
    + LANGUAGE_NOTE;
}

/**
 * Quotes a demo reservation (cotizar = true) or confirms it, payment included.
 * @param {object} request tool parameters: lugar, localidad, producto_id, fecha, hora, personas, noches, metodo_pago, cotizar
 * @param {object|null} place directory entry in the compact shape returned by buscar(), when found
 * @param {object|null} product catalog entry from productos.json, when the user hires a product
 */
export function confirmDemoReservation(request = {}, place = null, product = null) {
  const quote = Boolean(request.cotizar);
  const method = paymentMethod(request.metodo_pago);
  if (!method && !quote) throw new Error('metodo_pago must be "usdc" or "banco"');
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
    code: quote ? null : `JUJ-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
    status: quote ? 'quoted' : 'confirmed',
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
    method_label: method ? METHOD_LABELS[method] : null,
    paid_at: quote ? null : new Date().toISOString(),
  };
  return { ...reservation, texto_modelo: quote ? quoteText(reservation) : modelText(reservation) };
}
