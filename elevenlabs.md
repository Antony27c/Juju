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
| Página en el navegador | Solo chequeo de sintaxis del script |

El primer `node crear-agente.mjs` con una clave real es la prueba que falta. Si la API rechaza algún campo, el script imprime el error completo y reintenta con una configuración mínima.

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
| `chatbot/pagos.mjs` | Pagos: Cosmos Pay y proveedor simulado |
| `chatbot/public/index.html` | Interfaz de juju |
| `chatbot/.env.example` | Plantilla de configuración |

## Puesta en marcha

Requiere Node 21.7 o superior.

1. En `chatbot/`, copiar `.env.example` como `.env` y completar `ELEVENLABS_API_KEY`. La clave necesita permiso para ElevenLabs Agents.
2. `node crear-agente.mjs`. Crea tres herramientas y el agente, y escribe `ELEVENLABS_AGENT_ID` en `.env`.
3. `node server.mjs` y abrir `http://localhost:3000`. En Windows también sirve `iniciar.bat`.

Cada vez que se cambie el prompt o las herramientas hay que volver a correr el paso 2. El script actualiza el agente existente en vez de crear otro.

### Variables de entorno

| Variable | Uso |
|---|---|
| `ELEVENLABS_API_KEY` | Obligatoria |
| `ELEVENLABS_AGENT_ID` | La completa `crear-agente.mjs` |
| `ELEVENLABS_VOICE_ID` | Opcional. Id de una voz en español. Sin esto usa la voz por defecto de la cuenta |
| `ELEVENLABS_TTS_MODEL` | Opcional. Por defecto `eleven_turbo_v2_5` |
| `ELEVENLABS_LLM` | Opcional. Por defecto `claude-haiku-5-5` |
| `ELEVENLABS_API_BASE` | Opcional. Por defecto `https://api.elevenlabs.io` |
| `PUERTO`, `HOST` | Por defecto `3000` y `127.0.0.1` |
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
          "catalogo_pagos": "Pagos no disponibles por ahora."
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
  clientTools: { plan_rapido, buscar_lugares, solicitar_pago },
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

Las tres son `type: "client"`, con `expects_response: true` y 20 segundos de espera.

| Herramienta | Parámetros | Ruta local |
|---|---|---|
| `plan_rapido` | `localidad`, `hora`, `dia` | `POST /api/plan` |
| `buscar_lugares` | `texto`, `categoria`, `subcategoria`, `localidad`, `region`, `precio_max`, `solo_abiertos`, `hora`, `dia`, `radio_km`, `limite` | `POST /api/buscar` |
| `solicitar_pago` | `producto_id` (obligatorio) | Muestra la tarjeta de pago |

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

- **Voz**: lo que la persona dice va directo a ElevenLabs, así que no hay momento para adjuntar datos antes de la respuesta. En voz el agente usa las herramientas. Los mensajes escritos durante una sesión de voz sí llevan datos adjuntos.
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

`pagos.mjs` cobra productos de `productos.json`. El modelo no puede fijar montos: solo pasa el id del producto.

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
