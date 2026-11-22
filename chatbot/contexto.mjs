// Recuperación previa (RAG local): antes de que el mensaje del usuario llegue al modelo,
// se detecta de qué localidad, hora y tipo de lugar habla y se le adjuntan los lugares ya
// filtrados. Así el modelo responde en una sola pasada, sin ir y volver con una herramienta.
// Todo corre en memoria sobre el directorio: tarda milisegundos y respeta horarios y distancias,
// cosa que una búsqueda semántica sobre texto no puede hacer.

import { buscar, planRapido, clavesLocalidades, localidadMasCercana } from './datos.mjs';
import { momento, sinAcentos } from './horarios.mjs';

const CLAVES = clavesLocalidades();

const INTENCION = {
  comer: /\b(comer|como|comemos|comida|cenar|cena|ceno|almorz|almuerz|desayun|merend|restaurant|resto\b|parrilla|asado|cafe|bar\b|bares|cervez|helad|hambre|empanada|pizza|picar|tomar algo|pena\b|penas\b)/,
  dormir: /\b(dormir|duermo|hotel|hostel|hostal|alojamiento|alojar|hosped|cabana|camping|acampar|quedarme|posada|hosteria|donde parar)/,
  hacer: /\b(hacer|hago|hacemos|visitar|conocer|pasear|paseo|recorrer|museo|plan\b|actividad|excursion|mirador|cerro|atractiv|imperdible|turismo|que ver|para ver)/,
  servicios: /\b(terminal|colectivo|omnibus|micro\b|casa de cambio|cambiar (plata|dolares|pesos)|nafta|combustible|estacion de servicio|aeropuerto|alquil|informacion turistica|oficina de turismo)/,
  compras: /\b(comprar|compras|artesania|mercado|feria|souvenir|regalo|vinoteca|vino\b)/,
  salir: /\b(boliche|bailar|casino|cine\b|teatro|salir de noche|vida nocturna)/,
};
// términos concretos que conviene buscar literalmente en nombre / cocina / tipo
const CONCRETOS = ['parrilla', 'pizza', 'empanadas', 'regional', 'vegetariano', 'vegano', 'pastas', 'hamburguesa', 'helado', 'cafeteria', 'cerveza', 'pena',
  'museo', 'mirador', 'iglesia', 'arqueologico', 'termas', 'cascada', 'artesanias', 'mercado', 'terminal', 'cambio', 'aeropuerto', 'camping', 'hostel', 'cabana', 'casino', 'teatro', 'cine'];

