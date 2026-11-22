// Opcional: registra en Cosmos Pay la URL pública que recibe los avisos de pago.
//   node registrar-webhook.mjs
// Requiere en .env: COSMOSPAY_API_KEY (con permiso webhooks:write) y URL_PUBLICA (https, accesible desde internet).
// Sin webhook el chat igual confirma los pagos consultando a Cosmos Pay cada pocos segundos.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV = path.join(path.dirname(fileURLToPath(import.meta.url)), '.env');
if (existsSync(ENV)) process.loadEnvFile(ENV);
const base = (process.env.URL_PUBLICA || '').replace(/\/$/, '');
if (!process.env.COSMOSPAY_API_KEY || !/^https:\/\//.test(base)) {
  console.error('Faltan COSMOSPAY_API_KEY y/o URL_PUBLICA (tiene que empezar con https://) en .env');
  process.exit(1);
}
const { registrarWebhook } = await import('./pagos.mjs');
const w = await registrarWebhook(`${base}/api/pagos/webhook`);
let env = readFileSync(ENV, 'utf8');
env = /^COSMOSPAY_WEBHOOK_SECRET=.*$/m.test(env) ? env.replace(/^COSMOSPAY_WEBHOOK_SECRET=.*$/m, `COSMOSPAY_WEBHOOK_SECRET=${w.secret}`) : `${env.replace(/\s*$/, '')}\nCOSMOSPAY_WEBHOOK_SECRET=${w.secret}\n`;
writeFileSync(ENV, env);
console.log(`Webhook registrado (${w.id}) en ${w.url}. El secreto quedó guardado en .env. Reiniciá el servidor.`);
