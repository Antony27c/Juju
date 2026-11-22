# juju: integración técnica con ElevenLabs y RAG de datos

Este documento describe cómo está conectado **juju** (el chatbot guía de Jujuy) con la plataforma de agentes de ElevenLabs y cómo se le entregan los datos del directorio turístico para que responda rápido.

Todo el código está en `chatbot/`. Los datos están en la raíz del repo (`estructura.json`, `jujuy_turismo.json`).

## Estado de las pruebas

Leer esto primero, porque define qué está comprobado y qué no.

| Parte | Estado |
|---|---|
| Búsqueda, plan rápido, horarios, RAG local | Probado con el servidor levantado y con consultas reales |
| Pago simulado de punta a punta | Probado |
| Cosmos Pay: crear un pago | Probado contra su red de prueba (devolvió link de pago y QR) |
| Cosmos Pay: consultar estado y webhook | Firma del webhook probada en local. La consulta de estado necesita una clave propia |
| Sesión con ElevenLabs (texto y voz) | **Sin probar**: falta la clave de API. Los nombres de campos y métodos se verificaron contra la documentación y contra el código del SDK 1.37.1 |
| Página en el navegador | Revisada con capturas en escritorio y celular, tema claro y oscuro, en modo "solo directorio" (sin ElevenLabs). La pantalla principal es la vista de voz (micrófono con rótulo, subtítulos en grande y una faja de aguayo que se levanta con la voz); la faja y los estados de escucha y silencio se vieron con una sesión simulada en el navegador, no con una sesión de voz real |
| Reserva de experiencias | Probada de punta a punta con el pago simulado: validación de personas y fecha, total, código de reserva y confirmación. La reserva de demostración (`/api/reservas`) se probó contra el servidor. Las herramientas `ver_experiencias` y `reservar` no se probaron con el agente |

El primer `node crear-agente.mjs` con una clave real es la prueba que falta. Si la API rechaza algún campo, el script imprime el error completo y reintenta con una configuración mínima.

## Eleven Realtime voice and demo bookings

Added on 2026-11-22. This section describes the current behaviour; where an older paragraph below disagrees, this section wins.

### Live voice on Eleven Realtime

- `crear-agente.mjs` now creates **two agents** with the same prompt and tools:
  - `juju`: the text agent (LLM + TTS, as before). It serves text chat.
  - `juju (voz en tiempo real)`: the live voice agent, with `conversation_config.realtime_model` set to `eleven_realtime_v1_mini` (default) or `eleven_realtime_v1_max`. Eleven Realtime is speech to speech, so the agent starts talking sooner. In this mode ElevenLabs manages the LLM and the TTS model and ignores `prompt.llm` and `tts.model_id`. Prompt, voice, tools, language and temperature still apply.
- Why two agents: the ElevenLabs docs say Realtime agents are built for voice and recommend Custom mode for text-only agents, and the page uses both.
- `/api/sesion?modo=voz` returns a conversation token for the voice agent (`ELEVENLABS_VOICE_AGENT_ID`). Text keeps using `ELEVENLABS_AGENT_ID`.
- `ELEVENLABS_REALTIME_MODEL=off` turns it off. If the workspace has no access to Realtime, the script prints the API error, leaves `ELEVENLABS_VOICE_AGENT_ID` empty, and live voice uses the text agent as before.
- Both agents get `conversation_config.turn.turn_eagerness = "eager"`, so the agent answers as soon as the user stops talking. If the API rejects it, the script retries without it.
- Data in voice: the user's words go straight to ElevenLabs, so nothing can be attached before the answer starts. Instead:
  1. When the voice session opens, the page sends a "what to do and where to eat nearby" block (`/api/contexto` with `nearby: true`) for the known locality or shared location. The first spoken question can then be answered without a tool call.
  2. On every final user transcript, the page runs the same local pre-search as text chat. It shows the places on screen at once and sends the block with `sendContextualUpdate`, so follow-up questions have the data.
  3. The agent still calls `plan_rapido` and `buscar_lugares` when the data it has does not cover the question.

### Speed