function localidadEn(t) {
  const frase = ` ${t.replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [clave, nombre] of CLAVES) if (frase.includes(` ${clave} `)) return nombre;
  return null;
}

function horaEn(t) {
  const ahora = momento().minutos;
  const m = t.match(/\b(?:son las?|a las?|tipo|desde las?|hasta las?|las)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs|horas|h)?\s*(de la tarde|de la noche|pm|de la manana|am)?/)
    || t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs|horas)\b\s*(de la tarde|de la noche)?/);
  if (m && +m[1] <= 24 && +(m[2] || 0) < 60) {
    let h = +m[1];
    const suf = m[3] || '';
    if (/tarde|noche|pm/.test(suf) && h < 12) h += 12;
    else if (!suf && h >= 1 && h <= 11 && !m[2] && ahora >= 12 * 60) h += 12; // "a las 6" dicho a la tarde
    return `${String(h % 24).padStart(2, '0')}:${m[2] || '00'}`;
  }
  if (/\b(esta noche|a la noche|de noche|para cenar|cenar)\b/.test(t) && ahora < 20 * 60 && ahora >= 5 * 60) return '21:00';
  if (/\b(al mediodia|almorzar|almuerzo)\b/.test(t) && (ahora < 11.5 * 60 || ahora > 15.5 * 60)) return '13:00';
  return undefined;
}

/** Una línea compacta por lugar: gasta muchos menos tokens que el JSON, así el modelo responde antes. */
export function linea(l) {
  const ab = l.abierto === 'si' ? (l.cierra && l.cierra !== 'no cierra' ? `abierto hasta ${l.cierra}` : 'abierto')
    : l.abierto === 'no' ? (l.abre ? `cerrado, abre ${l.abre}` : 'cerrado') : 'sin horario cargado';
  return '- ' + [
    l.nombre, String(l.tipo || '').replace(/_/g, ' '), [l.localidad, l.direccion].filter(Boolean).join(', '),
    l.distancia_km != null ? `${l.distancia_km} km` : null, l.precio?.replace(' (estimado)', ' aprox'), ab,
    l.cocina && `cocina ${l.cocina}`, l.estrellas && `${l.estrellas} estrellas`, l.altitud_m && `${l.altitud_m} msnm`,
    l.telefono && `tel ${String(l.telefono).split(/[;,]/)[0].trim()}`, l.descripcion,
  ].filter(Boolean).join(' | ');
}
export const lineas = (titulo, lista) => (lista?.length ? `${titulo}:\n${lista.map(linea).join('\n')}` : '');

/** Texto para el modelo a partir de la respuesta de buscar() o planRapido(). */
export function comoTexto(d) {
  if (d.falta) return d.mensaje;
  const partes = [`Zona: ${d.zona}. Momento: ${d.momento}${d.es_de_noche ? ' (de noche)' : ''}.`];
  if (d.resultados) partes.push(d.resultados.length ? lineas(`RESULTADOS (${d.mostrados} de ${d.total_encontrados})`, d.resultados) : 'Sin resultados para esos filtros.');
  if (d.para_hacer) partes.push(lineas('PARA HACER', d.para_hacer) || 'PARA HACER: nada encontrado cerca.');
  if (d.para_comer) partes.push(lineas('PARA COMER', d.para_comer) || 'PARA COMER: nada encontrado cerca.');
  if (d.aviso) partes.push(d.aviso);
  if (d.nota) partes.push(d.nota);
  return partes.filter(Boolean).join('\n');
}

/**
 * Datos para adjuntar al próximo mensaje. Devuelve { localidad, texto_modelo, grupos } o
 * { localidad } sin texto cuando el mensaje no pide lugares (un "gracias", una charla general).
 */
export function contexto({ texto, lat, lon, ultima } = {}) {
  const t = sinAcentos(texto);
  const mencionada = localidadEn(t);
  const porGps = typeof lat === 'number' && typeof lon === 'number' ? localidadMasCercana(lat, lon) : null;
  const localidad = mencionada || ultima || (porGps && porGps.km < 60 ? porGps.nombre : null);
  const pide = Object.keys(INTENCION).filter((k) => INTENCION[k].test(t));
  const concreto = CONCRETOS.find((c) => new RegExp(`\\b${c}`).test(t));
  if (!localidad) return { localidad: null };
  if (!pide.length && !concreto && !mencionada) return { localidad }; // nada que buscar en este mensaje
  const hora = horaEn(t);
  const base = { localidad, hora };
  const grupos = [];
  const barato = /\b(barat|economic|low cost|gasolero)/.test(t) ? '$' : undefined;

  if (concreto) {
    const r = buscar({ ...base, texto: concreto, limite: 5, precio_max: barato });
    if (r.resultados.length) grupos.push({ titulo: `"${concreto}" en ${localidad}`, lugares: r.resultados });
  }
  if (pide.includes('dormir')) grupos.push({ titulo: 'Para dormir', lugares: buscar({ ...base, categoria: 'alojamiento', precio_max: barato, limite: 5 }).resultados });
  if (pide.includes('servicios')) grupos.push({ titulo: 'Servicios', lugares: buscar({ ...base, categoria: 'servicios_al_viajero', limite: 5 }).resultados });
  if (pide.includes('compras')) grupos.push({ titulo: 'Compras', lugares: buscar({ ...base, categoria: 'compras', limite: 5 }).resultados });
  if (pide.includes('salir')) grupos.push({ titulo: 'Salir', lugares: buscar({ ...base, categoria: 'vida_nocturna_ocio', limite: 5 }).resultados });
  const general = !pide.length || pide.includes('hacer') || pide.includes('comer');
  let plan = null;
  if (general && !(concreto && grupos.length && pide.length <= 1 && !pide.includes('hacer') && !/\by\b.*\b(comer|hacer)/.test(t))) {
    plan = planRapido(base);
    if (!pide.length || pide.includes('hacer')) grupos.push({ titulo: 'Para hacer', lugares: plan.para_hacer.slice(0, 5) });
    if (!pide.length || pide.includes('comer')) grupos.push({ titulo: 'Para comer', lugares: plan.para_comer.slice(0, 5) });
  }
  const utiles = grupos.filter((g) => g.lugares?.length);
  if (!utiles.length) return { localidad };
  const mom = momento({ hora });
  const texto_modelo = [
    'DATOS DEL DIRECTORIO (ya filtrados para el próximo mensaje del usuario; respondé con esto sin llamar herramientas, salvo que pida otra zona, otro horario u otro tipo de lugar):',
    `Zona: ${localidad}, distancias en línea recta. Momento: ${mom.etiqueta}${mom.es_de_noche ? ' (de noche)' : ''}.`,
    ...utiles.map((g) => lineas(g.titulo.toUpperCase(), g.lugares)),
    plan ? 'En PARA HACER y PARA COMER ya se excluyó lo que figura cerrado a esa hora.' : '',
  ].filter(Boolean).join('\n');
  return { localidad, hora: mom.hora, texto_modelo, grupos: utiles };
}
