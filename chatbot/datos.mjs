// Directorio turístico de Jujuy: carga, búsqueda y "plan rápido".
// El esquema (categorías, regiones, rangos de precio, campos) sale de ../estructura.json.
// Datos: usa ../jujuy_turismo.json si existe; si no, normaliza en memoria la descarga
// cruda ../datos_crudos/osm.json al mismo formato de "registro".

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { momento, estadoHorario, sinAcentos } from './horarios.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = process.env.JUJUY_DATOS || path.resolve(AQUI, '..');
const leerJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));

export const estructura = leerJson(path.join(RAIZ, 'estructura.json'));
const REGION_DE = Object.fromEntries(Object.entries(estructura.regiones).flatMap(([r, ds]) => ds.map((d) => [d, r])));
const ORDEN_PRECIO = ['gratis', '$', '$$', '$$$', '$$$$'];

// Localidades de referencia [nombre, departamento, lat, lon, alias...] (coordenadas aproximadas).
// Sirven para entender "estoy en Tilcara" y, en el modo crudo, para asignar localidad/departamento
// por cercanía (la descarga de límites departamentales falló).
const LOCALIDADES = [
  ['San Salvador de Jujuy', 'Dr. Manuel Belgrano', -24.1858, -65.2995, 'jujuy', 'san salvador', 'ssj', 'capital', 'jujuy capital', 'la capital', 'centro'],
  ['Yala', 'Dr. Manuel Belgrano', -24.121, -65.402], ['Lozano', 'Dr. Manuel Belgrano', -24.083, -65.403],
  ['Termas de Reyes', 'Dr. Manuel Belgrano', -24.171, -65.489, 'reyes'], ['León', 'Dr. Manuel Belgrano', -24.04, -65.43],
  ['Palpalá', 'Palpalá', -24.257, -65.212],
  ['El Carmen', 'El Carmen', -24.388, -65.262], ['Perico', 'El Carmen', -24.383, -65.113, 'ciudad perico'],
  ['Monterrico', 'El Carmen', -24.443, -65.163], ['Pampa Blanca', 'El Carmen', -24.53, -65.07], ['Aguas Calientes', 'El Carmen', -24.58, -64.93],
  ['San Antonio', 'San Antonio', -24.367, -65.337],
  ['Volcán', 'Tumbaya', -23.917, -65.467], ['Tumbaya', 'Tumbaya', -23.857, -65.467], ['Purmamarca', 'Tumbaya', -23.745, -65.499, 'siete colores'],
  ['Salinas Grandes', 'Tumbaya', -23.62, -65.88, 'salinas'], ['El Moreno', 'Tumbaya', -23.85, -65.83],
  ['Maimará', 'Tilcara', -23.623, -65.408], ['Tilcara', 'Tilcara', -23.577, -65.394], ['Huacalera', 'Tilcara', -23.437, -65.35],
  ['Uquía', 'Humahuaca', -23.303, -65.357], ['Humahuaca', 'Humahuaca', -23.205, -65.35, 'hornocal'], ['Iturbe', 'Humahuaca', -22.977, -65.35],
  ['Tres Cruces', 'Humahuaca', -22.917, -65.587], ['El Aguilar', 'Humahuaca', -23.21, -65.68], ['Palca de Aparzo', 'Humahuaca', -23.13, -65.13],
  ['Abra Pampa', 'Cochinoca', -22.722, -65.697], ['Casabindo', 'Cochinoca', -22.983, -66.033], ['Cochinoca', 'Cochinoca', -22.74, -65.89],
  ['Puesto del Marqués', 'Cochinoca', -22.53, -65.69],
  ['La Quiaca', 'Yavi', -22.105, -65.597], ['Yavi', 'Yavi', -22.13, -65.463], ['Pumahuasi', 'Yavi', -22.29, -65.68],
  ['Santa Catalina', 'Santa Catalina', -21.945, -66.052], ['Cieneguillas', 'Santa Catalina', -22.1, -65.87], ['Cusi Cusi', 'Santa Catalina', -22.34, -66.49],
  ['Rinconada', 'Rinconada', -22.44, -66.167], ['Mina Pirquitas', 'Rinconada', -22.7, -66.47], ['Lagunillas del Farallón', 'Rinconada', -22.44, -66.63],
  ['Susques', 'Susques', -23.4, -66.367], ['Coranzulí', 'Susques', -23.02, -66.37], ['Catua', 'Susques', -23.87, -67.0],
  ['Olaroz Chico', 'Susques', -23.39, -66.8], ['Paso de Jama', 'Susques', -23.24, -67.03, 'jama'], ['Huancar', 'Susques', -23.56, -66.41],
  ['Libertador General San Martín', 'Ledesma', -23.807, -64.789, 'libertador', 'ledesma'], ['Calilegua', 'Ledesma', -23.775, -64.77],
  ['Fraile Pintado', 'Ledesma', -23.94, -64.8], ['Caimancito', 'Ledesma', -23.74, -64.59], ['Yuto', 'Ledesma', -23.643, -64.472],
  ['San Pedro de Jujuy', 'San Pedro', -24.231, -64.868, 'san pedro'], ['La Mendieta', 'San Pedro', -24.31, -64.96],
  ['Santa Clara', 'Santa Bárbara', -24.31, -64.66], ['Palma Sola', 'Santa Bárbara', -23.98, -64.3], ['El Talar', 'Santa Bárbara', -23.56, -64.36],
  ['El Fuerte', 'Santa Bárbara', -24.26, -64.42], ['El Piquete', 'Santa Bárbara', -24.18, -64.68],
  ['Valle Grande', 'Valle Grande', -23.475, -64.948], ['San Francisco', 'Valle Grande', -23.62, -64.95], ['Santa Ana', 'Valle Grande', -23.36, -64.99],
  ['Pampichuela', 'Valle Grande', -23.53, -64.97], ['Caspalá', 'Valle Grande', -23.37, -65.09],
].map(([nombre, departamento, lat, lon, ...alias]) => ({ nombre, departamento, lat, lon, claves: [nombre, ...alias].map(sinAcentos) }));