- The SDK loads when the page opens, not on the first message.
- Session credentials are prefetched: the text signed URL when the text box gets focus, the voice token when the pointer reaches the mic. Each credential is used once and kept for at most 60 seconds.
- The text session opens while the user is still typing, so the first message does not wait for the handshake.
- The pre-search runs at the same time as the connection, and its places appear before the answer.
- Smaller data blocks (4 places per group instead of 5) and shorter answers (1 to 3 sentences, at most 3 places).
- The same place is shown only once per turn, even when the pre-search and a tool both return it.

### Demo bookings (`reservar`)

- The `reservar` client tool replaces `solicitar_pago`. When the user wants to book a place from the directory (or a catalog product), the agent asks in one sentence for what is missing: date, people, nights for lodging, and **whether they pay with USDC or with money from their bank account by transfer**. The agent never picks the method itself (`metodo_pago` is required: `usdc` or `banco`).
- `POST /api/reservas` (`chatbot/reservas.mjs`) **simulates the payment and confirms the booking at once**. It returns a code such as `JUJ-4F2A9C`. Nothing is charged and nothing is actually booked. The card on the page says "Demo · pago simulado".
- The amount is a reference figure: catalog products use their price. Places use the price tier from `estructura.json`: lodging per night ($ 25, $$ 50, $$$ 110, $$$$ 180 USD) and the rest per person ($ 7, $$ 14, $$$ 30, $$$$ 50 USD). Free places cost 0.
- The Cosmos Pay code (`pagos.mjs`, `/api/pagos`, webhook) is unchanged, but the agent no longer uses it. To charge for real again, the `reservar` tool would have to call `/api/pagos` instead of `/api/reservas`.

### Test status of this change

| Part | Status |
|---|---|
| `/api/reservas`: lodging, restaurant, catalog product, unknown place, missing method or place | Tested against the local server |
| `/api/contexto` with `nearby: true`, plus normal messages and "gracias" | Tested against the local server |
| `crear-agente.mjs`: creating both agents, re-running (updates), rejected `turn`, Realtime unavailable | Tested against a local mock of the ElevenLabs API. **Not tested against the real API**: no key yet |
| Booking card in the browser | Checked on desktop and at 375 px wide (dark theme), no console errors |
| Realtime voice session, prefetch and warm-up against ElevenLabs | **Not tested**: needs the API key |

## Arquitectura

```
Navegador (public/index.html)
  │  SDK @elevenlabs/client 1.37.1
  │    ├─ texto: WebSocket con URL firmada
  │    └─ voz:   WebRTC con token de conversación
  │
  ├──► ElevenLabs Agents ──► modelo de lenguaje + voz Turbo v2.5
  │         ▲   │
  │         │   └─ pide ejecutar una herramienta "client"
  │         └───── resultado de la herramienta / datos adjuntos
  │
  └──► Servidor local (server.mjs, Node sin dependencias)
          ├─ /api/sesion     URL firmada o token (la clave nunca sale del servidor)
          ├─ /api/contexto   RAG local: datos ya filtrados para el próximo mensaje
          ├─ /api/plan       "qué hago ahora y dónde como"
          ├─ /api/buscar     búsqueda con filtros
          ├─ /api/reservas   demo bookings: fake payment (USDC or bank transfer) + confirmation
          └─ /api/pagos      Cosmos Pay o modo simulado
                  │
                  └─ datos.mjs: jujuy_turismo.json cargado en memoria
```

Puntos de diseño:

- La clave de ElevenLabs vive solo en `chatbot/.env`. El navegador recibe una URL firmada o un token de corta duración.
- Las herramientas del agente son de tipo **client**: ElevenLabs le pide al navegador que las ejecute y el navegador consulta al servidor local. Por eso funciona en `localhost` sin exponer nada a internet.
- Los datos no se suben a ElevenLabs. Se consultan en memoria en el servidor local.

## Archivos

