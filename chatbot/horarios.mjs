// Horarios: hora local de Jujuy y evaluación del formato opening_hours de OSM
// (subconjunto práctico: días, rangos horarios, "off", "24/7", cruces de medianoche).
// Lo que no se entiende devuelve null => "sin_dato", nunca un "abierto" inventado.

const COD = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const NOMBRES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const UTC_OFFSET_MIN = -180; // America/Argentina/Jujuy: UTC-3 fijo, sin horario de verano

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const hhmm = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Momento de referencia. hora: "HH:MM" | "HH" | "18hs"; dia: "hoy" | "mañana" | nombre de día. */
export function momento({ hora, dia } = {}, ahoraMs = Date.now()) {
  const local = new Date(ahoraMs + UTC_OFFSET_MIN * 60000); // se lee con getUTC*
  let minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
  let horaDada = false;
  const h = String(hora ?? '').match(/(\d{1,2})(?:[:.h](\d{2}))?/);
  if (h && +h[1] <= 24 && +(h[2] ?? 0) < 60) {
    let hh = +h[1] % 24;
    if (/pm|tarde|noche/i.test(hora) && hh < 12) hh += 12;
    minutos = hh * 60 + +(h[2] ?? 0);
    horaDada = true;
  }
  let sumar = 0;
  const d = sinAcentos(dia);
  if (d === 'manana') sumar = 1;
  else if (d === 'pasado manana') sumar = 2;
  else {
    const idx = NOMBRES.findIndex((n) => sinAcentos(n) === d);
    if (idx >= 0) sumar = (idx - local.getUTCDay() + 7) % 7;
  }
  const f = new Date(local.getTime() + sumar * 86400000);
  const diaIdx = f.getUTCDay();
  return {
    dia: diaIdx,
    minutos,
    hora: hhmm(minutos),
    hora_asumida: !horaDada && sumar > 0, // se pidió otro día sin decir a qué hora
    etiqueta: `${NOMBRES[diaIdx]} ${f.getUTCDate()}/${f.getUTCMonth() + 1}/${f.getUTCFullYear()}, ${hhmm(minutos)} hs`,
    es_de_noche: minutos >= 20 * 60 || minutos < 7 * 60,
  };
}

function expandir(sel) {
  if (sel.startsWith('PH')) return [];
  const [a, b] = sel.split('-').map((x) => COD.indexOf(x.trim()));
  if (b === undefined) return [a];
  const out = [];
  for (let i = a; ; i = (i + 1) % 7) { out.push(i); if (i === b) break; }
  return out;
}

const cache = new Map();

/** Devuelve un array de 7 listas de rangos [ini, fin] en minutos, o null si no se puede interpretar. */
export function parseHorario(txt) {
  if (!txt) return null;
  if (cache.has(txt)) return cache.get(txt);
  const r = parsear(txt);
  cache.set(txt, r);
  return r;
}

function parsear(txt) {
  const s = txt.replace(/"[^"]*"/g, '').trim();
  if (/^24\/7$/.test(s)) return COD.map(() => [[0, 1440]]);
  // meses, "sunrise", semanas, etc.: fuera del subconjunto
  if (/[a-z]{3,}/i.test(s.replace(/\b(off|closed|open)\b/gi, ''))) return null;
  const dias = COD.map(() => null);
  let algo = false;
  const agregar = (d, ini, fin) => { (dias[d] ??= []).push([ini, fin]); algo = true; };
  for (const regla of s.split(';')) {
    let actuales = null;
    let cerrado = true; // el selector de días anterior ya recibió horas
    for (let parte of regla.split(',')) {
      parte = parte.replace(/\bopen\b/i, '').trim();
      if (!parte) continue;
      let resto = parte;
      const m = parte.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)\s*:?\s*(.*)$/);
      if (m) {
        const ds = expandir(m[1].replace(/\s/g, ''));
        actuales = cerrado || !actuales ? ds : actuales.concat(ds);
        cerrado = false;
        resto = m[2].trim();
      }
      if (!resto) continue;
      const objetivo = actuales ?? [0, 1, 2, 3, 4, 5, 6];
      if (/^(off|closed)$/i.test(resto)) { objetivo.forEach((d) => { dias[d] = []; }); algo = true; cerrado = true; continue; }
      const t = resto.match(/^(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})\+?$/);
      if (!t) return null;
      const ini = +t[1] * 60 + +t[2];
      let fin = +t[3] * 60 + +t[4];
      if (fin === 0) fin = 1440;
      for (const d of objetivo) {
        if (fin > ini && fin <= 1440) agregar(d, ini, fin);
        else { // cruza la medianoche
          agregar(d, ini, 1440);
          const resto2 = fin > 1440 ? fin - 1440 : fin;
          if (resto2 > 0) agregar((d + 1) % 7, 0, resto2);
        }
      }
      cerrado = true;
    }
    if (actuales && !cerrado) actuales.forEach((d) => agregar(d, 0, 1440)); // "Mo-Sa" sin horas
  }
  return algo ? dias.map((d) => d ?? []) : null;
}

/** Estado de un horario en un momento: { abierto: 'si'|'no'|'sin_dato', cierra?, abre? } */
export function estadoHorario(txt, mom) {
  const sem = parseHorario(txt);
  if (!sem) return { abierto: 'sin_dato' };
  const hoy = sem[mom.dia];
  const actual = hoy.find(([a, b]) => mom.minutos >= a && mom.minutos < b);
  if (actual) {
    let fin = actual[1];
    if (fin === 1440) { // puede seguir pasada la medianoche
      const sig = sem[(mom.dia + 1) % 7].find(([a]) => a === 0);
      if (sig && sig[1] < 1440) fin = sig[1];
      else if (sig) return { abierto: 'si', cierra: 'no cierra' };
    }
    return { abierto: 'si', cierra: hhmm(fin) };
  }
  const prox = hoy.filter(([a]) => a > mom.minutos).sort((x, y) => x[0] - y[0])[0];
  return prox ? { abierto: 'no', abre: hhmm(prox[0]) } : { abierto: 'no' };
}

export { sinAcentos, NOMBRES };
