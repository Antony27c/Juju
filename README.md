# juju

Guía de la provincia de Jujuy que se usa hablando. Le contás dónde estás y cuánto tiempo tenés, y te dice qué hacer y dónde comer con lo que está abierto a esa hora. También reserva y cobra experiencias.

## Qué hace

- **Voz en vivo.** En la pantalla principal tocás el micrófono y conversás: lo que dice juju se lee en grande y un paisaje de cerritos en pixel art se mueve con la voz de quien habla. Usa ElevenLabs Agents. La voz la atiende por defecto el mismo agente del chat (escucha, modelo de texto y voz Turbo), que en las pruebas con audio real siguió las reglas y nombró solo lugares del directorio. El agente de tiempo real (Eleven Realtime) conecta y responde más rápido, pero con las mismas grabaciones inventó lugares y precios: queda a pedido, con `?voz=tiempo-real` en la dirección de la página o `VOZ_TIEMPO_REAL=si` en el servidor.
- **Chat escrito.** La misma charla, por texto, con las listas de lugares completas.
- **Directorio.** 2.755 lugares de Jujuy (comida, alojamiento, atractivos, servicios), con distancia, precio aproximado, teléfono, mapa y, cuando está cargado, horario.
- **Mapa.** Cuando juju sugiere lugares, aparecen en un mapa (mosaicos de OpenStreetMap, sin librerías) con pines numerados igual que la lista; tocar un pin abre el lugar en Google Maps. Está en el chat y en la vista de voz.
- **Cómo llegar.** Cuando elegís un lugar, juju pregunta si querés que te guíe. Si decís que sí, abre Google Maps con el camino desde donde estás y deja el botón en pantalla. Cada lugar de las listas tiene además su link "Cómo llegar".
- **Respuesta rápida.** Antes de que el mensaje llegue al modelo, el servidor ya buscó los lugares para esa localidad y esa hora (tarda milisegundos).
- **Español e inglés.** Por chat, juju responde en el idioma en que le escribís. Por voz, la sesión escucha y habla en un idioma por vez: se elige con el botón ES/EN (la primera vez toma el idioma del navegador) y se reconecta sola si saludás o hablás en el otro idioma.
- **Respuestas directas.** Hace lo que le pedís y recomienda un lugar, dos como máximo, sin listas de opciones.
- **Reservas por voz.** Pedís reservar un lugar o una experiencia, juju te dice que hay disponibilidad y te pide que confirmes la actividad, el monto y la hora. Antes te pregunta cómo pagás: con el dinero de tu cuenta de Wells Fargo o con USDC a través de Cosmos Pay. Solo con tu sí paga y te da un código, con un mapa de cómo llegar (desde donde estás, si compartiste tu ubicación) y un botón que deja la reserva lista para guardar en Google Calendar. Es una demostración: el pago es simulado, no se cobra ni se reserva nada, y la disponibilidad no se consulta con nadie.
- **Reservas en pantalla.** Elegís una experiencia, cuántas personas y la fecha, y ves el total. Con Cosmos Pay configurado se paga de verdad; sin eso usa la misma demostración.
- **Pagos.** En dólares digitales (USDC o USDT) con Cosmos Pay, o en modo de prueba sin mover dinero.

## Cómo se usa

Hace falta Node 21.7 o superior. No hay que instalar dependencias.

En Windows, doble clic en `chatbot/iniciar.bat`. A mano:

```
cd chatbot
copy .env.example .env      (cp en Linux o Mac)
node verificar.mjs          dice qué está listo y qué falta
node server.mjs             y abrir http://localhost:3000
```

Sin ninguna clave ya funcionan el directorio, la búsqueda y las reservas en modo de prueba.

### Estilo de viaje: low cost o fancy

Al empezar cada charla juju pide el usuario de Instagram (por voz en el saludo; por chat en la primera respuesta, y hay un cuadro en pantalla para escribirlo). El servidor lee el perfil público (`POST /api/estilo`), estima el estilo y, desde ahí, todas las búsquedas vuelven ordenadas: con low cost van primero hostels, campings y lo más barato; con fancy, hoteles y posadas de más categoría y restaurantes. El estilo no deja lugares afuera, solo cambia el orden.

Qué se puede leer de verdad: Instagram suele bloquear el pedido completo (bio y publicaciones), sobre todo desde servidores. En ese caso queda la página pública del perfil, que trae solo el nombre y los números de seguidores: el estilo sale únicamente si el nombre o el usuario lo dicen ("mochilera", "luxury"). Si no alcanza, juju lo dice y pregunta "¿Preferís viajar low cost o más fancy?" (también están los dos botones en pantalla). Nunca inventa el estilo. Para leer siempre bio y publicaciones haría falta la API oficial de Instagram con inicio de sesión del usuario.

El clasificador:


`chatbot/estilo-viaje.mjs` lee un perfil público de Instagram o X y estima si la persona viaja más "hippie" (mochila, camping, naturaleza) o "luxury" (resorts, spa, lujo). Sin clave usa palabras clave y emojis; con `GEMINI_API_KEY` en `chatbot/.env` también le pasa a Gemini el texto y hasta 6 imágenes.

```
cd chatbot
node estilo-viaje.mjs @usuario --es-mi-perfil
npm test
```

- Solo con el perfil propio y con permiso: sin `--es-mi-perfil` no analiza nada. Quien lo integre a la página o al agente tiene que mostrar `AVISO_CONSENTIMIENTO` antes. No se guarda nada.
- Las imágenes solo se bajan por HTTPS desde los CDN de Instagram y X, con tope de 4 MB y 10 segundos.
- Instagram no tiene API pública para esto: se usa el pedido de su sitio web, que suele bloquear servidores como Railway. Para X se usa FxTwitter, un servicio de terceros.
- En la página el permiso es que el propio usuario escribe o dice su usuario, con el aviso a la vista; la ruta `/api/estilo` no analiza nada sin `es_mi_perfil: true` y tiene un tope de 15 pedidos cada 10 minutos por visitante.

