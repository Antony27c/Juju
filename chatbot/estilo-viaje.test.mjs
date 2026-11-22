import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { obtenerPerfil, clasificar } from './estilo-viaje.mjs';

const respuesta = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json' } });
const usuarioIG = { full_name: 'Viajera', biography: 'Naturaleza', profile_pic_url_hd: 'https://a.cdninstagram.com/avatar.jpg', edge_owner_to_timeline_media: { edges: [{ node: { display_url: 'https://a.cdninstagram.com/post.jpg', edge_media_to_caption: { edges: [{ node: { text: 'Camping 🎒' } }] } } }] } };
const perfil = { red: 'twitter', usuario: 'viajero', nombre: 'Viajero', bio: '', imagenes: [], textos: [] };
const local = { apiKey: '' };

test('interpreta formatos y normaliza Instagram', async () => {
  for (const entrada of ['@viajera', 'instagram:viajera', 'https://www.instagram.com/viajera/']) {
    const p = await obtenerPerfil(entrada, { fetch: async (url, o) => {
      assert.match(url, /username=viajera$/);
      assert.equal(o.headers['x-ig-app-id'], '936619743392459');
      return respuesta({ data: { user: usuarioIG } });
    } });
    assert.deepEqual(p, { red: 'instagram', usuario: 'viajera', nombre: 'Viajera', bio: 'Naturaleza', imagenes: [usuarioIG.profile_pic_url_hd, 'https://a.cdninstagram.com/post.jpg'], textos: ['Naturaleza', 'Camping 🎒'] });
  }
});

test('interpreta Twitter/X y normaliza FxTwitter', async () => {
  for (const entrada of ['twitter:viajero', 'x:viajero', 'https://twitter.com/viajero', 'https://x.com/viajero/']) {
    const p = await obtenerPerfil(entrada, { fetch: async url => {
      assert.equal(url, 'https://api.fxtwitter.com/viajero');
      return respuesta({ code: 200, user: { name: 'Viajero', description: 'Spa', avatar_url: 'avatar', banner_url: 'banner' } });
    } });
    assert.deepEqual(p, { ...perfil, bio: 'Spa', textos: ['Spa'], imagenes: ['avatar', 'banner'] });
  }
});

test('rechaza entradas inválidas antes de conectar', async () => {
  for (const entrada of ['', null, {}, 'https://', 'https://evil.test/user', 'https://x.com/user/status/1', 'x:con espacio', 'https://instagram.com/p/']) {
    await assert.rejects(obtenerPerfil(entrada, { fetch: () => assert.fail('No debe conectar') }), e => e.status === 400);
  }
});

test('errores claros de perfiles privados, ausentes, bloqueados y red', async () => {
  for (const fetch of [async () => respuesta({}, 403), async () => respuesta({}), async () => respuesta({ data: { user: { is_private: true } } }), async () => { throw new Error('offline'); }]) {
    await assert.rejects(obtenerPerfil('@viajera', { fetch }), /privado|bloqueado|conectar/);
  }
  await assert.rejects(obtenerPerfil('x:viajero', { fetch: async () => respuesta({ user: { protected: true } }) }), /privado/);
  await assert.rejects(obtenerPerfil('@viajera', { fetch: async () => new Response('html') }), /bloqueado/);
});

test('perfiles vacíos conservan forma normalizada', async () => {
  const p = await obtenerPerfil('@viajera', { fetch: async () => respuesta({ data: { user: {} } }) });
  assert.deepEqual(p, { red: 'instagram', usuario: 'viajera', nombre: 'viajera', bio: '', textos: [], imagenes: [] });
});

test('heurística español, inglés y emoji; sin señales neutral', async () => {
  for (const [texto, estilo] of [['Mochilero ecológico camping hiking 🎒 🌿', 'hippie'], ['Lujo luxury resort yacht 💎 🥂', 'luxury']]) {
    const r = await clasificar({ ...perfil, textos: [texto] }, local);
    assert.equal(r.estilo, estilo);
    assert.ok(r.probabilidades[estilo] > 0.5);
    assert.equal(r.probabilidades.hippie + r.probabilidades.luxury, 1);
    assert.equal(r.fuente, 'palabras-clave');
  }
  assert.deepEqual((await clasificar(perfil, local)).probabilidades, { hippie: 0.5, luxury: 0.5 });
  assert.equal((await clasificar({ ...perfil, bio: 'economía especial' }, local)).probabilidades.hippie, 0.5);
});