| Archivo | Qué hace |
|---|---|
| `chatbot/server.mjs` | Servidor HTTP. Sirve la página y expone las rutas `/api/*` |
| `chatbot/crear-agente.mjs` | Crea o actualiza las herramientas y el agente en ElevenLabs. Guarda los ids en `agente.json` y en `.env` |
| `chatbot/datos.mjs` | Carga el directorio, resuelve localidades, `buscar()` y `planRapido()` |
| `chatbot/horarios.mjs` | Hora local de Jujuy (UTC−3) y lectura del formato `opening_hours` |
| `chatbot/contexto.mjs` | RAG local: detecta localidad, hora e intención en el mensaje y arma el bloque de datos |
| `chatbot/pagos.mjs` | Reservas y pagos: Cosmos Pay y proveedor simulado |
| `chatbot/productos.json` | Experiencias reservables, con precio por persona |
| `chatbot/verificar.mjs` | Revisa qué está listo y qué falta configurar. No cambia nada |
| `chatbot/reservas.mjs` | Demo bookings: simulated payment (USDC or bank transfer) and instant confirmation |
| `chatbot/public/index.html` | Interfaz de juju |
| `chatbot/.env.example` | Plantilla de configuración |

## Puesta en marcha

Requiere Node 21.7 o superior.

1. En `chatbot/`, copiar `.env.example` como `.env` y completar `ELEVENLABS_API_KEY`. La clave necesita permiso para ElevenLabs Agents.
2. `node server.mjs` y abrir `http://localhost:3000`. En Windows también sirve `iniciar.bat`, que crea el `.env` si falta y corre la verificación antes de arrancar.

`node verificar.mjs` muestra en cualquier momento qué está listo (datos, búsqueda, experiencias, pagos, agente) y qué falta.

Cada vez que se cambie el prompt o las herramientas hay que volver a correr el paso 2. El script actualiza el agente existente en vez de crear otro.

### Variables de entorno

| Variable | Uso |
|---|---|
| `ELEVENLABS_API_KEY` | Obligatoria |
| `ELEVENLABS_AGENT_ID` | Opcional. Vacía: el servidor busca el agente `juju` por nombre en la cuenta o lo crea, al arrancar (`prepararAgentes()` en `crear-agente.mjs`), y en cada arranque lo actualiza con el prompt, las cinco herramientas y la voz del código |
| `ELEVENLABS_SINCRONIZAR` | Opcional. `off`: el servidor no toca los agentes al arrancar |
| (voz) | No es una variable: la voz va fija en `crear-agente.mjs` (constante `VOZ`). Hoy es "Sarah", femenina, de las que trae toda cuenta. Para cambiarla se edita ese id y se vuelve a correr el script |
| `ELEVENLABS_TTS_MODEL` | Opcional. Por defecto `eleven_turbo_v2_5` |
| `ELEVENLABS_LLM` | Opcional. Por defecto `claude-haiku-5-5` |
| `ELEVENLABS_REALTIME_MODEL` | Optional. Live voice model: `eleven_realtime_v1_mini` (default), `eleven_realtime_v1_max` or `off` |
| `ELEVENLABS_VOICE_AGENT_ID` | Filled in by `crear-agente.mjs`. Empty = live voice uses the text agent |
| `ELEVENLABS_API_BASE` | Opcional. Por defecto `https://api.elevenlabs.io` |
| `PUERTO`, `HOST` | Por defecto `3000` y `127.0.0.1`. En un hosting se usa `PORT` y el servidor escucha en `0.0.0.0` |
| `URL_PUBLICA`, `PAGOS_ARCHIVO`, `LIMITE_SESIONES`, `LIMITE_PAGOS` | Opcionales, para un deploy. Ver "Deploy en Railway" en el README |
| `JUJUY_DATOS` | Opcional. Carpeta donde están `estructura.json` y `jujuy_turismo.json` |

## Integración con ElevenLabs

### Llamadas a la API (lado servidor)

Todas llevan el encabezado `xi-api-key`.

| Para qué | Llamada |
|---|---|
| Crear herramienta | `POST /v1/convai/tools` con `{ tool_config }`. Responde `{ id }` |
| Actualizar herramienta | `PATCH /v1/convai/tools/{id}`. Si falla, el script crea una nueva |
| Crear agente | `POST /v1/convai/agents/create`. Responde `{ agent_id }` |
| Actualizar agente | `PATCH /v1/convai/agents/{agent_id}` |
| Sesión de texto | `GET /v1/convai/conversation/get-signed-url?agent_id=…`. Responde `{ signed_url }` |
| Sesión de voz | `GET /v1/convai/conversation/token?agent_id=…`. Responde `{ token }` |

