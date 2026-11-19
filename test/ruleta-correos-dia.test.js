'use strict';
// Gráfico "Correos nuevos por día" del panel (pedido del dueño, 19-nov-2026):
// cuánta gente deja su correo en la ruleta cada día. Sale de la lista que ya
// trae /admin/ruleta, así que lo que se cuida acá es la cuenta: día de Chile
// (no UTC), cada correo una sola vez aunque vuelva a girar, y sin los códigos
// que el dueño genera a mano.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const extraer = nombre => {
  const i = HTML.search(new RegExp('function\\s+' + nombre + '\\s*\\('));
  assert.ok(i >= 0, 'falta ' + nombre);
  let prof = 0;
  for (let k = HTML.indexOf('{', i); k < HTML.length; k++) {
    if (HTML[k] === '{') prof++;
    else if (HTML[k] === '}' && --prof === 0) return HTML.slice(i, k + 1);
  }
};
const ctx = vm.createContext({});
vm.runInContext(extraer('correosPorDia'), ctx);
const correosPorDia = (personas, dias, hoy) =>
  JSON.parse(JSON.stringify(vm.runInContext('correosPorDia', ctx)(personas, dias, hoy)));

test('30 barras, una por día, terminando hoy', () => {
  const d = correosPorDia([], 30, '2026-11-19');
  assert.strictEqual(d.length, 30);
  assert.strictEqual(d[0].fecha, '2026-10-21');
  assert.strictEqual(d[29].fecha, '2026-11-19');
  assert.ok(d.every(x => x.valor === 0));
});

test('cuenta personas nuevas por día de Chile, una vez cada correo', () => {
  const personas = [
    // 23:30 del 18 en Chile (UTC-3 en noviembre): va al 18, no al 19.
    { fecha: '2026-11-19T02:30:00.000Z', email: 'ana@gmail.com' },
    { fecha: '2026-11-19T15:00:00.000Z', email: 'beto@hotmail.com' },
    // Ana vuelve a girar hoy: ya se contó el día que dejó su correo.
    { fecha: '2026-11-19T18:00:00.000Z', email: 'ANA@gmail.com' },
    { fecha: '2026-11-19T19:00:00.000Z', email: 'caro@gmail.com' },
    // Código generado a mano por el dueño: no es alguien que dejó su correo.
    { fecha: '2026-11-19T20:00:00.000Z', email: 'cliente@gmail.com', manual: true },
    // Dejó su correo hace más de 30 días y volvió a girar hoy: no es nuevo.
    { fecha: '2026-10-01T15:00:00.000Z', email: 'vieja@gmail.com' },
    { fecha: '2026-11-19T21:00:00.000Z', email: 'vieja@gmail.com' },
  ];
  const d = correosPorDia(personas, 30, '2026-11-19');
  const por = Object.fromEntries(d.filter(x => x.valor).map(x => [x.fecha, x.valor]));
  assert.deepStrictEqual(por, { '2026-11-18': 1, '2026-11-19': 2 });
});

test('el panel lo dibuja en la sección de la ruleta con el total de hoy y de 30 días', () => {
  const sec = HTML.slice(HTML.indexOf('<section id="sec-ruleta">'), HTML.indexOf('id="t-ru-premios"'));
  assert.ok(sec.includes('<canvas id="chartCorreos"'), 'el gráfico va en la sección de la ruleta');
  assert.ok(sec.includes('id="ru-dia-total"'));
  const pintar = extraer('pintarRuleta');
  assert.ok(pintar.includes("dibujarBarras('chartCorreos', dia, COLOR_BARRAS)"));
  assert.ok(pintar.includes('correosPorDia(pers, 30)'), 'usa la lista sin los códigos generados a mano');
});
