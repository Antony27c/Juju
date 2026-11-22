// El estilo de viaje de punta a punta: qué se lee del perfil, los tres resultados y cómo cambia el orden de las búsquedas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { obtenerPerfil, clasificar, estiloDeViaje, claveGemini } from './estilo-viaje.mjs';
import { buscar, planRapido } from './datos.mjs';

const pagina = (titulo) => `<html><head><meta property="og:title" content="${titulo}" /><meta property="og:description" content="1,204 Followers, 300 Following, 88 Posts - See Instagram photos" /><meta property="og:image" content="https://scontent.cdninstagram.com/v/foto.jpg" /></head></html>`;
// Instagram bloquea el pedido completo (429) y deja ver la página pública del perfil.
const instagramBloqueado = (html) => async (url) => (String(url).includes('/api/v1/users/')
  ? { ok: false, status: 429, json: async () => ({}) }
  : { ok: true, status: 200, text: async () => html });

test('los tres resultados: fancy, low cost y neutral', () => {
  assert.equal(estiloDeViaje({ hippie: 0.2, luxury: 0.8 }), 'fancy');
  assert.equal(estiloDeViaje({ hippie: 0.75, luxury: 0.25 }), 'low_cost');
  assert.equal(estiloDeViaje({ hippie: 0.5, luxury: 0.5 }), 'neutral');
  assert.equal(estiloDeViaje({ hippie: 0.55, luxury: 0.45 }), 'neutral'); // una diferencia chica no alcanza
});

test('con Instagram bloqueado se lee la página pública: nombre, números y foto', async () => {
  const p = await obtenerPerfil('@juana.viaja', { fetch: instagramBloqueado(pagina('Juana P&#xe9;rez (&#064;juana.viaja) &#x2022; Instagram photos and videos')) });
  assert.equal(p.nombre, 'Juana Pérez');
  assert.equal(p.parcial, true);
  assert.equal(p.resumen, '1,204 Followers, 300 Following, 88 Posts');
  assert.deepEqual(p.imagenes, ['https://scontent.cdninstagram.com/v/foto.jpg']);
  assert.equal(estiloDeViaje((await clasificar(p, { apiKey: '' })).probabilidades), 'neutral'); // nada en el nombre: neutral, no se inventa
});

test('el nombre o el usuario alcanzan cuando lo dicen', async () => {
  const lujo = await obtenerPerfil('@luxurytravel', { fetch: instagramBloqueado(pagina('Provider of Luxury (&#064;luxurytravel)')) });
  assert.equal(estiloDeViaje((await clasificar(lujo, { apiKey: '' })).probabilidades), 'fancy');
  const mochila = await obtenerPerfil('@mochilerosxelmundo', { fetch: instagramBloqueado(pagina('Viajando a dedo (&#064;mochilerosxelmundo)')) });
  assert.equal(estiloDeViaje((await clasificar(mochila, { apiKey: '' })).probabilidades), 'low_cost');
});

test('si la página pública es de otro perfil o no se puede leer, queda el error de Instagram', async () => {
  await assert.rejects(obtenerPerfil('@juana.viaja', { fetch: instagramBloqueado(pagina('Otra Persona (&#064;otra)')) }), /bloqueado/);
  await assert.rejects(obtenerPerfil('@juana.viaja', { fetch: instagramBloqueado('<html><title>Instagram</title></html>') }), /bloqueado/);
});

test('la clave de Google AI Studio se toma de GA o de GEMINI_API_KEY, y Gemini recibe el perfil y la foto', async () => {
  const antes = { GA: process.env.GA, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  try {
    delete process.env.GEMINI_API_KEY; process.env.GA = 'clave-de-prueba';
    assert.equal(claveGemini(), 'clave-de-prueba');
    const pedidos = [];
    const falso = async (url, opciones = {}) => {
      url = String(url);
      if (url.includes('generativelanguage.googleapis.com')) {
        pedidos.push({ url, clave: opciones.headers['x-goog-api-key'], cuerpo: JSON.parse(opciones.body) });
        return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"hippie":0.1,"luxury":0.9,"razones":["hoteles boutique"]}' }] } }] }) };
      }
      if (url.includes('cdninstagram.com')) return { ok: true, status: 200, headers: new Map([['content-type', 'image/jpeg'], ['content-length', '4']]), arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer };
      return instagramBloqueado(pagina('Juana Pérez (&#064;juana.viaja)'))(url);
    };
    const perfil = await obtenerPerfil('@juana.viaja', { fetch: falso });
    const c = await clasificar(perfil, { fetch: falso }); // sin apiKey explícita: usa GA
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0].clave, 'clave-de-prueba');
    const partes = pedidos[0].cuerpo.contents[0].parts;
    assert.match(partes[0].text, /Juana Pérez/);
    assert.match(partes[0].text, /1,204 Followers/);
    assert.equal(partes.filter((x) => x.inlineData).length, 1); // la foto de perfil
    assert.equal(c.fuente, 'gemini+palabras-clave');
    assert.equal(estiloDeViaje(c.probabilidades), 'fancy');
  } finally {
    for (const [k, v] of Object.entries(antes)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  }
});