### Configuración del agente

Lo que envía `crear-agente.mjs`:

```jsonc
{
  "name": "juju",
  "conversation_config": {
    "agent": {
      "first_message": "¡Hola! Soy juju, tu guía de Jujuy…",
      "language": "es",
      "prompt": {
        "prompt": "…",                    // instrucciones completas, en crear-agente.mjs
        "llm": "claude-haiku-5-5",
        "temperature": 0.3,
        "tool_ids": ["…", "…", "…"],      // las tres herramientas client
        "timezone": "America/Argentina/Jujuy"
      },
      "dynamic_variables": {
        "dynamic_variable_placeholders": {
          "fecha_hora_local": "sin dato",
          "ubicacion_usuario": "desconocida",
          "catalogo_pagos": "No hay experiencias cargadas para reservar."
        }
      }
    },
    "tts": { "model_id": "eleven_turbo_v2_5" },
    "conversation": {
      "text_only": false,
      "max_duration_seconds": 1800,
      "client_events": ["conversation_initiation_metadata", "ping", "audio", "interruption",
                        "user_transcript", "agent_response", "agent_response_correction", "client_tool_call"]
    }
  },
  "platform_settings": {
    "overrides": {
      "conversation_config_override": {
        "agent": { "first_message": true },
        "conversation": { "text_only": true }
      }
    }
  }
}
```

Por qué cada cosa:

- **`eleven_turbo_v2_5`** es el modelo Turbo que habla español. `eleven_turbo_v2` a secas es solo inglés.
- **`tool_ids`** en vez de `tools`: el campo `tools` dentro del prompt está marcado como obsoleto en la API.
- **`client_events`** tiene que incluir `agent_response` (si no, no llega el texto del agente) y `client_tool_call` (si no, no se ejecutan las herramientas).
- **`overrides`**: `text_only` permite abrir sesiones solo de texto desde la página. `first_message` permite cambiar el saludo al pasar de texto a voz o al reconectar.
- `timezone`, `dynamic_variables`, `max_duration_seconds` y `client_events` son los ajustes opcionales. Si la API los rechaza, el script reintenta sin ellos y avisa.

### Variables dinámicas

El prompt usa `{{fecha_hora_local}}`, `{{ubicacion_usuario}}` y `{{catalogo_pagos}}`. La página las manda al abrir cada sesión:

- `fecha_hora_local` y `catalogo_pagos` salen de `/api/sesion`.
- `ubicacion_usuario` sale de la geolocalización del navegador si la persona la comparte.

### Lado navegador (SDK)

El SDK se carga como script desde un CDN (`cdn.jsdelivr.net`, con `unpkg.com` de respaldo) y expone el global `ElevenLabsClient`. Si existe `public/vendor/elevenlabs-client.js`, se usa esa copia local primero.

```js
const conv = await ElevenLabsClient.Conversation.startSession({
  // texto
  signedUrl, connectionType: 'websocket', textOnly: true,
  overrides: { conversation: { textOnly: true }, agent: { firstMessage: '' } },
  // voz (en lugar de lo anterior)
  // conversationToken, connectionType: 'webrtc', textOnly: false,

  dynamicVariables: { fecha_hora_local, catalogo_pagos, ubicacion_usuario },
  clientTools: { plan_rapido, buscar_lugares, ver_experiencias, como_llegar, reservar },
  onMessage: ({ message, role }) => {},      // role: 'user' | 'agent'
  onModeChange: ({ mode }) => {},            // 'speaking' | 'listening'
  onError: (mensaje) => {},
  onDisconnect: (detalle) => {},
});

conv.sendUserMessage('texto del usuario');
conv.sendContextualUpdate('datos que el modelo debe conocer, sin interrumpir');
await conv.endSession();
```

Detalles que importan:

