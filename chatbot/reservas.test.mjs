import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmDemoReservation } from './reservas.mjs';

const lugar = { nombre: 'Restaurante Azul', categoria: 'gastronomia', tipo: 'restaurante', localidad: 'Tilcara', precio: '$$ (estimado)' };
const producto = { id: 'hornocal', nombre: 'Serranía de Hornocal', precio_usd: 20 };

test('no reserva algo que no está en el directorio ni en el catálogo', () => {
  assert.throws(() => confirmDemoReservation({ lugar: 'Hotel inventado xyz', personas: 2, metodo_pago: 'usdc' }, null, null), /No encontré "Hotel inventado xyz"/);
  assert.throws(() => confirmDemoReservation({ metodo_pago: 'usdc' }, null, null), /Falta el lugar/);
});

test('no reserva para una fecha que ya pasó', () => {
  assert.throws(() => confirmDemoReservation({ personas: 2, metodo_pago: 'usdc', fecha: '2020-01-01' }, lugar, null), /ya pasó/);
});

test('reserva un lugar encontrado y una experiencia del catálogo', () => {
  const r = confirmDemoReservation({ personas: 2, metodo_pago: 'usdc', fecha: '2099-01-01' }, lugar, null);
  assert.equal(r.status, 'confirmed');
  assert.equal(r.item.name, 'Restaurante Azul');
  assert.equal(r.amount_usd, 28);
  const p = confirmDemoReservation({ personas: 2, metodo_pago: 'banco', cotizar: true }, null, producto);
  assert.equal(p.status, 'quoted');
  assert.equal(p.amount_usd, 40);
  assert.equal(p.code, null);
});