### Para activar la voz

1. Pegá tu clave de ElevenLabs en `chatbot/.env` (`ELEVENLABS_API_KEY`).
2. Reiniciá el servidor.

Con la clave sola alcanza: al arrancar, el servidor busca en tu cuenta los agentes `juju` y `juju (voz en tiempo real)` y sus herramientas, los crea si no están y los actualiza con el prompt y la voz del código. No duplica nada entre un arranque y otro. `node crear-agente.mjs` hace lo mismo a mano.

### Para cobrar de verdad

1. En `chatbot/.env`: `PAGOS_PROVEEDOR=cosmospay` y `COSMOSPAY_API_KEY`.
2. En `chatbot/cosmospay.config.json`: tu cuenta Stellar pública (empieza con `G`) en `destino`. Nunca la clave secreta.
3. En `chatbot/productos.json`: las experiencias reales con su precio por persona. Las que vienen cargadas son ejemplos.

## Deploy en Railway

El repo ya trae `Dockerfile` y `railway.json`. No hay que configurar comandos ni carpeta raíz.

1. En Railway: New Project, Deploy from GitHub repo, elegí este repo y la rama `main`.
2. En Variables, cargá `ELEVENLABS_API_KEY`. Las demás de la tabla son opcionales.
3. En Settings, Networking, generá el dominio público. Railway lo sirve con HTTPS, que es lo que el micrófono necesita.

El agente se prepara solo en cada arranque, en segundo plano. Si ElevenLabs lo rechaza (clave inválida o sin permiso para Agents), el sitio sigue andando en modo directorio y el motivo aparece en "Cómo funciona", en los logs y en `/api/estado` (`error_agente`). Usá una sola réplica: dos arranques al mismo tiempo sobre una cuenta vacía podrían crear el agente dos veces.

| Variable | Obligatoria | Valor |
|---|---|---|
| `ELEVENLABS_API_KEY` | Sí | Tu clave de ElevenLabs |
| `ELEVENLABS_AGENT_ID` | No | Id de un agente de texto ya creado. Vacío: el servidor lo busca por nombre o lo crea |
| `ELEVENLABS_VOICE_AGENT_ID` | No | Id del agente de voz en tiempo real. Vacío: el servidor lo busca o lo crea; si la cuenta no lo admite, la voz usa el agente de texto |
| `VOZ_TIEMPO_REAL` | No | `si` para que la voz la atienda el agente de tiempo real. Vacío: la atiende el agente del chat |
| `ELEVENLABS_SINCRONIZAR` | No | `off` para que el servidor no toque los agentes al arrancar |
| `PAGOS_PROVEEDOR` | No | `simulado` para probar o `cosmospay` para cobrar |
| `COSMOSPAY_API_KEY` | Solo con `cosmospay` | `dv_…` red de prueba, `prod_…` red real |
| `COSMOSPAY_WEBHOOK_SECRET` | No | Lo entrega `node registrar-webhook.mjs` |
| `PAGOS_ARCHIVO` | No | Ruta dentro de un volumen, por ejemplo `/data/pagos.json` |
| `LIMITE_SESIONES`, `LIMITE_PAGOS` | No | Tope por visitante cada 10 minutos. Por defecto 30 y 20 |

`PORT` y el dominio público los pone Railway; no hay que cargarlos.

Para tener en cuenta:

- La cuenta Stellar de cobro no es una variable: va en `chatbot/cosmospay.config.json`, dentro del repo. Es la cuenta pública (empieza con `G`).
- El disco de Railway se borra en cada deploy. Sin un volumen y `PAGOS_ARCHIVO`, el registro de reservas se pierde al redesplegar; los pagos de Cosmos Pay igual quedan en su panel.
- El contenedor corre sin permisos de administrador (usuario `node`). Si montás un volumen para `PAGOS_ARCHIVO` y Railway lo deja solo con permisos de root, agregá la variable `RAILWAY_RUN_UID=0`; si no, el registro no se puede escribir.
- Para no depender de jsDelivr ni unpkg en la voz: `cd chatbot && npm run vendor-sdk` guarda el SDK de ElevenLabs en `public/vendor/`. Subí ese archivo al repo.
- El sitio queda abierto a cualquiera con el link, y cada charla gasta crédito de ElevenLabs. Los topes por visitante frenan el abuso más simple, no reemplazan un login.
- `GET /api/estado` es la ruta de salud que usa Railway.

## Qué falta

- La conversación por voz no se probó hablando de verdad: se verificó que el chat responde y que la sesión de voz abre en el deploy, no cómo suena ni el cambio de idioma por voz.
- Las experiencias y sus precios son de ejemplo, sin acuerdo con ningún operador.
- La reserva por voz es una demostración: dice "pago acreditado" y "reserva confirmada" sin cobrar ni avisar a ningún hotel, restaurante u operador. En pantalla aparece marcada como "Demo · pago simulado".
- La reserva con pago real registra el pedido, cobra y da un código. No controla cupos ni avisa al operador.
- Fuera de `localhost` el micrófono necesita HTTPS.

## Dónde está cada cosa

| Ruta | Contenido |
|---|---|
| `chatbot/` | Servidor, página y scripts |
| `chatbot/public/index.html` | La interfaz |
| `jujuy_turismo.json`, `estructura.json` | El directorio y su estructura |
| `construir.py` | Arma el directorio a partir de los datos crudos |
| `elevenlabs.md` | Detalle técnico: ElevenLabs, búsqueda previa, pagos y seguridad |