- `signedUrl` solo admite `websocket`. `conversationToken` va con `webrtc`.
- Para texto hay que mandar las dos cosas: `textOnly: true` (el SDK no pide micrófono) y el override `conversation.textOnly` (el servidor no genera audio).
- Una herramienta client recibe el objeto de parámetros y devuelve un texto. Si devuelve un objeto, el SDK lo convierte a JSON. Si lanza un error, el SDK avisa al agente que falló.
- La sesión de texto se abre recién con el primer mensaje, con `firstMessage: ''` para que el agente responda directo. Así no se gasta una sesión por cada visita a la página.
- Al reconectar o al pasar de texto a voz se abre una sesión nueva. La página le pasa los últimos 12 mensajes con `sendContextualUpdate` para no perder el hilo.

### Herramientas del agente

Las cuatro son `type: "client"`, con `expects_response: true` y 20 segundos de espera.

| Herramienta | Parámetros | Qué hace en la página |
|---|---|---|
| `plan_rapido` | `localidad`, `hora`, `dia` | `POST /api/plan` y muestra los lugares |
| `buscar_lugares` | `texto`, `categoria`, `subcategoria`, `localidad`, `region`, `precio_max`, `solo_abiertos`, `hora`, `dia`, `radio_km`, `limite` | `POST /api/buscar` y muestra los lugares |
| `ver_experiencias` | `localidad` (opcional) | `GET /api/productos` y muestra las experiencias reservables |
| `como_llegar` | `lugar` (obligatorio), `localidad` | Resuelve el lugar por nombre (entre los ya mostrados o con `POST /api/buscar`), muestra el botón "Abrir en Google Maps" con el camino e intenta abrirlo. Si el nombre coincide con más de un lugar no abre nada y le devuelve las opciones al agente |
| `reservar` | `metodo_pago` (obligatorio: `usdc` o `banco`), `lugar`, `localidad`, `producto_id`, `fecha`, `hora`, `personas`, `noches` | Reserva de demostración: `POST /api/reservas` simula el pago y muestra la reserva confirmada. Si es una experiencia del catálogo, el usuario eligió USDC y Cosmos Pay está configurado, abre la hoja de reserva para pagar de verdad |

El catálogo de experiencias también viaja en la variable `{{catalogo_pagos}}` junto con la fecha de hoy, así el agente puede nombrar experiencias y precios sin llamar a ninguna herramienta.

Los valores válidos de `categoria` y `region` se leen de `estructura.json` al crear el agente.

## RAG de datos

### Qué se eligió y por qué

Se evaluaron tres caminos para que el agente tenga los datos:

| Camino | Cómo funciona | Velocidad | Problema |
|---|---|---|---|
| **RAG local con datos adjuntos** (elegido) | El navegador busca en el servidor local y adjunta el resultado al mensaje | Una sola pasada del modelo. La búsqueda tarda 5 a 10 ms | En voz no se puede adjuntar antes de que el modelo empiece a responder |
| Herramienta client | El modelo decide llamar la herramienta, espera el resultado y responde | Dos pasadas del modelo | Más lento. Queda como respaldo |
| Base de conocimiento de ElevenLabs con RAG | Se suben documentos y ElevenLabs recupera fragmentos por similitud | Una pasada | No sabe filtrar por "abierto ahora", distancia ni precio. Los datos quedan desactualizados hasta volver a subirlos |
| Servidor MCP | ElevenLabs llama a un servidor MCP propio | Dos pasadas, más un salto de red | Necesita un servidor accesible desde internet. No es más rápido que la herramienta client |

La pregunta típica de juju ("qué hago ahora, son las 18, y dónde como") depende de la hora, del día y de la distancia. Eso se calcula, no se recupera por similitud de texto. Por eso el RAG es local y estructurado.

Un servidor MCP tiene sentido para otro objetivo: consultar el mismo directorio desde otras aplicaciones. No está hecho.

### Cómo funciona

1. La persona escribe un mensaje.
2. Antes de enviarlo a ElevenLabs, la página llama a `POST /api/contexto` con el texto, la última localidad conocida y la ubicación si fue compartida.
3. `contexto.mjs` detecta tres cosas en el texto:
   - **Localidad**: nombres y apodos conocidos ("jujuy", "tilcara", "libertador") y las localidades que aparecen en los datos. Si no hay ninguna, usa la última de la charla o la ubicación.
   - **Hora**: "son las 18", "a las 6 de la tarde", "esta noche", "al mediodía". Si no hay, usa la hora actual de Jujuy.
   - **Intención**: comer, dormir, hacer, servicios, compras, salir. También términos concretos como "parrilla", "museo" o "terminal".