export function km(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

export function localidadMasCercana(lat, lon) {
  let mejor = null;
  for (const l of LOCALIDADES) {
    const d = km(lat, lon, l.lat, l.lon);
    if (!mejor || d < mejor.km) mejor = { ...l, km: d };
  }
  return mejor;
}

const DE_REGISTROS = new Map(); // localidad normalizada -> centroide, armado al cargar los registros

/** "tilcara", "Jujuy", "san salvador", "huichaira" -> { nombre, lat, lon } (o null). */
export function resolverLocalidad(txt) {
  const q = sinAcentos(txt).replace(/^(en|por|cerca de|zona de)s+/, '');
  if (!q) return null;
  const parcial = (c) => c.length > 3 && (q.includes(c) || c.includes(q));
  return LOCALIDADES.find((l) => l.claves.includes(q))
    || DE_REGISTROS.get(q)
    || LOCALIDADES.find((l) => l.claves.some(parcial))
    || [...DE_REGISTROS.entries()].filter(([c]) => parcial(c)).sort((a, b) => b[1].n - a[1].n)[0]?.[1]
    || null;
}

// ---------- normalización del OSM crudo al formato "registro" de estructura.json ----------
// [clave, valor(es), categoria, subcategoria] en orden de prioridad (gana la primera que coincide).
const REGLAS = [
  ['tourism', 'hotel', 'alojamiento', 'hotel'], ['tourism', 'hostel', 'alojamiento', 'hostel'],
  ['tourism', 'guest_house', 'alojamiento', 'hosteria_posada'], ['tourism', 'chalet', 'alojamiento', 'cabana'],
  ['tourism', 'apartment', 'alojamiento', 'departamento_turistico'], ['tourism', 'camp_site|caravan_site', 'alojamiento', 'camping'],
  ['tourism', 'motel', 'alojamiento', 'motel'], ['tourism', 'alpine_hut|wilderness_hut', 'alojamiento', 'refugio'],
  ['amenity', 'restaurant', 'gastronomia', 'restaurante'], ['amenity', 'cafe', 'gastronomia', 'cafe'],
  ['amenity', 'bar|pub|biergarten', 'gastronomia', 'bar_pub'], ['amenity', 'fast_food', 'gastronomia', 'comida_rapida'],
  ['amenity', 'ice_cream', 'gastronomia', 'heladeria'], ['amenity', 'food_court', 'gastronomia', 'patio_de_comidas'],
  ['shop', 'bakery|pastry|confectionery', 'gastronomia', 'panaderia'],
  ['amenity', 'nightclub', 'vida_nocturna_ocio', 'boliche'], ['amenity', 'casino', 'vida_nocturna_ocio', 'casino'],
  ['amenity', 'cinema', 'vida_nocturna_ocio', 'cine'], ['amenity', 'theatre', 'vida_nocturna_ocio', 'teatro'],
  ['tourism', 'museum', 'atractivo_cultural', 'museo'], ['historic', 'archaeological_site', 'atractivo_cultural', 'sitio_arqueologico'],
  ['tourism', 'viewpoint', 'atractivo_natural', 'mirador'], ['natural', 'volcano', 'atractivo_natural', 'volcan'],
  ['natural', 'waterfall', 'atractivo_natural', 'cascada'], ['natural', 'hot_spring', 'atractivo_natural', 'termas'],
  ['natural', 'cave_entrance', 'atractivo_natural', 'cueva'], ['natural', 'salt_pond', 'atractivo_natural', 'salar_laguna'],
  ['boundary', 'national_park|protected_area', 'atractivo_natural', 'area_protegida'], ['leisure', 'nature_reserve', 'atractivo_natural', 'area_protegida'],
  ['natural', 'peak', 'atractivo_natural', 'cerro_pico'],
  ['tourism', 'attraction', 'atractivo_cultural', 'atractivo_general'], ['historic', 'ruins', 'atractivo_cultural', 'ruinas'],
  ['historic', 'monument|memorial', 'atractivo_cultural', 'monumento'], ['tourism', 'artwork', 'atractivo_cultural', 'obra_de_arte'],
  ['historic', 'building|manor|castle|heritage|yes', 'atractivo_cultural', 'edificio_historico'],
  ['amenity', 'arts_centre', 'atractivo_cultural', 'centro_cultural'],
  ['shop', 'travel_agency', 'actividad_excursion', 'agencia_de_viajes'], ['office', 'travel_agent|tourism', 'actividad_excursion', 'agencia_de_viajes'],
  ['office', 'guide', 'actividad_excursion', 'guia'], ['leisure', 'horse_riding', 'actividad_excursion', 'cabalgata'],
  ['tourism', 'trail_riding_station', 'actividad_excursion', 'cabalgata'], ['amenity', 'bicycle_rental', 'actividad_excursion', 'alquiler_bicicletas'],
  ['tourism', 'theme_park', 'actividad_excursion', 'parque_tematico'], ['leisure', 'water_park', 'actividad_excursion', 'parque_acuatico'],
  ['leisure', 'swimming_pool', 'actividad_excursion', 'pileta'], ['leisure', 'golf_course', 'actividad_excursion', 'golf'],
  ['tourism', 'picnic_site', 'actividad_excursion', 'area_de_picnic'],
  ['shop', 'craft|art', 'compras', 'artesanias'], ['craft', 'pottery|weaver|handicraft', 'compras', 'artesanias'],
  ['shop', 'gift|souvenir', 'compras', 'regalos_souvenirs'], ['amenity', 'marketplace', 'compras', 'mercado_feria'],
  ['shop', 'wine', 'compras', 'vinoteca_bodega'], ['craft', 'winery', 'compras', 'vinoteca_bodega'],
  ['shop', 'deli|chocolate', 'compras', 'delicatessen'], ['craft', 'brewery', 'compras', 'cerveceria_artesanal'], ['shop', 'outdoor', 'compras', 'outdoor'],
  ['tourism', 'information', 'servicios_al_viajero', 'informacion_turistica'], ['amenity', 'bus_station', 'servicios_al_viajero', 'terminal_de_omnibus'],
  ['aeroway', 'aerodrome', 'servicios_al_viajero', 'aeropuerto'], ['amenity', 'car_rental', 'servicios_al_viajero', 'alquiler_de_autos'],
  ['amenity', 'bureau_de_change', 'servicios_al_viajero', 'casa_de_cambio'], ['amenity', 'fuel', 'servicios_al_viajero', 'estacion_de_servicio'],
  ['leisure', 'park', 'atractivo_natural', 'parque_plaza'], ['leisure', 'sports_centre|stadium', 'actividad_excursion', 'complejo_deportivo'],
  ['amenity', 'place_of_worship', 'atractivo_cultural', 'iglesia_capilla'], ['historic', 'wayside_shrine|wayside_cross', 'atractivo_cultural', 'iglesia_capilla'],
].map(([k, v, c, s]) => [k, v.split('|'), c, s]);

const GRATIS = new Set(['cerro_pico', 'volcan', 'mirador', 'cascada', 'cueva', 'salar_laguna', 'area_protegida', 'parque_plaza', 'ruinas', 'monumento', 'iglesia_capilla', 'obra_de_arte', 'edificio_historico', 'area_de_picnic']);
const PRECIO_SUB = {
  hostel: '$', camping: '$', refugio: '$', hosteria_posada: '$$', cabana: '$$', hotel: '$$', departamento_turistico: '$$', motel: '$$',
  restaurante: '$$', bar_pub: '$$', cafe: '$', comida_rapida: '$', heladeria: '$', panaderia: '$', patio_de_comidas: '$', museo: '$',
};

function desdeOSM(osm) {
  const out = [];
  for (const e of osm.elements || []) {
    const t = e.tags || {};
    const nombre = t['name:es'] || t.name;
    if (!nombre) continue;
    if (t.tourism === 'information' && t.information && !['office', 'visitor_centre'].includes(t.information)) continue;
    const regla = REGLAS.find(([k, vs]) => vs.includes(t[k]));
    if (!regla) continue;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    const [, , categoria, subcategoria] = regla;
    const cerca = localidadMasCercana(lat, lon);
    const estrellas = parseInt(t.stars, 10) || null;
    let rango = GRATIS.has(subcategoria) ? 'gratis' : PRECIO_SUB[subcategoria] || 'sin_dato';
    if (subcategoria === 'hotel' && estrellas) rango = estrellas >= 5 ? '$$$$' : estrellas === 4 ? '$$$' : '$$';
    const calle = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
    out.push({
      id: `osm-${e.type}-${e.id}`, nombre, categoria, subcategoria,
      region: REGION_DE[cerca.departamento], departamento: cerca.departamento,
      localidad: t['addr:city'] || cerca.nombre, direccion: calle || null, lat, lon,
      rango_precio: rango, precio_origen: rango === 'sin_dato' ? 'sin_dato' : 'estimado',
      estrellas, cocina: t.cuisine ? t.cuisine.replace(/;/g, ', ').replace(/_/g, ' ') : null,
      telefono: t.phone || t['contact:phone'] || null, email: t.email || t['contact:email'] || null,
      web: t.website || t['contact:website'] || null,
      redes: t['contact:instagram'] || t['contact:facebook'] || null,
      horario: t.opening_hours || null, descripcion: t['description:es'] || t.description || null,
      altitud_m: t.ele && !isNaN(parseFloat(t.ele)) ? Math.round(parseFloat(t.ele)) : null,
      fuente: 'OpenStreetMap', fuente_url: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      _interes: (t.wikidata || t.wikipedia ? 2 : 0) + (t.tourism === 'attraction' ? 1 : 0),
    });
  }
  return out;
}

function cargar() {
  const oficial = path.join(RAIZ, 'jujuy_turismo.json');
  if (existsSync(oficial)) {
    const d = leerJson(oficial);
    const regs = Array.isArray(d) ? d : d.registros;
    if (Array.isArray(regs) && regs.length) return { registros: regs, origen: 'jujuy_turismo.json' };
  }
  const crudo = path.join(RAIZ, 'datos_crudos', 'osm.json');
  if (existsSync(crudo)) return { registros: desdeOSM(leerJson(crudo)), origen: 'datos_crudos/osm.json (normalizado en memoria)' };
  return { registros: [], origen: 'sin datos' };
}

const { registros, origen } = cargar();
for (const r of registros) {
  r._txt = sinAcentos([r.nombre, r.subcategoria, r.categoria, r.cocina, r.descripcion, r.localidad, r.direccion].filter(Boolean).join(' ')).replace(/_/g, ' ');
  if (r.localidad) {
    const k = sinAcentos(r.localidad);
    const c = DE_REGISTROS.get(k) || { nombre: r.localidad, lat: 0, lon: 0, n: 0 };
    c.lat = (c.lat * c.n + r.lat) / (c.n + 1); c.lon = (c.lon * c.n + r.lon) / (c.n + 1); c.n += 1;
    DE_REGISTROS.set(k, c);
  }
  r._info = (r.horario ? 1 : 0) + (r.telefono ? 0.5 : 0) + (r.web || r.redes ? 0.5 : 0) + (r.descripcion ? 0.5 : 0) + (r._interes || 0);
}

/** Nombres con los que se puede mencionar una localidad en una frase: [clave normalizada, nombre]. */
export function clavesLocalidades() {
  const ambiguas = new Set(['centro', 'capital', 'la capital']);
  const out = new Map();
  for (const l of LOCALIDADES) for (const c of l.claves) if (c.length >= 4 && !ambiguas.has(c)) out.set(c, l.nombre);
  for (const [c, v] of DE_REGISTROS) if (c.length >= 5 && v.n >= 5 && !ambiguas.has(c) && !out.has(c)) out.set(c, v.nombre);
  return [...out.entries()].sort((a, b) => b[0].length - a[0].length);
}

export function resumen() {
  const por = {};
  for (const r of registros) por[r.categoria] = (por[r.categoria] || 0) + 1;
  return { origen, total: registros.length, con_horario: registros.filter((r) => r.horario).length, por_categoria: por };
}

// ---------- búsqueda ----------
const SINONIMOS = {
  parrilla: ['steak', 'grill', 'asado', 'bbq'], asado: ['steak', 'grill', 'parrilla'], argentina: ['argentinian'], pizzeria: ['pizza'], regional: ['regional', 'andin', 'local'],
  tipica: ['regional', 'andin'], tipico: ['regional', 'andin'], hamburguesa: ['burger'], hamburguesas: ['burger'], helado: ['ice cream', 'heladeria'],
  pastas: ['pasta', 'italian'], pollo: ['chicken'], vegetariano: ['vegetarian', 'vegan'], vegano: ['vegan'], cafeteria: ['cafe', 'coffee'],
  desayuno: ['cafe', 'coffee', 'panaderia', 'breakfast'], merienda: ['cafe', 'coffee', 'panaderia'], cerveza: ['bar pub', 'cerveceria', 'beer'],
  pena: ['pena', 'folklor'], empanadas: ['empanada', 'regional'], sandwich: ['sandwich', 'comida rapida'], plaza: ['parque plaza'],
  iglesia: ['iglesia capilla'], capilla: ['iglesia capilla'], cerro: ['cerro pico'], hostal: ['hostel', 'hosteria'], artesanias: ['artesania', 'craft'],
};
const VACIAS = new Set(['para', 'algo', 'donde', 'lugar', 'lugares', 'con', 'que', 'una', 'uno', 'los', 'las', 'del', 'por', 'cerca', 'comer', 'hacer']);

function centroDe({ localidad, lat, lon }) {
  if (localidad) {
    const l = resolverLocalidad(localidad);
    if (l) return { lat: l.lat, lon: l.lon, nombre: l.nombre };
  }
  if (typeof lat === 'number' && typeof lon === 'number') return { lat, lon, nombre: localidadMasCercana(lat, lon)?.nombre };
  return null;
}

const COCINAS = {
  argentinian: 'argentina', regional: 'regional', local: 'local', italian: 'italiana', 'ice cream': 'helados', 'coffee shop': 'cafetería', burger: 'hamburguesas',
  chicken: 'pollo', sandwich: 'sándwiches', 'steak house': 'parrilla', american: 'americana', spanish: 'española', arab: 'árabe', breakfast: 'desayunos',
  noodles: 'fideos', diner: 'minutas', chinese: 'china', mexican: 'mexicana', peruvian: 'peruana', bolivian: 'boliviana', fish: 'pescados', seafood: 'mariscos',
  vegetarian: 'vegetariana', vegan: 'vegana', barbecue: 'parrilla', grill: 'parrilla', tea: 'té', cake: 'tortas', empanada: 'empanadas', international: 'internacional',
  japanese: 'japonesa', sushi: 'sushi', pancake: 'panqueques', donut: 'donas', deli: 'fiambres', friture: 'frituras', dessert: 'postres', juice: 'jugos', salad: 'ensaladas',
};
const cocinaLegible = (c) => (c ? [...new Set(String(c).split(/[;,]/).map((x) => x.trim().replace(/_/g, ' ')).filter(Boolean).map((x) => COCINAS[x.toLowerCase()] || x))].join(', ') : undefined);

function compacto(r, mom, centro) {
  const est = estadoHorario(r.horario, mom);
  const o = {
    nombre: r.nombre, tipo: r.subcategoria, categoria: r.categoria, localidad: r.localidad, direccion: r.direccion,
    precio: r.rango_precio === 'sin_dato' ? undefined : r.rango_precio + (r.precio_origen === 'estimado' ? ' (estimado)' : ''),
    cocina: cocinaLegible(r.cocina), estrellas: r.estrellas, altitud_m: r.altitud_m, telefono: r.telefono, web: r.web || r.redes,
    horario: r.horario, abierto: est.abierto, cierra: est.cierra, abre: est.abre, descripcion: r.descripcion?.slice(0, 200),
    distancia_km: centro ? Math.round(km(centro.lat, centro.lon, r.lat, r.lon) * 10) / 10 : undefined,
    mapa: `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lon}`,
  };
  for (const k of Object.keys(o)) if (o[k] == null) delete o[k];
  return o;
}

const PUNTOS_ABIERTO = { si: 3, sin_dato: 0, no: -6 };

function filtrar(p, mom, centro, radio) {
  const tokens = sinAcentos(p.texto).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2 && !VACIAS.has(w));
  const cat = sinAcentos(p.categoria).replace(/ /g, '_');
  const sub = sinAcentos(p.subcategoria).replace(/ /g, '_');
  const reg = sinAcentos(p.region);
  const locTxt = !centro && p.localidad ? sinAcentos(p.localidad) : '';
  const tope = ORDEN_PRECIO.indexOf(p.precio_max);
  const res = [];
  for (const r of registros) {
    if (cat && r.categoria !== cat) continue;
    if (sub && r.subcategoria !== sub) continue;
    if (reg && sinAcentos(r.region) !== reg) continue;
    if (locTxt && !sinAcentos(`${r.localidad} ${r.departamento}`).includes(locTxt)) continue;
    if (tope >= 0 && (ORDEN_PRECIO.indexOf(r.rango_precio) < 0 || ORDEN_PRECIO.indexOf(r.rango_precio) > tope)) continue;
    if (tokens.length && !tokens.every((w) => r._txt.includes(w) || (SINONIMOS[w] || []).some((s) => r._txt.includes(s)))) continue;
    const d = centro ? km(centro.lat, centro.lon, r.lat, r.lon) : 0;
    if (centro && d > radio) continue;
    const ab = estadoHorario(r.horario, mom).abierto;
    if (p.solo_abiertos && ab !== 'si') continue;
    res.push({ r, d, ab, pts: PUNTOS_ABIERTO[ab] + r._info - d * 0.15 });
  }
  return res.sort((a, b) => b.pts - a.pts);
}

