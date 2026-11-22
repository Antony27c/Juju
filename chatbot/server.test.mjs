import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// Levanta el servidor sin claves en un puerto libre y prueba rutas que no necesitan ElevenLabs.
async function conServidor(fn) {
  const puerto = 4100 + Math.floor(Math.random() * 800);
  const env = { ...process.env, PUERTO: String(puerto), PORT: '', HOST: '127.0.0.1', ELEVENLABS_API_KEY: '', PAGOS_PROVEEDOR: 'simulado' };
  const srv = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, mal) => { srv.stdout.on('data', (d) => /escuchando/.test(d) && ok()); srv.on('exit', mal); setTimeout(() => mal(new Error('el servidor no arrancó')), 8000); });
  try { await fn(`http://127.0.0.1:${puerto}`); } finally { srv.kill(); }
}
const post = (base, ruta, body) => fetch(base + ruta, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('servidor: URL mal escrita, reservas y lugares', async () => {
  await conServidor(async (base) => {
    assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
    assert.equal((await fetch(`${base}/api/estado`)).status, 200);

    let r = await post(base, '/api/reservas', { lugar: 'Pucará de Tilcara', localidad: 'Tilcara', personas: 2, metodo_pago: 'usdc' });
    assert.equal(r.status, 200);
    assert.doesNotMatch((await r.json()).item.name, /Camping/);

    r = await post(base, '/api/reservas', { lugar: 'Hotel inventado xyz', personas: 2, noches: 3, metodo_pago: 'banco' });
    assert.equal(r.status, 404);
    assert.match((await r.json()).error, /no figura en el directorio/);

    r = await post(base, '/api/reservas', { lugar: 'Hornocal', personas: 2, metodo_pago: 'usdc', cotizar: true });
    const d = await r.json();
    assert.equal(d.kind, 'product'); // "Hornocal" es la experiencia del catálogo, no un tour cualquiera
    assert.match(d.item.name, /Hornocal/);
  });
});