4. Con eso corre `planRapido()` o `buscar()` en memoria y arma un bloque de texto.
5. La página manda el bloque con `sendContextualUpdate()` y enseguida el mensaje con `sendUserMessage()`. También muestra los lugares en pantalla en ese momento, antes de que llegue la respuesta.
6. El prompt le indica al agente que, si recibió un bloque `DATOS DEL DIRECTORIO`, responda con eso sin llamar herramientas.

Si el mensaje no pide lugares ("gracias", "hola") no se adjunta nada.

### Formato del bloque

Texto plano, una línea por lugar. Ocupa bastante menos que el JSON equivalente, y menos texto de entrada es respuesta más rápida.

```
DATOS DEL DIRECTORIO (ya filtrados para el próximo mensaje del usuario; …):
Zona: San Salvador de Jujuy, distancias en línea recta. Momento: domingo 22/11/2026, 18:00 hs.
PARA HACER:
- Museo y Patio de la Catedral Basílica | museo | San Salvador de Jujuy, General Belgrano 556 | 0.1 km | $ aprox | sin horario cargado | tel +54 388 423 5333
PARA COMER:
- Picantería y Restaurant Locoto - Comidas Regionales | restaurante | San Salvador de Jujuy, Necochea 154 | 0.5 km | $$ aprox | abierto hasta 00:00 | cocina argentinian
En PARA HACER y PARA COMER ya se excluyó lo que figura cerrado a esa hora.
```

Las herramientas `plan_rapido` y `buscar_lugares` devuelven al modelo este mismo formato.

### Medición

Tiempo de `contexto()` en esta máquina, con 2.755 registros:

| Consulta | Tiempo | Tamaño del bloque |
|---|---|---|
| "qué puedo hacer en jujuy ahora, son las 18… hacer algo y comer algo" | 10 ms | 1.723 caracteres |
| "dónde como una parrilla en tilcara esta noche" | 11 ms | 838 caracteres |
| "un hostel barato" (con localidad previa) | 4 ms | 1.855 caracteres |
| "gracias, genial" | 0,3 ms | no adjunta nada |

El tiempo total de respuesta depende del modelo y de la voz de ElevenLabs. Eso todavía no se midió.

### Límites conocidos

- **Voz**: lo que la persona dice va directo a ElevenLabs, así que no hay momento para adjuntar datos antes de la respuesta. See "Eleven Realtime voice and demo bookings" above: the nearby block sent when the session opens covers the first question, and each spoken turn adds its places for the follow-ups. Los mensajes escritos durante una sesión de voz sí llevan datos adjuntos.
- **"Mañana"**: el detector no cambia el día. "Mañana me voy" y "qué hago mañana" se parecen demasiado. Si la persona pregunta por otro día, el agente usa la herramienta con el parámetro `dia`.
- **Horarios**: 79 de 2.755 lugares tienen horario cargado. El resto figura como "sin horario cargado" y el agente tiene instrucción de decirlo.
- **Localidades**: una localidad que no esté en la lista ni en los datos no se detecta. El agente pregunta.

### Los datos

- `estructura.json` define categorías, regiones, rangos de precio y el formato de cada registro.
- `jujuy_turismo.json` tiene los registros. Se carga completo en memoria al iniciar el servidor.
- Si ese archivo no existe, `datos.mjs` normaliza `datos_crudos/osm.json` al mismo formato.
- Al actualizar los datos hay que reiniciar el servidor. No hay que tocar nada en ElevenLabs.

Cómo se decide "abierto ahora": `horarios.mjs` interpreta el formato `opening_hours` de OpenStreetMap (días, rangos, `off`, `24/7`, cruces de medianoche). Lo que no entiende lo devuelve como "sin dato". Nunca asume que algo está abierto.

## Rendimiento

Lo que ya está hecho para que responda rápido:

