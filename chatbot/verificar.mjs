// Revisa que juju tenga todo para funcionar y dice qué falta.
//   node verificar.mjs
// No cambia nada. Con claves cargadas hace una consulta de solo lectura a ElevenLabs.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(AQUI, '.env');
if (existsSync(ENV)) process.loadEnvFile(ENV);

const filas = [];
let grave = false;
const anotar = (estado, que, detalle) => { filas.push([estado, que, detalle]); if (estado === 'FALLA') grave = true; };

// --- Node ---
const [mayor, menor] = process.versions.node.split('.').map(Number);
anotar(mayor > 21 || (mayor === 21 && menor >= 7) ? 'OK' : 'FALLA', 'Node', `versión ${process.versions.node} (hace falta 21.7 o superior)`);

// --- datos y búsqueda ---
try {
  const { resumen } = await import('./datos.mjs');
  const r = resumen();
  anotar(r.total > 0 ? 'OK' : 'FALLA', 'Directorio', `${r.total} lugares${r.con_horario != null ? `, ${r.con_horario} con horario` : ''}`);
  const { contexto } = await import('./contexto.mjs');
  const t0 = performance.now();
  const c = contexto({ texto: 'estoy en Tilcara, son las 21, quiero hacer algo y comer algo' });
  const ms = Math.round(performance.now() - t0);
  const lugares = (c.grupos || []).reduce((n, g) => n + g.lugares.length, 0);
  anotar(lugares > 0 ? 'OK' : 'FALLA', 'Búsqueda previa', `${lugares} lugares para una consulta de prueba en ${c.localidad || 'ninguna localidad'}, ${ms} ms`);
} catch (e) { anotar('FALLA', 'Directorio', e.message); }

// --- experiencias y pagos ---
try {
  const { productos, estadoPagos } = await import('./pagos.mjs');
  const ps = productos();
  const ejemplos = ps.filter((p) => p.ejemplo).length;
  anotar(!ps.length ? 'FALTA' : ejemplos ? 'AVISO' : 'OK', 'Experiencias',
    !ps.length ? 'productos.json está vacío: juju no ofrece reservas' : ejemplos ? `${ps.length} cargadas, ${ejemplos} son de ejemplo: reemplazalas por las reales en productos.json` : `${ps.length} cargadas`);
  const e = estadoPagos();
  const texto = {
    cosmospay: `Cosmos Pay en red ${e.red === 'public' ? 'real' : 'de prueba (no es dinero real)'}, monedas ${e.monedas.map((m) => m.id).join(', ')}`,
    simulado: 'modo de prueba: se recorre todo el flujo y no se cobra',
    ninguno: 'sin proveedor de cobro: las reservas usan la demostración (pago simulado, no se cobra). Para cobrar de verdad configurá Cosmos Pay',
    sin_configurar: e.falta,
  }[e.proveedor];
  anotar(e.proveedor === 'cosmospay' ? 'OK' : e.proveedor === 'sin_configurar' ? 'FALTA' : 'AVISO', 'Pagos', texto);
} catch (e) { anotar('FALLA', 'Pagos', e.message); }

// --- ElevenLabs ---
const clave = process.env.ELEVENLABS_API_KEY;
const agente = process.env.ELEVENLABS_AGENT_ID;
if (!clave) anotar('FALTA', 'ElevenLabs', `sin clave: juju no habla ni conversa. ${existsSync(ENV) ? 'Pegá' : 'Copiá .env.example como .env y pegá'} ELEVENLABS_API_KEY`);
else if (!agente) anotar('FALTA', 'ElevenLabs', 'hay clave pero falta crear el agente: node crear-agente.mjs');
else {
  try {
    const base = (process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io').replace(/\/$/, '');
    const r = await fetch(`${base}/v1/convai/agents/${encodeURIComponent(agente)}`, { headers: { 'xi-api-key': clave }, signal: AbortSignal.timeout(15000) });
    if (r.ok) { const d = await r.json(); anotar('OK', 'ElevenLabs', `agente "${d.name || agente}" encontrado`); }
    else anotar('FALLA', 'ElevenLabs', r.status === 401 ? 'la clave fue rechazada (401)' : r.status === 404 ? 'el agente no existe: volvé a correr node crear-agente.mjs' : `respondió ${r.status}`);
  } catch (e) { anotar('FALLA', 'ElevenLabs', `no se pudo consultar: ${e.message}`); }
  // La voz en vivo usa un segundo agente en Eleven Realtime; sin él funciona igual, con el agente de texto.
  const voz = process.env.ELEVENLABS_VOICE_AGENT_ID;
  anotar(voz ? 'OK' : 'AVISO', 'Voz en tiempo real', voz ? `agente de voz ${voz}` : 'sin agente de voz: la voz usa el agente de texto (más lenta). Lo crea node crear-agente.mjs si la cuenta tiene Eleven Realtime');
}

const ancho = Math.max(...filas.map((f) => f[1].length));
for (const [estado, que, detalle] of filas) console.log(`${estado.padEnd(5)}  ${que.padEnd(ancho)}  ${detalle}`);
const faltan = filas.filter((f) => f[0] === 'FALTA' || f[0] === 'FALLA').map((f) => f[1]);
console.log(faltan.length ? `\nPara completar: ${faltan.join(', ')}.` : '\nTodo listo: node server.mjs');
process.exit(grave ? 1 : 0);
