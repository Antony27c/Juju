import test from 'node:test';
import assert from 'node:assert/strict';

process.env.PASAPORTE_SECRETO = 'test-secret';
const { stops, badges, codeFor, verifyCode, stamp, passportState } = await import('./pasaporte.mjs');

const slugs = stops.map((s) => s.slug);
const visit = (...ss) => ss.map((slug, i) => ({ slug, en: `2026-11-22T1${i}:00:00.000Z` }));

test('every stop in pasaporte.json resolves to a directory record with coordinates', () => {
  assert.equal(stops.length, 29);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of stops) {
    assert.ok(Number.isFinite(s.lat) && Number.isFinite(s.lon), s.slug);
    assert.ok(['Quebrada', 'Puna', 'Valles', 'Yungas'].includes(s.region), s.slug);
  }
});

test('signed codes verify, and tampered or unknown codes do not', () => {
  const code = codeFor('pucara-de-tilcara');
  assert.match(code, /^pucara-de-tilcara\.[A-Za-z0-9_-]{12}$/);
  assert.equal(verifyCode(code).slug, 'pucara-de-tilcara');
  assert.equal(verifyCode(code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(verifyCode(`hornocal.${code.split('.')[1]}`), null); // another stop's signature
  assert.equal(verifyCode('no-existe.AAAAAAAAAAAA'), null);
  assert.equal(verifyCode('pucara-de-tilcara'), null);
});

test('stamp by QR, and by GPS only within the radius', () => {
  const qr = stamp({ codigo: codeFor('hornocal') });
  assert.equal(qr.ok, true);
  assert.equal(qr.metodo, 'qr');
  assert.equal(qr.parada.slug, 'hornocal');
  assert.equal(stamp({ codigo: 'hornocal.xxxxxxxxxxxx' }).ok, false);

  const s = stops.find((x) => x.slug === 'cabildo-de-jujuy');
  assert.equal(stamp({ slug: s.slug, lat: s.lat + 0.001, lon: s.lon }).ok, true); // about 110 m away
  const far = stamp({ slug: s.slug, lat: s.lat + 0.05, lon: s.lon }); // about 5.5 km away
  assert.equal(far.ok, false);
  assert.match(far.error, /Acercate/);
  assert.equal(stamp({ slug: s.slug }).ok, false);
});

test('state counts each stop once and orders what is left nearest first', () => {
  const st = passportState({ visitas: [...visit('siete-colores', 'pucara-de-tilcara'), { slug: 'siete-colores' }, { slug: 'inventada' }], hora: '11:00' });
  assert.equal(st.sellados, 2);
  assert.equal(st.pendientes.length, stops.length - 2);
  assert.deepEqual(st.visitadas.map((v) => v.slug), ['siete-colores', 'pucara-de-tilcara']);
  assert.equal(st.desde, 'Pucará de Tilcara'); // no location: starts at the last stamp
  const d = st.pendientes.map((p) => p.distancia_km);
  assert.ok(d[0] <= 10, `first suggestion should be near Tilcara, got ${d[0]} km`);
  assert.deepEqual(st.pendientes.map((p) => p.orden), st.pendientes.map((_, i) => i + 1));
  assert.match(st.texto_modelo, /2 de 29 sellos/);
});

test('at night outdoor stops are "not now", far ones are for another day', () => {
  const night = passportState({ hora: '22:30' });
  const garganta = night.pendientes.find((p) => p.slug === 'garganta-del-diablo');
  assert.equal(garganta.ahora, 'no');
  assert.match(garganta.motivo, /De noche/);
  const day = passportState({ hora: '11:00' }); // from San Salvador de Jujuy
  assert.equal(day.pendientes.find((p) => p.slug === 'catedral-de-jujuy').ahora, 'si');
  assert.equal(day.pendientes.find((p) => p.slug === 'paicone').ahora, 'otro_dia');
});

test('badges follow their rules', () => {
  const byId = (st) => Object.fromEntries(st.insignias.map((b) => [b.id, b]));
  const none = byId(passportState({}));
  assert.equal(none['primer-sello'].ganada, false);
  assert.equal(badges.length, none ? Object.keys(none).length : 0);

  const colors = byId(passportState({ visitas: visit('siete-colores', 'paleta-del-pintor', 'hornocal', 'paicone') }));
  assert.equal(colors['primer-sello'].ganada, true);
  assert.equal(colors['cerros-de-colores'].ganada, true);
  assert.equal(colors['naturaleza-pura'].hecho, 4);
  assert.equal(colors['cuatro-regiones'].hecho, 2);

  const regions = byId(passportState({ visitas: visit('hornocal', 'casa-de-yavi', 'cabildo-de-jujuy', 'calilegua') }));
  assert.equal(regions['cuatro-regiones'].ganada, true);

  const all = byId(passportState({ visitas: visit(...slugs) }));
  for (const b of Object.values(all)) assert.equal(b.ganada, true, b.id);
});