- Datos adjuntos antes del mensaje, para evitar la segunda pasada del modelo.
- Resultados en texto compacto en vez de JSON.
- Modelo rápido por defecto y voz Turbo.
- Los lugares aparecen en pantalla apenas termina la búsqueda local, antes de la respuesta del agente.
- Búsqueda en memoria, sin base de datos ni red.

Qué probar si hace falta más velocidad, con la cuenta ya conectada:

- Cambiar `ELEVENLABS_LLM` por otro modelo rápido de la lista de ElevenLabs y comparar.
- Bajar de 5 a 3 lugares por grupo en `contexto.mjs`.
- Acortar el prompt.

## Pagos

`pagos.mjs` cobra las experiencias de `productos.json` (hoy son ejemplos, marcados con `"ejemplo": true`: los precios no están acordados con ningún operador). El modelo no puede fijar montos: pasa el id, la cantidad de personas y la fecha, y el servidor calcula el total (precio por persona × personas, de 1 a 20, fecha de hoy en adelante).

Hay dos caminos de reserva. Por voz o chat, la herramienta `reservar` usa `reservas.mjs`: es una demostración que simula el pago al instante y devuelve un código `JUJ-XXXXXX`; no cobra ni reserva nada, y la pantalla lo marca como "Demo · pago simulado". En pantalla (botón del boleto o link directo), la hoja de reserva crea un pago real con `pagos.mjs` cuando hay un proveedor configurado, y si no lo hay usa la misma demostración.

En el camino con pago, cada reserva es un pago con `personas`, `fecha` y un `codigo` (`JU-XXXXXX`). Queda confirmada cuando el pago pasa a `pagado`; la página le avisa al agente con `sendContextualUpdate`. No hay control de cupos ni aviso al operador: eso depende de quién preste la experiencia.

También se puede abrir una reserva con un link: `/?reservar=<id>`.

- **Cosmos Pay** (`PAGOS_PROVEEDOR=cosmospay`): crea un pago con `POST /v1/payment-intents/pay` en Stellar, en dólares digitales (USDC o USDT0), 1 a 1 con el precio en USD. Necesita `COSMOSPAY_API_KEY` en `.env` y la cuenta Stellar pública de cobro en `cosmospay.config.json`. Una clave `dv_…` usa la red de prueba y una `prod_…` la red real.
- **Simulado** (`PAGOS_PROVEEDOR=simulado`): para probar el flujo sin mover dinero.
- El estado se confirma consultando `GET /v1/payment-intents/{id}`. El webhook es opcional (`node registrar-webhook.mjs`) y verifica la firma `x-cosmos-signature`.
- Cosmos Pay no cobra en dólares tradicionales (tarjeta o banco). Para eso habría que sumar otro proveedor.

## Seguridad

- `.env`, `agente.json` y `pagos.json` están en `.gitignore`. No subir claves al repo.
- El servidor escucha solo en `127.0.0.1`. Para publicarlo en internet hay que ponerlo detrás de HTTPS y agregar un límite de pedidos a `/api/sesion`, porque cada sesión consume crédito de ElevenLabs.
- El agente tiene instrucción de no pedir ni aceptar datos de tarjeta, claves ni frases semilla por chat.
- En `cosmospay.config.json` va solo la cuenta pública de Stellar (empieza con G). Nunca la clave secreta (empieza con S).

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| La página dice "Falta conectar ElevenLabs" | No hay `.env` o falta correr `crear-agente.mjs` |
| `crear-agente.mjs` falla con 401 | Clave inválida o sin permiso para Agents |
| `crear-agente.mjs` falla con 400 o 422 | La API cambió algún campo. El mensaje dice cuál. Pasar el error completo |
| El agente no responde en texto | El evento `agent_response` no está activo, o el override "Text only" no está permitido en la pestaña Security del agente |
| El agente dice que no puede buscar | El evento `client_tool_call` no está activo, o las herramientas no quedaron asociadas al agente |
| La sesión se abre y se corta | Una variable del prompt no llegó. Revisar que `/api/sesion` devuelva `variables` |
| El micrófono no arranca | Permiso del navegador. Fuera de `localhost` hace falta HTTPS |
| No carga el SDK | Sin internet. Se puede copiar `lib.iife.js` del paquete a `public/vendor/elevenlabs-client.js` |
