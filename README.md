# juju

Guía de la provincia de Jujuy que se usa hablando. Le contás dónde estás y cuánto tiempo tenés, y te dice qué hacer y dónde comer con lo que está abierto a esa hora. También reserva y cobra experiencias.

## Qué hace

- **Voz en vivo.** En la pantalla principal tocás el micrófono y conversás: lo que dice juju se lee en grande y una faja de aguayo se levanta con la voz de quien habla. Usa ElevenLabs Agents: un agente de voz en tiempo real (Eleven Realtime) y, si la cuenta no lo tiene, el agente de texto con la voz Turbo.
- **Chat escrito.** La misma charla, por texto, con las listas de lugares completas.
- **Directorio.** 2.755 lugares de Jujuy (comida, alojamiento, atractivos, servicios), con distancia, precio aproximado, teléfono, mapa y, cuando está cargado, horario.
- **Cómo llegar.** Cuando elegís un lugar, juju pregunta si querés que te guíe. Si decís que sí, abre Google Maps con el camino desde donde estás y deja el botón en pantalla. Cada lugar de las listas tiene además su link "Cómo llegar".
- **Respuesta rápida.** Antes de que el mensaje llegue al modelo, el servidor ya buscó los lugares para esa localidad y esa hora (tarda milisegundos).
- **Reservas por voz.** Pedís reservar un lugar o una experiencia, juju pregunta si pagás con USDC o por transferencia y te da un código. Es una demostración: el pago es simulado, no se cobra ni se reserva nada.
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

### Para activar la voz

1. Pegá tu clave de ElevenLabs en `chatbot/.env` (`ELEVENLABS_API_KEY`).
2. `node crear-agente.mjs` crea el agente y sus herramientas.
3. Reiniciá el servidor.

### Para cobrar de verdad

1. En `chatbot/.env`: `PAGOS_PROVEEDOR=cosmospay` y `COSMOSPAY_API_KEY`.
2. En `chatbot/cosmospay.config.json`: tu cuenta Stellar pública (empieza con `G`) en `destino`. Nunca la clave secreta.
3. En `chatbot/productos.json`: las experiencias reales con su precio por persona. Las que vienen cargadas son ejemplos.

## Deploy en Railway

El repo ya trae `Dockerfile` y `railway.json`. No hay que configurar comandos ni carpeta raíz.

1. En tu máquina, con la clave de ElevenLabs en `chatbot/.env`, corré `node crear-agente.mjs`. Anotá el `ELEVENLABS_AGENT_ID` y el `ELEVENLABS_VOICE_AGENT_ID` que escribe en `.env`.
2. En Railway: New Project, Deploy from GitHub repo, elegí este repo y la rama `main`.
3. En Variables, cargá las de la tabla.
4. En Settings, Networking, generá el dominio público. Railway lo sirve con HTTPS, que es lo que el micrófono necesita.

| Variable | Obligatoria | Valor |
|---|---|---|
| `ELEVENLABS_API_KEY` | Sí | Tu clave de ElevenLabs |
| `ELEVENLABS_AGENT_ID` | Sí | El id del agente de texto que dejó `crear-agente.mjs` |
| `ELEVENLABS_VOICE_AGENT_ID` | Para voz en tiempo real | El id del agente de voz que dejó `crear-agente.mjs`. Vacío: la voz usa el agente de texto |
| `PAGOS_PROVEEDOR` | Sí | `simulado` para probar o `cosmospay` para cobrar |
| `COSMOSPAY_API_KEY` | Solo con `cosmospay` | `dv_…` red de prueba, `prod_…` red real |
| `COSMOSPAY_WEBHOOK_SECRET` | No | Lo entrega `node registrar-webhook.mjs` |
| `PAGOS_ARCHIVO` | No | Ruta dentro de un volumen, por ejemplo `/data/pagos.json` |
| `LIMITE_SESIONES`, `LIMITE_PAGOS` | No | Tope por visitante cada 10 minutos. Por defecto 30 y 20 |

`PORT` y el dominio público los pone Railway; no hay que cargarlos.

Para tener en cuenta:

- La cuenta Stellar de cobro no es una variable: va en `chatbot/cosmospay.config.json`, dentro del repo. Es la cuenta pública (empieza con `G`).
- El disco de Railway se borra en cada deploy. Sin un volumen y `PAGOS_ARCHIVO`, el registro de reservas se pierde al redesplegar; los pagos de Cosmos Pay igual quedan en su panel.
- El sitio queda abierto a cualquiera con el link, y cada charla gasta crédito de ElevenLabs. Los topes por visitante frenan el abuso más simple, no reemplazan un login.
- `GET /api/estado` es la ruta de salud que usa Railway.

## Qué falta

- La conversación con ElevenLabs (voz y texto) está programada pero no se probó: todavía no hay clave cargada.
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