test('Gemini: imágenes inline limitadas, omite fallos, parsea JSON y mezcla normalizada', async () => {
  let llamadasImagen = 0;
  const r = await clasificar({ ...perfil, imagenes: Array.from({ length: 8 }, (_, i) => `https://pbs.twimg.com/${i}.jpg`) }, { apiKey: 'prueba', fetch: async (url, o) => {
    if (!url.includes('googleapis')) {
      llamadasImagen++;
      if (url.endsWith('/0.jpg')) throw new Error('imagen no disponible');
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    }
    const parts = JSON.parse(o.body).contents[0].parts;
    assert.equal(parts.length, 6);
    assert.equal(parts[1].inlineData.data, 'AQID');
    assert.equal(o.headers['x-goog-api-key'], 'prueba');
    return respuesta({ candidates: [{ content: { parts: [{ text: '```json\n{"hippie":0.2,"luxury":0.6,"razones":["Resort"]}\n```' }] } }] });
  } });
  assert.equal(llamadasImagen, 6);
  assert.ok(Math.abs(r.probabilidades.hippie - 0.3) < 1e-10);
  assert.ok(Math.abs(r.probabilidades.luxury - 0.7) < 1e-10);
  assert.equal(r.estilo, 'luxury');
  assert.equal(r.fuente, 'gemini+palabras-clave');
});

test('Gemini: errores HTTP, red y salida inválida', async () => {
  for (const d of [{}, { hippie: -1, luxury: 2, razones: [] }, { hippie: 0, luxury: 0, razones: [] }, { hippie: '0.5', luxury: 0.5, razones: [] }, { hippie: 0.5, luxury: 0.5, razones: [3] }]) {
    await assert.rejects(clasificar(perfil, { apiKey: 'prueba', fetch: async () => respuesta({ candidates: [{ content: { parts: [{ text: JSON.stringify(d) }] } }] }) }), /inválida/);
  }
  await assert.rejects(clasificar(perfil, { apiKey: 'prueba', fetch: async () => respuesta({}, 429) }), /HTTP 429/);
  await assert.rejects(clasificar(perfil, { apiKey: 'prueba', fetch: async () => { throw new Error(); } }), /conectar/);
});

test('imágenes: solo https desde los CDN de Instagram y X, con tope de tamaño', async () => {
  const pedidas = [];
  const imagenes = ['http://pbs.twimg.com/a.jpg', 'https://evil.test/b.jpg', 'https://169.254.169.254/c.jpg', 'https://twimg.com.evil.test/d.jpg', 'https://pbs.twimg.com/grande.jpg', 'https://scontent.cdninstagram.com/ok.jpg'];
  await clasificar({ ...perfil, imagenes }, { apiKey: 'prueba', fetch: async (url, o) => {
    if (!url.includes('googleapis')) {
      pedidas.push(url);
      if (url.endsWith('grande.jpg')) return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg', 'content-length': String(5 * 1024 * 1024) } });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    }
    assert.equal(JSON.parse(o.body).contents[0].parts.length, 2);
    return respuesta({ candidates: [{ content: { parts: [{ text: '{"hippie":0.5,"luxury":0.5,"razones":[]}' }] } }] });
  } });
  assert.deepEqual(pedidas, ['https://pbs.twimg.com/grande.jpg', 'https://scontent.cdninstagram.com/ok.jpg']);
});

test('consentimiento: el aviso existe y la consola no analiza sin --es-mi-perfil', async () => {
  const { AVISO_CONSENTIMIENTO } = await import('./estilo-viaje.mjs');
  assert.match(AVISO_CONSENTIMIENTO, /propio perfil/);
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./estilo-viaje.mjs', import.meta.url)), '@viajera'], { encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--es-mi-perfil/);
});
