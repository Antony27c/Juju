import test from 'node:test';
import assert from 'node:assert/strict';
import { buscar, planRapido, lugarPorNombre, coincidenciaNombre } from './datos.mjs';

test('los lugares sin coordenadas aparecen al buscar en su localidad', () => {
  const r = buscar({ texto: 'pucara museo', localidad: 'Tilcara' });
  assert.ok(r.resultados.some((x) => x.nombre === 'Pucará de Tilcara - Museo Arqueológico'));
  const museo = r.resultados.find((x) => x.nombre === 'Pucará de Tilcara - Museo Arqueológico');
  assert.equal(museo.distancia_km, undefined); // sin coordenadas no se inventa una distancia
  assert.match(museo.mapa, /query=Puc/); // el mapa busca por nombre, no por "null,null"
  assert.doesNotMatch(museo.mapa, /null/);
});

test('un lugar sin coordenadas no aparece en otra localidad', () => {
  const r = buscar({ texto: 'pucara museo', localidad: 'Humahuaca', radio_km: 10 });
  assert.ok(!r.resultados.some((x) => x.nombre === 'Pucará de Tilcara - Museo Arqueológico'));
});

test('el nombre pesa en el orden de los resultados', () => {
  const r = buscar({ texto: 'pucara', localidad: 'Tilcara', limite: 3 });
  assert.match(r.resultados[0].nombre, /Pucará/);
});

test('coincidenciaNombre cuenta las palabras del pedido que están en el nombre', () => {
  assert.equal(coincidenciaNombre('Pucará de Tilcara', 'Pucará de Tilcara - Museo Arqueológico'), 1);
  assert.equal(coincidenciaNombre('Pucará de Tilcara', 'Camping El Pucará'), 0.5);
  assert.equal(coincidenciaNombre('', 'Lo que sea'), 0);
});

test('lugarPorNombre devuelve el lugar pedido o nada, nunca el primero que aparece', () => {
  assert.equal(lugarPorNombre({ lugar: 'Pucará de Tilcara', localidad: 'Tilcara' })?.nombre, 'Pucará de Tilcara - Museo Arqueológico');
  assert.equal(lugarPorNombre({ lugar: 'Restaurante Azul', localidad: 'Tilcara' })?.nombre, 'Restaurante Azul');
  assert.equal(lugarPorNombre({ lugar: 'Hotel inventado xyz', localidad: 'Tilcara' }), null);
  assert.equal(lugarPorNombre({ lugar: '', localidad: 'Tilcara' }), null);
});

test('el plan rápido incluye lugares sin coordenadas de la localidad', () => {
  const p = planRapido({ localidad: 'Tilcara', hora: '11:00' });
  assert.ok(Array.isArray(p.para_hacer));
});
