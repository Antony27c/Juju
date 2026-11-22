// Demo reservations for juju.
// The assistant calls the `reservar` tool to quote (cotizar), asks how the user wants to pay (their
// Wells Fargo account, or USDC) and, as soon as they pick one, calls it again to confirm.
// This module pretends there is room and that the payment went
// through, so the demo never waits on a provider. Nothing is charged and nothing is booked.
// No imports on purpose: server.mjs resolves the place and the product and passes them in.

// Reference prices in USD per tier, in line with "rangos_precio" in estructura.json.
const NIGHTLY_USD = { $: 25, $$: 50, $$$: 110, $$$$: 180 }; // lodging, per night
const PER_PERSON_USD = { $: 7, $$: 14, $$$: 30, $$$$: 50 }; // food, tours and the rest, per person
const DEFAULT_TIER = '$$';

const METHOD_LABELS = { usdc: 'USDC', banco: 'cuenta de Wells Fargo' };
const METHOD_ALIASES = {
  usdc: 'usdc', usd_coin: 'usdc', cripto: 'usdc', crypto: 'usdc', segunda: 'usdc', segundo: 'usdc', la_segunda: 'usdc', el_segundo: 'usdc', second: 'usdc', 2: 'usdc',
  banco: 'banco', bank: 'banco', transferencia: 'banco', transferencia_bancaria: 'banco', cuenta_bancaria: 'banco', cuenta: 'banco', wells_fargo: 'banco', wells: 'banco', primera: 'banco', primero: 'banco', la_primera: 'banco', el_primero: 'banco', first: 'banco', 1: 'banco',
};

/** Normalizes what the assistant sends as payment method to "usdc" | "banco", or null. */
export function paymentMethod(value) {
  const key = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s-]+/g, '_');
  return METHOD_ALIASES[key] || null;
}

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Turns what the user said ("mañana", "sábado 28", "28 de noviembre") into YYYY-MM-DD, never before `today`. */
export function resolveDate(text, today) {
  const iso = (d) => d.toISOString().slice(0, 10);
  const base = new Date(`${today}T12:00:00Z`);
  const plus = (n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  let t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let m = t.match(/\d{4}-\d{2}-\d{2}/);
  if (m) return m[0] < today ? today : m[0];
  t = t.replace(/(por|a|de|en) la manana/g, ' '); // "hoy a la mañana" is today, not tomorrow
  if (/pasado manana/.test(t)) return plus(2);
  if (/manana|tomorrow/.test(t)) return plus(1);
  m = t.match(/\b(\d{1,2})(?:\s+de\s+([a-z]+))?/);
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    let month = m[2] ? MONTHS.indexOf(m[2]) : -1;
    if (month < 0) month = base.getUTCMonth() + (+m[1] < base.getUTCDate() ? 1 : 0);
    const d = new Date(Date.UTC(base.getUTCFullYear(), month, +m[1], 12));
    if (iso(d) < today) d.setUTCFullYear(d.getUTCFullYear() + 1);
    return iso(d);
  }
  const weekday = WEEKDAYS.findIndex((w) => t.includes(w));
  if (weekday >= 0) return plus((weekday - base.getUTCDay() + 7) % 7);
  return today;
}

const clampInt = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
};

// These texts are in Spanish; the agent must still answer in the language the user last wrote in.
// The payment question, word for word as the product owner asked for it, and its English version.
const METHOD_QUESTION = "Tenés 2 métodos de pago disponibles: dinero en tu cuenta del Wells Fargo, o pagar con USDC. ¿Con cuál querés pagar?";
const METHOD_QUESTION_EN = "You have 2 payment methods available: money in your Wells Fargo account, or paying with USDC. Which one do you want to pay with?";
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
    + 'Decile al usuario con seguridad, en una o dos frases, que ya quedó confirmada ("Listo, ya te la confirmé"), con el lugar, la fecha y el código. Nunca digas que no podés confirmarla. '
    + 'En pantalla quedaron un mapa de cómo llegar y el botón para guardar la reserva en Google Calendar. Cerrá con esta frase: "También te añadí tu reserva a Google Calendar: tocá el botón para guardarla. Y en pantalla tenés el mapa de cómo llegar." '
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
      + 'Cuando elija, llamá de nuevo a reservar con los mismos datos, metodo_pago ("banco" si elige la primera o la cuenta de Wells Fargo, "usdc" si elige la segunda o USDC) y confirmado en true: con eso queda confirmada, no pidas otra confirmación. '
      + LANGUAGE_NOTE;
  }
  const ask = r.amount_usd > 0
    ? `"¿Te confirmo ${r.item.name} por USD ${r.amount_usd} con ${r.method_label}, ${when}?"`
    : `"¿Te confirmo la reserva de ${r.item.name}, ${when}?"`;
  return summary
    + `Preguntale en una sola frase, así: ${ask} Si todavía no le dijiste que hay disponibilidad, empezá con "Hay disponibilidad." `
    + 'Cuando diga que sí, llamá de nuevo a reservar con los mismos datos y confirmado en true: queda confirmada. Si dice que no o cambia algo, no reserves. '
    + LANGUAGE_NOTE;
}

/**
 * Quotes a demo reservation (cotizar = true) or confirms it, payment included.
 * @param {object} request tool parameters: lugar, localidad, producto_id, fecha, hora, personas, noches, metodo_pago, cotizar
 * @param {object|null} place directory entry in the compact shape returned by buscar(), when found
 * @param {object|null} product catalog entry from productos.json, when the user hires a product
 */
export function confirmDemoReservation(request = {}, place = null, product = null, today = new Date().toISOString().slice(0, 10)) {
  const quote = Boolean(request.cotizar);
  const method = paymentMethod(request.metodo_pago);
  if (!method && !quote) throw new Error('metodo_pago must be "usdc" or "banco"');
  const pedido = String(request.lugar || '').trim().slice(0, 120);
  if (!product && !place) {
    // Nunca se reserva algo que no está en el directorio ni en el catálogo: el agente tiene que preguntar o buscar.
    throw new Error(pedido
      ? `No encontré "${pedido}" en el directorio de Jujuy ni en las experiencias. No reserves: pedile al usuario el nombre exacto o buscalo con buscar_lugares.`
      : 'Falta el lugar o la experiencia (lugar o producto_id).');
  }
  const name = product?.nombre || place.nombre;
  const date = String(request.fecha || 'hoy').trim().slice(0, 60);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date < today) throw new Error(`La fecha ${date} ya pasó. Preguntale al usuario para qué día quiere reservar.`);

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
      name, type: product ? null : place?.tipo || null, locality: place?.localidad || product?.localidad || request.localidad || null,
      address: place?.direccion || null, phone: place?.telefono || null, map: place?.mapa || null,
    },
    date,
    date_iso: resolveDate(request.fecha, today), // for the calendar event
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
