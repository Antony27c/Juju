// Crea (o actualiza) el agente de ElevenLabs y sus herramientas, y guarda los ids.
//   node crear-agente.mjs
// Requiere ELEVENLABS_API_KEY en .env. Se puede volver a correr después de cambiar el prompt.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(AQUI, '.env');
const IDS = path.join(AQUI, 'agente.json');
if (existsSync(ENV)) process.loadEnvFile(ENV);

const CLAVE = process.env.ELEVENLABS_API_KEY;
if (!CLAVE) { console.error('Falta ELEVENLABS_API_KEY. Copiá .env.example a .env y pegá tu clave.'); process.exit(1); }
const API = (process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io').replace(/\/$/, '');
const { estructura, resumen } = await import('./datos.mjs');

async function api(metodo, ruta, body) {
  const r = await fetch(API + ruta, { method: metodo, headers: { 'xi-api-key': CLAVE, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let d; try { d = JSON.parse(txt); } catch { d = txt; }
  if (!r.ok) { const e = new Error(`${metodo} ${ruta} -> ${r.status}: ${typeof d === 'string' ? d : JSON.stringify(d)}`); e.status = r.status; throw e; }
  return d;
}

const categorias = Object.keys(estructura.categorias);
const subcats = Object.entries(estructura.categorias).map(([c, s]) => `${c}: ${s.join(', ')}`).join('\n');
const regiones = Object.entries(estructura.regiones).map(([r, d]) => `${r} (${d.join(', ')})`).join('; ');
const precios = Object.entries(estructura.rangos_precio).map(([k, v]) => `${k} = ${v}`).join('\n');
const r = resumen();

const PROMPT = `Sos "juju", asistente turístico de la provincia de Jujuy, Argentina. Hablás en español argentino, cálido y directo. Respuestas cortas, de 2 a 5 oraciones: es una conversación en vivo y muchas veces por voz. Texto plano: sin markdown, sin viñetas, sin emojis, sin leer links ni coordenadas en voz alta (la pantalla ya muestra tarjetas con mapa y teléfono).

Fecha y hora local al empezar la charla: {{fecha_hora_local}} (Jujuy, UTC-3). Si el usuario dice otra hora ("son las 6 de la tarde"), usá la que diga y pasala a las herramientas.
Ubicación conocida del usuario: {{ubicacion_usuario}}.

# De dónde sale la información
Todo lugar que recomiendes tiene que salir de tus herramientas, que consultan un directorio de ${r.total} lugares de Jujuy. Nunca inventes lugares, direcciones, teléfonos, horarios ni precios. Si la herramienta no devuelve nada útil, decilo y proponé ampliar la zona o cambiar el tipo de lugar.
Categorías y tipos (usá estos valores exactos en las herramientas):
${subcats}
Regiones: ${regiones}.
Rangos de precio:
${precios}
Cuando el precio dice "(estimado)" es una estimación por tipo de lugar: decilo como "aproximadamente".

# Datos que ya te llegan
Muchas veces, justo antes del mensaje del usuario, el sistema te pasa un bloque que empieza con "DATOS DEL DIRECTORIO": son lugares ya filtrados por localidad, hora y tipo para ese mensaje. Si alcanza para responder, respondé directo con eso y no llames a ninguna herramienta: es más rápido. Llamá a una herramienta solo si el bloque no cubre lo pedido (otra localidad, otro horario, otro tipo de lugar, más opciones) o si no llegó ningún bloque.

# Cómo ayudar
- Si no sabés en qué localidad está, preguntalo en una frase antes de buscar. "Jujuy" a secas suele ser San Salvador de Jujuy: asumilo y decilo.
- Pedido típico: "qué puedo hacer ahora, son las X, mañana me voy, quiero hacer algo y comer algo". Llamá a plan_rapido con la localidad y la hora. Después proponé un plan concreto y ordenado para el tiempo que queda: 1 o 2 cosas para hacer y 1 o 2 lugares para comer, todo cerca. Si mañana se va, priorizá lo imperdible y lo que está abierto ahora, y sugerí qué puede hacer mañana temprano antes de irse si alcanza.
- Para pedidos puntuales (un hotel barato, una parrilla, un museo, la terminal, una casa de cambio) usá buscar_lugares con los filtros que correspondan.
- Horarios: cada resultado trae "abierto" con "si", "no" o "sin_dato". La mayoría de los lugares no tiene horario cargado: en ese caso avisá que no tenés el horario y que conviene llamar o pasar; si hay teléfono, ofrecelo. Nunca digas que algo está abierto si dice sin_dato.
- De noche no mandes a nadie a cerros, miradores o lugares alejados; ofrecé paseo por el centro, peñas, restaurantes, bares, cine o teatro.
- Las distancias son en línea recta desde el centro de la localidad: decí "a unas X cuadras o kilómetros", como referencia.
- Nombrá como mucho 3 o 4 lugares por respuesta y preguntá si quiere más opciones o más detalle de alguno.
- Si preguntan algo general de Jujuy (clima, altura, cómo llegar entre pueblos) respondé breve con lo que sepas y aclaralo como orientativo.

# Experiencias y reservas
Catálogo de experiencias que se pueden reservar y pagar desde acá: {{catalogo_pagos}}
- Si pregunta qué excursiones o experiencias puede reservar o comprar, llamá a ver_experiencias (con la localidad si la dijo): quedan en pantalla. Nombrá dos o tres con su precio por persona y preguntá cuál le interesa.
- Para reservar necesitás tres datos: cuál experiencia, cuántas personas y para qué fecha. Si falta alguno, preguntalo en una frase. Con los tres, llamá a reservar_experiencia con el id exacto, la cantidad de personas y la fecha en formato AAAA-MM-DD (calculala a partir de la fecha de hoy que figura en el catálogo). Se abre la reserva en pantalla con el total; el usuario la revisa y toca el botón de pago. Vos no cobrás ni confirmás nada.
- La reserva está confirmada solo cuando el sistema te informa que el pago se acreditó. Recién ahí decile que quedó confirmada y el código de reserva.
- Solo existen las experiencias de ese catálogo, con esos precios. No inventes otras, ni precios, descuentos, cupos u horarios de salida. Los lugares del directorio (restaurantes, hoteles, museos) no se reservan desde acá: para esos ofrecé el teléfono.
- Nunca pidas ni aceptes por voz o por chat datos de tarjeta, claves, frases semilla ni claves privadas.`;

const HERRAMIENTAS = [
  {
    type: 'client', name: 'plan_rapido', expects_response: true, response_timeout_secs: 20,
    description: 'Arma opciones para "qué hago ahora y dónde como": devuelve lugares para hacer algo y lugares para comer cerca de una localidad, a una hora dada, dejando afuera lo que figura cerrado. Usala para pedidos de plan, poco tiempo, "qué hay para hacer ahora/esta noche/mañana".',
    parameters: {
      type: 'object',
      properties: {
        localidad: { type: 'string', description: 'Localidad de Jujuy donde está el usuario, p. ej. "San Salvador de Jujuy", "Tilcara", "Purmamarca". Omitir solo si el usuario compartió su ubicación.' },
        hora: { type: 'string', description: 'Hora de referencia en formato HH:MM de 24 horas. Omitir para usar la hora actual.' },
        dia: { type: 'string', description: 'Día de referencia: "hoy", "mañana" o un día de la semana en español. Omitir para hoy.' },
      },
    },
  },
  {
    type: 'client', name: 'buscar_lugares', expects_response: true, response_timeout_secs: 20,
    description: 'Busca lugares en el directorio turístico de Jujuy con filtros combinables. Devuelve nombre, tipo, localidad, dirección, precio, teléfono, horario y si está abierto a la hora indicada.',
    parameters: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Palabras a buscar en nombre, tipo de cocina o descripción, p. ej. "parrilla", "empanadas", "arqueológico", "peña". Opcional.' },
        categoria: { type: 'string', enum: categorias, description: 'Categoría del lugar. Opcional.' },
        subcategoria: { type: 'string', description: 'Tipo exacto dentro de la categoría, p. ej. "hostel", "museo", "restaurante", "mirador", "terminal_de_omnibus". Opcional.' },
        localidad: { type: 'string', description: 'Localidad alrededor de la cual buscar. Opcional.' },
        region: { type: 'string', enum: Object.keys(estructura.regiones), description: 'Región de Jujuy, si no se busca en una localidad puntual. Opcional.' },
        precio_max: { type: 'string', enum: ['gratis', '$', '$$', '$$$', '$$$$'], description: 'Rango de precio máximo. Opcional.' },
        solo_abiertos: { type: 'boolean', description: 'true para devolver solo lugares con horario cargado que estén abiertos a esa hora. Usar con cuidado: deja afuera la mayoría de los lugares, que no tienen horario cargado.' },
        hora: { type: 'string', description: 'Hora de referencia HH:MM (24 h). Omitir para la hora actual.' },
        dia: { type: 'string', description: '"hoy", "mañana" o un día de la semana. Omitir para hoy.' },
        radio_km: { type: 'number', description: 'Radio de búsqueda en km alrededor de la localidad. Por defecto 10.' },
        limite: { type: 'integer', description: 'Cantidad máxima de resultados, de 1 a 15. Por defecto 8.' },
      },
    },
  },
  {
    type: 'client', name: 'ver_experiencias', expects_response: true, response_timeout_secs: 20,
    description: 'Muestra en pantalla las experiencias y excursiones del catálogo que se pueden reservar, con precio por persona, y devuelve la lista. Usala cuando el usuario pregunta qué puede reservar, comprar o contratar.',
    parameters: {
      type: 'object',
      properties: { localidad: { type: 'string', description: 'Localidad de salida para filtrar, p. ej. "Tilcara". Omitir para mostrar todas.' } },
    },
  },
  {
    type: 'client', name: 'reservar_experiencia', expects_response: true, response_timeout_secs: 20,
    description: 'Abre en pantalla la reserva de una experiencia del catálogo, con personas, fecha y total, para que el usuario la revise y pague. No cobra ni confirma: eso lo hace el usuario en pantalla. Usala solo cuando el usuario pide reservar o comprar una experiencia y ya dijo cuántas personas y qué fecha.',
    parameters: {
      type: 'object',
      properties: {
        experiencia_id: { type: 'string', description: 'Id exacto de la experiencia en el catálogo.' },
        personas: { type: 'integer', description: 'Cantidad de personas, de 1 a 20.' },
        fecha: { type: 'string', description: 'Fecha de la experiencia en formato AAAA-MM-DD, de hoy en adelante.' },
      },
      required: ['experiencia_id', 'personas', 'fecha'],
    },
  },
];

const ids = existsSync(IDS) ? JSON.parse(readFileSync(IDS, 'utf8')) : { herramientas: {} };
ids.herramientas ||= {};

for (const h of HERRAMIENTAS) {
  const previo = ids.herramientas[h.name];
  if (previo) {
    try { await api('PATCH', `/v1/convai/tools/${previo}`, { tool_config: h }); console.log(`Herramienta actualizada: ${h.name}`); continue; } catch (e) { console.warn(`No pude actualizar ${h.name} (${e.message}); creo una nueva.`); }
  }
  const d = await api('POST', '/v1/convai/tools', { tool_config: h });
  ids.herramientas[h.name] = d.id;
  writeFileSync(IDS, JSON.stringify(ids, null, 1));
  console.log(`Herramienta creada: ${h.name} (${d.id})`);
}

const LLM = process.env.ELEVENLABS_LLM || 'claude-haiku-5-5';
const VOZ = process.env.ELEVENLABS_VOICE_ID;
function config(completo) {
  const c = {
    name: 'juju',
    conversation_config: {
      agent: {
        first_message: '¡Hola! Soy juju, tu guía de Jujuy. Contame en qué localidad estás y cuánto tiempo tenés, y te armo un plan para hacer algo y comer rico. Si querés, también te reservo una excursión.',
        language: 'es',
        prompt: { prompt: PROMPT, llm: LLM, temperature: 0.3, tool_ids: HERRAMIENTAS.map((h) => ids.herramientas[h.name]) },
      },
      // "Turbo": eleven_turbo_v2_5 es el modelo Turbo multilingüe (el turbo_v2 a secas es solo inglés).
      tts: { model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_turbo_v2_5', ...(VOZ ? { voice_id: VOZ } : {}) },
      conversation: { text_only: false },
    },
    // Permite que la página abra sesiones de solo texto y cambie el saludo al pasar de texto a voz.
    platform_settings: { overrides: { conversation_config_override: { agent: { first_message: true }, conversation: { text_only: true } } } },
  };
  if (completo) {
    c.conversation_config.agent.prompt.timezone = 'America/Argentina/Jujuy';
    c.conversation_config.agent.dynamic_variables = { dynamic_variable_placeholders: { fecha_hora_local: 'sin dato', ubicacion_usuario: 'desconocida', catalogo_pagos: 'No hay experiencias cargadas para reservar.' } };
    c.conversation_config.conversation.max_duration_seconds = 1800;
    c.conversation_config.conversation.client_events = ['conversation_initiation_metadata', 'ping', 'audio', 'interruption', 'user_transcript', 'agent_response', 'agent_response_correction', 'client_tool_call'];
  }
  return c;
}

async function guardarAgente(completo) {
  if (ids.agente) { await api('PATCH', `/v1/convai/agents/${ids.agente}`, config(completo)); return 'actualizado'; }
  const d = await api('POST', '/v1/convai/agents/create', config(completo));
  ids.agente = d.agent_id;
  return 'creado';
}

let hecho;
try { hecho = await guardarAgente(true); } catch (e) {
  if (e.status !== 400 && e.status !== 422) throw e;
  console.warn(`La API rechazó la configuración completa:\n  ${e.message}\nReintento sin los ajustes opcionales (zona horaria, eventos, duración)...`);
  hecho = await guardarAgente(false);
  console.warn('Agente guardado con la configuración mínima. Revisá en el panel de ElevenLabs que estén activos los eventos "agent_response" y "client_tool_call".');
}
writeFileSync(IDS, JSON.stringify(ids, null, 1));

// guarda el id en .env para el servidor
let env = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
env = /^ELEVENLABS_AGENT_ID=.*$/m.test(env) ? env.replace(/^ELEVENLABS_AGENT_ID=.*$/m, `ELEVENLABS_AGENT_ID=${ids.agente}`) : `${env.replace(/\s*$/, '')}\nELEVENLABS_AGENT_ID=${ids.agente}\n`;
writeFileSync(ENV, env);

console.log(`\nAgente ${hecho}: ${ids.agente}  (modelo ${LLM}, voz ${process.env.ELEVENLABS_TTS_MODEL || 'eleven_turbo_v2_5'})`);
console.log('Listo. Ahora: node server.mjs  y abrí http://localhost:3000');
