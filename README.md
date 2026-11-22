# juju

Guía de la provincia de Jujuy que se usa hablando. Le contás dónde estás y cuánto tiempo tenés, y te dice qué hacer y dónde comer con lo que está abierto a esa hora. También reserva y cobra experiencias.

## Qué hace

- **Voz en vivo.** La pantalla principal es un círculo de siete franjas: lo tocás y conversás. Usa ElevenLabs Agents con la voz Turbo.
- **Chat escrito.** La misma charla, por texto, con las listas de lugares completas.
- **Directorio.** 2.755 lugares de Jujuy (comida, alojamiento, atractivos, servicios), con distancia, precio aproximado, teléfono, mapa y, cuando está cargado, horario.
- **Respuesta rápida.** Antes de que el mensaje llegue al modelo, el servidor ya buscó los lugares para esa localidad y esa hora (tarda milisegundos).
- **Reservas.** Elegís una experiencia, cuántas personas y la fecha; ves el total y pagás. Al acreditarse queda un código de reserva.
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

## Qué falta

- La conversación con ElevenLabs (voz y texto) está programada pero no se probó: todavía no hay clave cargada.
- Las experiencias y sus precios son de ejemplo, sin acuerdo con ningún operador.
- La reserva registra el pedido, cobra y da un código. No controla cupos ni avisa al operador.
- Fuera de `localhost` el micrófono necesita HTTPS.

## Dónde está cada cosa

| Ruta | Contenido |
|---|---|
| `chatbot/` | Servidor, página y scripts |
| `chatbot/public/index.html` | La interfaz |
| `jujuy_turismo.json`, `estructura.json` | El directorio y su estructura |
| `construir.py` | Arma el directorio a partir de los datos crudos |
| `elevenlabs.md` | Detalle técnico: ElevenLabs, búsqueda previa, pagos y seguridad |
