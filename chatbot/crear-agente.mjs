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

const PROMPT = `Sos "juju", asistente turístico de la provincia de Jujuy, Argentina. Hablás en español argentino, cálido y directo. Respuestas cortas, de 1 a 3 oraciones: es una conversación en vivo y muchas veces por voz, y cuanto más corta la respuesta, más rápido llega. Texto plano: sin markdown, sin viñetas, sin emojis, sin leer links ni coordenadas en voz alta (la pantalla ya muestra tarjetas con mapa y teléfono).

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
Muchas veces el sistema te pasa un bloque que empieza con "DATOS DEL DIRECTORIO": son lugares ya filtrados por localidad, hora y tipo. Llega justo antes de un mensaje escrito o apenas el usuario termina de hablar, y al empezar una charla por voz llega uno con lo que hay cerca. Si alcanza para responder, respondé directo con eso y no llames a ninguna herramienta: es más rápido. Llamá a una herramienta solo si el bloque no cubre lo pedido (otra localidad, otro horario, otro tipo de lugar, más opciones) o si no llegó ningún bloque.

# Cómo ayudar
- Si no sabés en qué localidad está, preguntalo en una frase antes de buscar. "Jujuy" a secas suele ser San Salvador de Jujuy: asumilo y decilo.
- Pedido típico: "qué puedo hacer ahora, son las X, mañana me voy, quiero hacer algo y comer algo". Llamá a plan_rapido con la localidad y la hora. Después proponé un plan concreto y ordenado para el tiempo que queda: 1 o 2 cosas para hacer y 1 o 2 lugares para comer, todo cerca. Si mañana se va, priorizá lo imperdible y lo que está abierto ahora, y sugerí qué puede hacer mañana temprano antes de irse si alcanza.
- Para pedidos puntuales (un hotel barato, una parrilla, un museo, la terminal, una casa de cambio) usá buscar_lugares con los filtros que correspondan.
- Horarios: cada resultado trae "abierto" con "si", "no" o "sin_dato". La mayoría de los lugares no tiene horario cargado: en ese caso avisá que no tenés el horario y que conviene llamar o pasar; si hay teléfono, ofrecelo. Nunca digas que algo está abierto si dice sin_dato.
- De noche no mandes a nadie a cerros, miradores o lugares alejados; ofrecé paseo por el centro, peñas, restaurantes, bares, cine o teatro.
- Las distancias son en línea recta desde el centro de la localidad: decí "a unas X cuadras o kilómetros", como referencia.
- Nombrá como mucho 3 lugares por respuesta y preguntá si quiere más opciones o más detalle de alguno.
- Cómo llegar: cuando el usuario ya eligió un lugar, o cuando la charla se está cerrando (agradece, se despide, dice que va para ahí), preguntale en una frase si quiere que lo guíes hasta ese lugar. Si dice que sí, llamá a como_llegar con el nombre exacto del lugar y su localidad: abre Google Maps con el camino desde donde está. Si pide directamente cómo llegar a un lugar, llamala sin preguntar. Después hacé lo que indique la respuesta de la herramienta: si quedó un botón en pantalla, pedile que lo toque. Ofrecelo una sola vez por lugar y nunca leas el link en voz alta.
- Si preguntan algo general de Jujuy (clima, altura, cómo llegar entre pueblos) respondé breve con lo que sepas y aclaralo como orientativo.

# Reservas y pagos
Si el usuario quiere reservar un lugar del directorio (alojamiento, restaurante, excursión) o una experiencia del catálogo, preguntale en una sola frase lo que falte: para cuándo, cuántas personas (y cuántas noches si es alojamiento) y si quiere pagar con USDC o con dinero de su cuenta bancaria por transferencia. Siempre preguntá el método de pago y esperá a que elija: nunca lo elijas vos. Apenas elige, llamá a reservar con metodo_pago "usdc" o "banco" y con el nombre exacto del lugar, o con producto_id si es una experiencia del catálogo.
Después hacé lo que indique la respuesta de la herramienta. Si devuelve la reserva confirmada, decile que el pago se acreditó y que la reserva quedó confirmada, con el lugar, la fecha y el código. Si avisa que la reserva quedó abierta en pantalla, pedile que la revise y pague ahí, y no la des por confirmada hasta que el sistema te informe que el pago se acreditó.
No pidas datos de tarjeta, claves, CBU ni frases semilla: no hacen falta.
Si pregunta qué excursiones o experiencias puede reservar o comprar, llamá a ver_experiencias (con la localidad si la dijo): quedan en pantalla y puede tocar una. Nombrá dos o tres con su precio por persona y preguntá cuál le interesa. Solo existen las experiencias del catálogo, con esos precios: no inventes otras ni descuentos.
Experiencias del catálogo: {{catalogo_pagos}}`;

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
    type: 'client', name: 'como_llegar', expects_response: true, response_timeout_secs: 20,
    description: 'Abre Google Maps con el camino desde donde está el usuario hasta un lugar del directorio y deja en pantalla el botón "Abrir en Google Maps". Usala cuando el usuario acepta que lo guíes hasta un lugar o pide cómo llegar.',
    parameters: {
      type: 'object',
      properties: {
        lugar: { type: 'string', description: 'Nombre exacto del lugar tal como figura en el directorio.' },
        localidad: { type: 'string', description: 'Localidad del lugar. Opcional.' },
      },
      required: ['lugar'],
    },
  },
  {
    type: 'client', name: 'reservar', expects_response: true, response_timeout_secs: 20,
    description: 'Reserva un lugar del directorio (alojamiento, restaurante, excursión) o una experiencia del catálogo y registra el pago con el método que eligió el usuario. Devuelve la reserva confirmada con su código, o avisa que quedó abierta en pantalla para que el usuario pague ahí. Llamala solo después de que el usuario eligió pagar con USDC o con transferencia bancaria.',
    parameters: {
      type: 'object',
      properties: {
        lugar: { type: 'string', description: 'Nombre exacto del lugar tal como figura en el directorio. Omitir si se reserva una experiencia del catálogo.' },
        localidad: { type: 'string', description: 'Localidad del lugar.' },
        producto_id: { type: 'string', description: 'Id de la experiencia del catálogo, solo si se reserva una experiencia en vez de un lugar.' },
        fecha: { type: 'string', description: 'Para cuándo es la reserva, como lo dijo el usuario: "hoy", "mañana", "sábado 28".' },
        hora: { type: 'string', description: 'Hora HH:MM (24 h) para restaurantes o excursiones. Opcional.' },
        personas: { type: 'integer', description: 'Cantidad de personas.' },
        noches: { type: 'integer', description: 'Cantidad de noches, solo alojamiento.' },
        metodo_pago: { type: 'string', enum: ['usdc', 'banco'], description: '"usdc" si paga con USDC; "banco" si paga con dinero de su cuenta bancaria por transferencia. Preguntarlo siempre antes.' },
      },
      required: ['metodo_pago'],
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
// Only the current tools get attached; a tool dropped from HERRAMIENTAS stays in the account, detached.
const toolIds = HERRAMIENTAS.map((h) => ids.herramientas[h.name]);

const LLM = process.env.ELEVENLABS_LLM || 'claude-haiku-5-5';
const VOZ = process.env.ELEVENLABS_VOICE_ID;
// "Turbo": eleven_turbo_v2_5 es el modelo Turbo multilingüe (el turbo_v2 a secas es solo inglés).
const TTS = process.env.ELEVENLABS_TTS_MODEL || 'eleven_turbo_v2_5';

// Live voice runs on a second agent in Eleven Realtime mode (speech to speech, the lowest latency).
// Realtime agents are voice only, so text chat keeps its own agent. ELEVENLABS_REALTIME_MODEL=off disables it.
const REALTIME_MODELS = ['eleven_realtime_v1_mini', 'eleven_realtime_v1_max'];
const realtimeSetting = (process.env.ELEVENLABS_REALTIME_MODEL || REALTIME_MODELS[0]).trim().toLowerCase();
const REALTIME = REALTIME_MODELS.includes(realtimeSetting) ? realtimeSetting : null;
if (!REALTIME && realtimeSetting !== 'off') console.warn(`Unknown ELEVENLABS_REALTIME_MODEL "${realtimeSetting}" (valid: ${REALTIME_MODELS.join(', ')}, off). Live voice will use the text agent.`);

// Config levels, tried from 2 down to 0 when the API rejects optional fields:
// 2 = everything plus eager turn taking; 1 = time zone, variables, events, session length; 0 = minimal.
function config(kind, level) {
  const voice = kind === 'voice';
  const c = {
    name: voice ? 'juju (voz en tiempo real)' : 'juju',
    conversation_config: {
      agent: {
        first_message: '¡Hola! Soy juju, tu guía de Jujuy. Contame en qué localidad estás y cuánto tiempo tenés, y te armo un plan para hacer algo y comer rico. Si querés, también te reservo una excursión.',
        language: 'es',
        prompt: { prompt: PROMPT, llm: LLM, temperature: 0.3, tool_ids: toolIds },
      },
      tts: { model_id: TTS, ...(VOZ ? { voice_id: VOZ } : {}) },
      conversation: { text_only: false },
    },
    // Permite cambiar el saludo al reconectar; el agente de texto además admite sesiones de solo texto.
    platform_settings: { overrides: { conversation_config_override: { agent: { first_message: true }, ...(voice ? {} : { conversation: { text_only: true } }) } } },
  };
  // In Realtime mode ElevenLabs manages the LLM and the TTS model, so prompt.llm and tts.model_id are ignored.
  if (voice) c.conversation_config.realtime_model = REALTIME;
  if (level >= 1) {
    c.conversation_config.agent.prompt.timezone = 'America/Argentina/Jujuy';
    c.conversation_config.agent.dynamic_variables = { dynamic_variable_placeholders: { fecha_hora_local: 'sin dato', ubicacion_usuario: 'desconocida', catalogo_pagos: 'No hay experiencias cargadas para reservar.' } };
    c.conversation_config.conversation.max_duration_seconds = 1800;
    c.conversation_config.conversation.client_events = ['conversation_initiation_metadata', 'ping', 'audio', 'interruption', 'user_transcript', 'agent_response', 'agent_response_correction', 'client_tool_call'];
  }
  if (level >= 2) c.conversation_config.turn = { turn_eagerness: 'eager' };
  return c;
}

async function saveAgent(kind, id) {
  let lastError;
  for (let level = 2; level >= 0; level--) {
    const body = config(kind, level);
    try {
      if (id) {
        try { await api('PATCH', `/v1/convai/agents/${id}`, body); return { id, action: 'updated', level }; } catch (e) {
          if (e.status !== 404) throw e;
          console.warn(`Agent ${id} no longer exists; creating a new one.`);
          id = null;
        }
      }
      const d = await api('POST', '/v1/convai/agents/create', body);
      return { id: d.agent_id, action: 'created', level };
    } catch (e) {
      if (e.status !== 400 && e.status !== 422) throw e;
      if (kind === 'voice' && /realtime/i.test(e.message)) throw e; // Realtime itself was rejected: no point in retrying
      lastError = e;
      if (level > 0) console.warn(`The API rejected the ${kind} agent config:\n  ${e.message}\nRetrying without ${level === 2 ? 'turn eagerness' : 'time zone, variables, events and session length'}...`);
    }
  }
  throw lastError;
}

function setEnv(key, value) {
  let env = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
  const line = new RegExp(`^${key}=.*$`, 'm');
  env = line.test(env) ? env.replace(line, `${key}=${value}`) : `${env.replace(/\s*$/, '')}\n${key}=${value}\n`;
  writeFileSync(ENV, env);
}

const text = await saveAgent('text', ids.agente);
ids.agente = text.id;
writeFileSync(IDS, JSON.stringify(ids, null, 1));
if (text.level === 0) console.warn('Text agent saved with the minimal config. Check in the ElevenLabs dashboard that the "agent_response" and "client_tool_call" events are enabled.');

let voice = null;
if (REALTIME) {
  try {
    voice = await saveAgent('voice', ids.voice_agent);
    ids.voice_agent = voice.id;
    writeFileSync(IDS, JSON.stringify(ids, null, 1));
  } catch (e) {
    console.warn(`Could not set up the Eleven Realtime voice agent:\n  ${e.message}\nLive voice will use the text agent.`);
  }
}

// ids for the server
setEnv('ELEVENLABS_AGENT_ID', ids.agente);
setEnv('ELEVENLABS_VOICE_AGENT_ID', voice ? voice.id : '');

console.log(`\nText agent ${text.action}: ${ids.agente} (LLM ${LLM}, TTS ${TTS})`);
console.log(voice ? `Voice agent ${voice.action}: ${voice.id} (Eleven Realtime ${REALTIME})` : 'Live voice: text agent (no Eleven Realtime agent)');
console.log('Done. Now run: node server.mjs and open http://localhost:3000');