// El embed público de un perfil: los datos van como un JSON dentro de otro, igual que en la página real.
const embed = (contexto) => `<html><script>x({"contextJSON":${JSON.stringify(JSON.stringify({ context: contexto }))}})</script></html>`;
const publicaciones = (n) => Array.from({ length: n }, (_, i) => ({ shortcode_media: {
  display_url: `https://instagram.fna.fbcdn.net/v/grande${i}.jpg`, display_resources: [{ src: `https://instagram.fna.fbcdn.net/v/chica${i}.jpg`, config_width: 640 }],
  edge_media_to_caption: { edges: [{ node: { text: i === 0 ? 'Acampando con la mochila en la montaña' : `Publicación ${i}` } }] },
} }));

test('con el embed público se leen las últimas publicaciones y Gemini mira hasta 5 fotos', async () => {
  const fotosPedidas = [], modelosPedidos = [];
  const falso = async (url, opciones = {}) => {
    url = String(url);
    if (url.includes('/api/v1/users/')) return { ok: false, status: 429, json: async () => ({}) };
    if (url.endsWith('/embed/')) return { ok: true, status: 200, text: async () => embed({ username: 'juana.viaja', full_name: 'Juana Pérez', followers_count: 1204, posts_count: 88, graphql_media: publicaciones(6) }) };
    if (url.includes('fbcdn.net')) { fotosPedidas.push(url); return { ok: true, status: 200, headers: new Map([['content-type', 'image/jpeg']]), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; }
    if (url.includes('/models?')) return { ok: true, status: 200, json: async () => ({ models: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.8-flash-tts', 'gemini-3.6-flash'].map((n) => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }) };
    if (url.includes(':generateContent')) {
      const modelo = url.match(/models\/([^:]+):/)[1]; modelosPedidos.push(modelo);
      if (modelo === 'gemini-3.8-flash') return { ok: false, status: 503, json: async () => ({ error: { message: 'high demand' } }) }; // saturado
      const partes = JSON.parse(opciones.body).contents[0].parts;
      assert.equal(partes.filter((x) => x.inlineData).length, 5);
      assert.match(partes[0].text, /Acampando con la mochila/);
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"hippie":0.85,"luxury":0.15,"razones":["carpa y mochila en las fotos"]}' }] } }] }) };
    }
    throw new Error('pedido inesperado: ' + url);
  };
  const perfil = await obtenerPerfil('@juana.viaja', { fetch: falso });
  assert.equal(perfil.origen, 'embed');
  assert.equal(perfil.imagenes.length, 6);
  assert.match(perfil.imagenes[0], /chica0/); // el tamaño chico, no el original
  const c = await clasificar(perfil, { apiKey: 'k', fetch: falso });
  assert.equal(fotosPedidas.length, 5); // no más de 5 fotos
  assert.deepEqual(modelosPedidos, ['gemini-3.8-flash', 'gemini-3.7-flash']); // 3.8 saturado: sigue con el más parecido
  assert.equal(c.modelo, 'gemini-3.7-flash');
  assert.equal(c.fotos, 5);
  assert.equal(estiloDeViaje(c.probabilidades), 'low_cost');
});

test('el estilo cambia de verdad el orden de las recomendaciones', () => {
  const sencillos = new Set(['hostel', 'camping', 'refugio']);
  const dormir = (estilo) => buscar({ categoria: 'alojamiento', localidad: 'Tilcara', limite: 5, hora: '15:00', estilo }).resultados;
  const low = dormir('low_cost'), fancy = dormir('fancy'), neutral = dormir('neutral');
  assert.ok(low.every((x) => sencillos.has(x.tipo) && x.precio.startsWith('$ ')), 'low cost: hostels y campings de precio $');
  assert.ok(fancy.every((x) => !sencillos.has(x.tipo) && x.precio.startsWith('$$')), 'fancy: ningún hostel ni camping, precio $$ o más');
  assert.ok(neutral.every((x) => x.precio.startsWith('$$')), 'neutral: precio medio primero');
  assert.notDeepEqual(low.map((x) => x.nombre), fancy.map((x) => x.nombre));
  assert.equal(buscar({ categoria: 'alojamiento', localidad: 'Tilcara', estilo: 'low_cost' }).total_encontrados,
    buscar({ categoria: 'alojamiento', localidad: 'Tilcara' }).total_encontrados, 'no deja lugares afuera');
  // y también en el plan rápido (qué hacer y dónde comer)
  const comer = (estilo) => planRapido({ localidad: 'San Salvador de Jujuy', hora: '13:00', estilo }).para_comer.map((x) => x.nombre);
  assert.notDeepEqual(comer('low_cost'), comer('fancy'));
});