/** Búsqueda general en el directorio. */
export function buscar(p = {}) {
  const mom = momento(p);
  const centro = centroDe(p);
  const limite = Math.min(Math.max(parseInt(p.limite, 10) || 8, 1), 15);
  let radio = Number(p.radio_km) > 0 ? Number(p.radio_km) : 10;
  let res = filtrar(p, mom, centro, radio);
  if (centro && !p.radio_km && res.length < 3) { radio = 40; res = filtrar(p, mom, centro, radio); }
  const lista = res.slice(0, limite).map((x) => compacto(x.r, mom, centro));
  return {
    momento: mom.etiqueta, zona: centro ? `${centro.nombre} (radio ${radio} km)` : p.region || 'toda la provincia',
    total_encontrados: res.length, mostrados: lista.length,
    sin_horario_cargado: lista.filter((x) => x.abierto === 'sin_dato').length,
    aviso: !centro && p.localidad ? `No reconozco la localidad "${p.localidad}"; busqué por coincidencia de texto.` : undefined,
    resultados: lista,
  };
}

// ---------- plan rápido: "qué hago ahora y dónde como" ----------
const INTERES = {
  museo: 3, sitio_arqueologico: 3, atractivo_general: 3, mirador: 2.5, termas: 3, cascada: 2.5, salar_laguna: 3, area_protegida: 2, ruinas: 2,
  mercado_feria: 2, artesanias: 1.5, edificio_historico: 1.5, iglesia_capilla: 1.2, parque_plaza: 1, monumento: 0.8, centro_cultural: 1.5,
  parque_tematico: 2, cabalgata: 2, alquiler_bicicletas: 1.5, cueva: 2, volcan: 1.5, cerro_pico: 0.3, obra_de_arte: 0.3, regalos_souvenirs: 1,
  teatro: 2, cine: 1.5, casino: 1, boliche: 1.5, vinoteca_bodega: 1.5, cerveceria_artesanal: 2, parque_acuatico: 1.5, pileta: 1,
};
const SOLO_DE_DIA = new Set(['cerro_pico', 'volcan', 'mirador', 'cascada', 'cueva', 'salar_laguna', 'area_protegida', 'sitio_arqueologico', 'ruinas', 'cabalgata', 'alquiler_bicicletas', 'area_de_picnic', 'termas', 'parque_acuatico', 'pileta', 'mercado_feria']);
const DE_NOCHE = new Set(['boliche', 'casino', 'cine', 'teatro']);

