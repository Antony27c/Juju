// Guarda una copia local del SDK de ElevenLabs en public/vendor/, para no depender de jsDelivr ni unpkg.
// La página la busca primero en /vendor/elevenlabs-client.js y, si no está, recién ahí va a los CDN.
// Uso: node vendor-sdk.mjs   (y después subir public/vendor/elevenlabs-client.js al repo)
// La versión tiene que coincidir con la de la constante SDK en public/index.html.

import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.37.1';
const FUENTES = [
  `https://cdn.jsdelivr.net/npm/@elevenlabs/client@${VERSION}/dist/lib.iife.js`,
  `https://unpkg.com/@elevenlabs/client@${VERSION}/dist/lib.iife.js`,
];
const DESTINO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'vendor', 'elevenlabs-client.js');

for (const url of FUENTES) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const codigo = Buffer.from(await r.arrayBuffer());
    if (codigo.length < 10_000) throw new Error('el archivo bajado es demasiado chico');
    await mkdir(path.dirname(DESTINO), { recursive: true });
    await writeFile(DESTINO, codigo);
    console.log(`Listo: ${path.relative(process.cwd(), DESTINO)} (${Math.round(codigo.length / 1024)} KB, sha256 ${createHash('sha256').update(codigo).digest('hex').slice(0, 16)}…) desde ${new URL(url).host}`);
    process.exit(0);
  } catch (e) {
    console.error(`No se pudo bajar de ${new URL(url).host}: ${e.message}`);
  }
}
console.error('No se pudo bajar el SDK. Revisá la conexión y probá de nuevo.');
process.exit(1);
