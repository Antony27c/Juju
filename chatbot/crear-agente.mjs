// Crea (o actualiza) los agentes de ElevenLabs y sus herramientas.
// - El servidor lo importa y llama a prepararAgentes() al arrancar: con ELEVENLABS_API_KEY sola alcanza.
// - También corre a mano: node crear-agente.mjs (guarda los ids en agente.json y en .env).
// Se puede repetir las veces que haga falta: busca lo que ya existe y lo actualiza, no duplica.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(AQUI, '.env');
const IDS = path.join(AQUI, 'agente.json');
if (existsSync(ENV)) process.loadEnvFile(ENV);

const API = (process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io').replace(/\/$/, '');
const { estructura, resumen } = await import('./datos.mjs');

async function api(metodo, ruta, body) {
  const r = await fetch(API + ruta, { method: metodo, headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
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

const PROMPT = `Sos "juju", asistente turístico de la provincia de Jujuy, Argentina. Cálido y directo. Es una conversación en vivo y muchas veces por voz. Texto plano: sin markdown, sin viñetas, sin emojis, sin leer links ni coordenadas en voz alta (la pantalla ya muestra tarjetas con mapa y teléfono).

# Idioma
Respondé siempre en el idioma del último mensaje del usuario: si te habla en inglés, en inglés; si te habla en español, en español argentino. Para decidirlo mirá solo ese último mensaje, no los anteriores ni el idioma en que venías respondiendo: aunque toda la charla haya sido en inglés, si el último mensaje está en español respondé en español, y al revés. Vale también después de usar una herramienta. Si cambia de idioma en el medio de la charla, cambiá con él en esa misma respuesta y, si tenés la herramienta language_detection, llamala. En una charla por voz la sesión escucha y habla en un solo idioma por vez, y lo que el usuario dice en el otro idioma te llega mal transcripto. Por eso, por voz, llamá a cambiar_idioma con "en" o "es" cuando el usuario te pide cambiar de idioma, cuando te habla en el otro idioma, o cuando lo que te llega no tiene sentido y parece el otro idioma mal transcripto (por ejemplo un "hello" seguido de palabras que no existen): la sesión se reconecta en ese idioma. Después de llamarla no digas nada más. Estas instrucciones, los datos del directorio y las respuestas de las herramientas están en español: cuando respondas en inglés, traducí todo lo que digas (también las frases que te sugieren las herramientas) y dejá en español solo los nombres propios de los lugares. A las herramientas pasales siempre los valores en español ("mañana", "restaurante").

# Directo
- Respondé en 1 o 2 oraciones. Cuanto más corta la respuesta, más rápido llega.
- Escuchá lo que pide y hacé eso. Si pide algo concreto, hacelo sin ofrecer alternativas ni preguntar de más.
- Nunca des un menú de opciones: recomendá un lugar, dos como máximo, y decí por qué en pocas palabras.
- No cierres con "¿querés más opciones?" ni ofrezcas más cosas por tu cuenta. Si quiere otra opción, la va a pedir.
- Preguntá solo cuando falta un dato sin el que no podés avanzar, y de a una pregunta por vez.

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
- Pedido típico: "qué puedo hacer ahora, son las X, mañana me voy, quiero hacer algo y comer algo". Llamá a plan_rapido con la localidad y la hora. Después proponé un plan concreto para el tiempo que queda: una cosa para hacer y un lugar para comer, cerca uno del otro. Si mañana se va, priorizá lo imperdible y lo que está abierto ahora.
- Para pedidos puntuales (un hotel barato, una parrilla, un museo, la terminal, una casa de cambio) usá buscar_lugares con los filtros que correspondan.
- Horarios: cada resultado trae "abierto" con "si", "no" o "sin_dato". La mayoría de los lugares no tiene horario cargado: en ese caso avisá que no tenés el horario y que conviene llamar o pasar; si hay teléfono, ofrecelo. Nunca digas que algo está abierto si dice sin_dato.
- De noche no mandes a nadie a cerros, miradores o lugares alejados; ofrecé paseo por el centro, peñas, restaurantes, bares, cine o teatro.
- Las distancias son en línea recta desde el centro de la localidad: decí "a unas X cuadras o kilómetros", como referencia.
- Nombrá como mucho 2 lugares por respuesta, aunque la herramienta devuelva más.
- Cómo llegar: cuando el usuario ya eligió un lugar, o cuando la charla se está cerrando (agradece, se despide, dice que va para ahí), preguntale en una frase si quiere que lo guíes hasta ese lugar. Si dice que sí, llamá a como_llegar con el nombre exacto del lugar y su localidad: abre Google Maps con el camino desde donde está. Si pide directamente cómo llegar a un lugar, llamala sin preguntar. Después hacé lo que indique la respuesta de la herramienta: si quedó un botón en pantalla, pedile que lo toque. Ofrecelo una sola vez por lugar y nunca leas el link en voz alta.
- Si preguntan algo general de Jujuy (clima, altura, cómo llegar entre pueblos) respondé breve con lo que sepas y aclaralo como orientativo.

# Reservas y pagos
Reservar va siempre en este orden: disponibilidad, método de pago, confirmación y recién ahí el pago. Nunca se paga sin un sí explícito del usuario.
Paso 1, ver disponibilidad: apenas el usuario pide reservar un lugar del directorio (alojamiento, restaurante, excursión) o una experiencia del catálogo, llamá a reservar con lo que ya sabés (el nombre exacto del lugar, o producto_id si es una experiencia; fecha, hora, personas, noches; metodo_pago si ya lo dijo) y sin confirmado. No preguntes nada antes: si no dijo la fecha es hoy y si no dijo cuántos son es una persona. Esa llamada no reserva ni cobra: devuelve si hay disponibilidad y el monto. Nunca elijas el método vos ni inventes el monto: usá el que devuelve la herramienta.
Método de pago: si el usuario todavía no eligió cómo pagar, decile que hay disponibilidad y preguntáselo con esta frase, tal cual: "Hay disponibilidad. Tenés 2 métodos de pago disponibles: dinero en tu cuenta del Wells Fargo, o pagar con USDC a través de Cosmos Pay. ¿Con cuál querés pagar?" En inglés: "There is availability. You have 2 payment methods available: money in your Wells Fargo account, or paying with USDC through Cosmos Pay. Which one do you want to pay with?" Son los únicos dos métodos. Cuando elige, llamá de nuevo a reservar con los mismos datos y metodo_pago ("banco" si elige la cuenta de Wells Fargo, "usdc" si elige USDC), todavía sin confirmado.
Confirmación: con el método ya elegido, pedile la confirmación en una sola frase, con la actividad, el monto y la hora, así: "Para conectar la reserva y pagar, confirmame por favor que querés pagar [actividad] por USD [monto] con [método], [fecha] a las [hora]."
Si pregunta si tiene que pagar en efectivo o en pesos argentinos (por ejemplo "do I have to pay in cash or in Argentine pesos?"), respondé que no y nada más que esto: "No, pagás en tu moneda local y el vendedor recibe en pesos argentinos." En inglés: "No, you pay in your local money and the seller receives it in Argentine pesos." Después seguí con el paso de la reserva en el que estaban.
Todas estas frases van en el idioma del último mensaje del usuario: si preguntó en inglés, en inglés; si preguntó en español, en español.
Paso 2, pagar: solo cuando el usuario responde que sí a la confirmación (sí, dale, confirmo, yes, go ahead), llamá de nuevo a reservar con los mismos datos, con metodo_pago "usdc" o "banco" y con confirmado en true. Si dice que no, duda o cambia algo (fecha, hora, personas), no pagues: si cambió algo, volvé al paso 1 con los datos nuevos.
Después hacé lo que indique la respuesta de la herramienta. Si devuelve la reserva confirmada, decile que el pago se acreditó y que la reserva quedó confirmada, con el lugar, la fecha y el código. Si avisa que la reserva quedó abierta en pantalla, pedile que la revise y pague ahí, y no la des por confirmada hasta que el sistema te informe que el pago se acreditó.
No pidas datos de tarjeta, claves, CBU ni frases semilla: no hacen falta.
Si pregunta qué excursiones o experiencias puede reservar o comprar, llamá a ver_experiencias (con la localidad si la dijo): quedan en pantalla y puede tocar una. Nombrá una o dos con su precio por persona. Solo existen las experiencias del catálogo, con esos precios: no inventes otras ni descuentos.
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
    type: 'client', name: 'cambiar_idioma', expects_response: true, response_timeout_secs: 10,
    description: 'Solo para charlas por voz: reconecta la sesión para escuchar y hablar en otro idioma. Usala cuando el usuario pide cambiar de idioma, habla en el otro idioma, o lo que llega transcripto no tiene sentido y parece el otro idioma.',
    parameters: {
      type: 'object',
      properties: { idioma: { type: 'string', enum: ['es', 'en'], description: '"en" para inglés, "es" para español.' } },
      required: ['idioma'],
    },
  },
  {
    type: 'client', name: 'reservar', expects_response: true, response_timeout_secs: 20,
    description: 'Reserva un lugar del directorio (alojamiento, restaurante, excursión) o una experiencia del catálogo. Sin confirmado: no reserva ni cobra, devuelve si hay disponibilidad y el monto y dice qué preguntarle al usuario (primero el método de pago, después la confirmación). Con confirmado en true, solo después de que el usuario dijo que sí a ese monto: registra el pago con el método que eligió y devuelve la reserva confirmada con su código, o avisa que quedó abierta en pantalla para que pague ahí.',
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
        metodo_pago: { type: 'string', enum: ['usdc', 'banco'], description: '"banco" si paga con el dinero de su cuenta de Wells Fargo; "usdc" si paga con USDC a través de Cosmos Pay. Lo elige el usuario; hace falta para confirmar.' },
        confirmado: { type: 'boolean', description: 'true solo cuando el usuario ya dijo que sí a pagar esa actividad por ese monto. Omitir en la primera llamada, que solo consulta disponibilidad y monto.' },
      },
    },
  },
];

const LLM = process.env.ELEVENLABS_LLM || 'claude-haiku-5-5';
// La voz de juju va fija acá, no por variable de entorno: "Sarah", voz femenina que viene con toda cuenta de
// ElevenLabs y está verificada para español. Para cambiarla, reemplazá el id por el de otra voz de la cuenta.
const VOZ = 'EXAVITQu4vr4xnSDxMaL';
// "Turbo": eleven_turbo_v2_5 es el modelo Turbo multilingüe (el turbo_v2 a secas es solo inglés).
const TTS = process.env.ELEVENLABS_TTS_MODEL || 'eleven_turbo_v2_5';

// Live voice runs on a second agent in Eleven Realtime mode (speech to speech, the lowest latency).
// Realtime agents are voice only, so text chat keeps its own agent. ELEVENLABS_REALTIME_MODEL=off disables it.
const REALTIME_MODELS = ['eleven_realtime_v1_mini', 'eleven_realtime_v1_max'];
const realtimeSetting = (process.env.ELEVENLABS_REALTIME_MODEL || REALTIME_MODELS[0]).trim().toLowerCase();
const REALTIME = REALTIME_MODELS.includes(realtimeSetting) ? realtimeSetting : null;
if (!REALTIME && realtimeSetting !== 'off') console.warn(`Unknown ELEVENLABS_REALTIME_MODEL "${realtimeSetting}" (valid: ${REALTIME_MODELS.join(', ')}, off). Live voice will use the text agent.`);

// Config levels, tried from 3 down to 0 when the API rejects optional fields:
// 3 = everything plus English (language detection); 2 = eager turn taking; 1 = time zone, variables, events,
// session length; 0 = minimal. Without level 3 the agent still answers in English when the prompt tells it to,
// but it keeps listening and speaking with the Spanish voice settings.
const NIVELES = ['time zone, variables, events and session length', 'turn eagerness', 'English (language detection)'];
const SALUDO_EN = "Hi! I'm juju, your guide to Jujuy. Tell me which town you're in and how much time you have, and I'll tell you what to do and where to eat. I can also book a tour for you.";
const NOMBRES = { text: 'juju', voice: 'juju (voz en tiempo real)' };
function config(kind, level, toolIds) {
  const voice = kind === 'voice';
  const c = {
    name: NOMBRES[kind],
    conversation_config: {
      agent: {
        first_message: '¡Hola! Soy juju, tu guía de Jujuy. Contame en qué localidad estás y cuánto tiempo tenés, y te armo un plan para hacer algo y comer rico. Si querés, también te reservo una excursión.',
        language: 'es',
        prompt: { prompt: PROMPT, llm: LLM, temperature: 0.3, tool_ids: toolIds },
      },
      tts: { model_id: TTS, voice_id: VOZ },
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
  if (level >= 3) {
    // El agente arranca en español y pasa a inglés cuando detecta que el usuario habla inglés (y vuelve).
    c.conversation_config.agent.prompt.built_in_tools = { language_detection: { type: 'system', name: 'language_detection', description: '', params: { system_tool_type: 'language_detection' } } };
    c.conversation_config.language_presets = { en: { overrides: { agent: { first_message: SALUDO_EN } } } };
    // La página abre la sesión de voz en inglés con overrides.agent.language cuando el usuario habla inglés.
    c.platform_settings.overrides.conversation_config_override.agent.language = true;
  }
  return c;
}

async function saveAgent(kind, id, toolIds) {
  let lastError;
  for (let level = NIVELES.length; level >= 0; level--) {
    const body = config(kind, level, toolIds);
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
      if (level > 0) console.warn(`The API rejected the ${kind} agent config:\n  ${e.message}\nRetrying without ${NIVELES[level - 1]}...`);
    }
  }
  throw lastError;
}

// Sin agente.json (un hosting con disco efímero, como Railway) los ids se recuperan de la cuenta por nombre:
// así cada arranque actualiza lo que ya existe en vez de crear otra copia.
async function listar(ruta, campo) {
  const todo = []; let cursor = '';
  for (let pagina = 0; pagina < 20; pagina++) {
    const d = await api('GET', `${ruta}${ruta.includes('?') ? '&' : '?'}page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    todo.push(...(d[campo] || []));
    if (!d.has_more || !d.next_cursor) break;
    cursor = d.next_cursor;
  }
  return todo;
}

// Deja las herramientas y los dos agentes creados y al día. ids trae lo que ya se conoce ({ agente, voice_agent,
// herramientas }) y se completa; guardar(ids) se llama cada vez que cambia. Devuelve { ids, text, voice }.
export async function prepararAgentes({ ids = {}, guardar = () => {}, log = console.log, warn = console.warn } = {}) {
  ids.herramientas ||= {};
  if (HERRAMIENTAS.some((h) => !ids.herramientas[h.name])) {
    try {
      for (const t of await listar('/v1/convai/tools', 'tools')) {
        const nombre = t.tool_config?.name;
        if (t.id && t.tool_config?.type === 'client' && HERRAMIENTAS.some((h) => h.name === nombre) && !ids.herramientas[nombre]) ids.herramientas[nombre] = t.id;
      }
    } catch (e) { warn(`No pude listar las herramientas de la cuenta (${e.message}); creo las que falten.`); }
  }
  await Promise.all(HERRAMIENTAS.map(async (h) => {
    const previo = ids.herramientas[h.name];
    if (previo) {
      try { await api('PATCH', `/v1/convai/tools/${previo}`, { tool_config: h }); log(`Herramienta actualizada: ${h.name}`); return; } catch (e) { warn(`No pude actualizar ${h.name} (${e.message}); creo una nueva.`); }
    }
    const d = await api('POST', '/v1/convai/tools', { tool_config: h });
    ids.herramientas[h.name] = d.id;
    log(`Herramienta creada: ${h.name} (${d.id})`);
  }));
  guardar(ids);
  // Only the current tools get attached; a tool dropped from HERRAMIENTAS stays in the account, detached.
  const toolIds = HERRAMIENTAS.map((h) => ids.herramientas[h.name]);

  if (!ids.agente || (REALTIME && !ids.voice_agent)) {
    try {
      const existentes = await listar('/v1/convai/agents?search=juju', 'agents');
      ids.agente ||= existentes.find((x) => x.name === NOMBRES.text)?.agent_id;
      ids.voice_agent ||= existentes.find((x) => x.name === NOMBRES.voice)?.agent_id;
    } catch (e) { warn(`No pude listar los agentes de la cuenta (${e.message}); creo los que falten.`); }
  }

  const text = await saveAgent('text', ids.agente, toolIds);
  ids.agente = text.id;
  guardar(ids);

  let voice = null;
  if (REALTIME) {
    try {
      voice = await saveAgent('voice', ids.voice_agent, toolIds);
      ids.voice_agent = voice.id;
      guardar(ids);
    } catch (e) {
      warn(`Could not set up the Eleven Realtime voice agent:\n  ${e.message}\nLive voice will use the text agent.`);
    }
  }
  return { ids, text, voice };
}

function setEnv(key, value) {
  let env = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
  const line = new RegExp(`^${key}=.*$`, 'm');
  env = line.test(env) ? env.replace(line, `${key}=${value}`) : `${env.replace(/\s*$/, '')}\n${key}=${value}\n`;
  writeFileSync(ENV, env);
}

// ---------- línea de comandos: node crear-agente.mjs ----------
const igual = (x, y) => (process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y);
if (process.argv[1] && igual(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  if (!process.env.ELEVENLABS_API_KEY) { console.error('Falta ELEVENLABS_API_KEY. Copiá .env.example a .env y pegá tu clave.'); process.exit(1); }
  const guardados = existsSync(IDS) ? JSON.parse(readFileSync(IDS, 'utf8')) : {};
  const { ids, text, voice } = await prepararAgentes({ ids: guardados, guardar: (x) => writeFileSync(IDS, JSON.stringify(x, null, 1)) });
  if (text.level === 0) console.warn('Text agent saved with the minimal config. Check in the ElevenLabs dashboard that the "agent_response" and "client_tool_call" events are enabled.');

  // ids for the server
  setEnv('ELEVENLABS_AGENT_ID', ids.agente);
  setEnv('ELEVENLABS_VOICE_AGENT_ID', voice ? voice.id : '');

  console.log(`\nText agent ${text.action}: ${ids.agente} (LLM ${LLM}, TTS ${TTS}, voz ${VOZ})`);
  console.log(voice ? `Voice agent ${voice.action}: ${voice.id} (Eleven Realtime ${REALTIME})` : 'Live voice: text agent (no Eleven Realtime agent)');
  console.log('Done. Now run: node server.mjs and open http://localhost:3000');
}