export function planRapido(p = {}) {
  const mom = momento(p);
  const centro = centroDe(p);
  if (!centro) {
    return { momento: mom.etiqueta, falta: 'localidad', mensaje: 'Preguntale al usuario en qué localidad de Jujuy está (por ejemplo San Salvador de Jujuy, Tilcara, Purmamarca, Humahuaca).' };
  }
  const elegir = (acepta, peso, radio, n) => {
    const res = [];
    for (const r of registros) {
      if (!acepta(r)) continue;
      const d = km(centro.lat, centro.lon, r.lat, r.lon);
      if (d > radio) continue;
      const ab = estadoHorario(r.horario, mom).abierto;
      if (ab === 'no') continue;
      res.push({ r, pts: PUNTOS_ABIERTO[ab] + r._info + peso(r) - d * 0.25 });
    }
    return res.sort((a, b) => b.pts - a.pts).slice(0, n).map((x) => compacto(x.r, mom, centro));
  };
  const paraHacer = (radio) => elegir(
    (r) => INTERES[r.subcategoria] != null && (mom.es_de_noche ? !SOLO_DE_DIA.has(r.subcategoria) : !DE_NOCHE.has(r.subcategoria) || mom.minutos >= 17 * 60),
    (r) => INTERES[r.subcategoria] + (mom.es_de_noche && DE_NOCHE.has(r.subcategoria) ? 1.5 : 0), radio, 6);
  const m = mom.minutos;
  const pesoComida = (r) => {
    const s = r.subcategoria;
    if (m < 11 * 60 && m >= 6 * 60) return { cafe: 2, panaderia: 2 }[s] ?? 0; // desayuno
    if (m >= 16 * 60 && m < 19.5 * 60) return { cafe: 2, panaderia: 1.5, heladeria: 1.5 }[s] ?? 0.5; // merienda
    return { restaurante: 2, bar_pub: m >= 20 * 60 || m < 4 * 60 ? 1.5 : 0.5, comida_rapida: 1, patio_de_comidas: 1 }[s] ?? 0;
  };
  let radio = 8;
  let hacer = paraHacer(radio);
  let comer = elegir((r) => r.categoria === 'gastronomia', pesoComida, radio, 6);
  if (hacer.length < 3 || comer.length < 2) {
    radio = 30;
    if (hacer.length < 3) hacer = paraHacer(radio);
    if (comer.length < 2) comer = elegir((r) => r.categoria === 'gastronomia', pesoComida, radio, 6);
  }
  return {
    momento: mom.etiqueta, es_de_noche: mom.es_de_noche, zona: `${centro.nombre} (hasta ${radio} km, distancias en línea recta)`,
    nota: 'Se excluyeron los lugares que figuran cerrados a esa hora. "abierto: sin_dato" significa que no hay horario cargado: avisar y sugerir confirmar.'
      + (mom.es_de_noche ? ' Es de noche: se dejaron afuera cerros, miradores y salidas al aire libre alejadas.' : ''),
    para_hacer: hacer, para_comer: comer,
  };
}

/** One directory record by its stable id (used by the Pasaporte to join its stops with the directory). */
export function registroPorId(id) {
  return registros.find((r) => r.id === id) || null;
}
