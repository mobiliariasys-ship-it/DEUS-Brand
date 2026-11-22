'use strict';
// El recuadro del total del checkout ("Total a pagar" + las 3 cuotas) ya no
// repite "Envío gratis" al lado de la cuota: el envío gratis se dice arriba,
// junto al precio y en el recuadro verde del envío (pedido del dueño,
// 22-nov-2026: "queda redundante"). Solo avisa si el envío vuelve a costar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ini = html.indexOf('const envTxt = faltaEnv');
const envTxt = html.slice(ini, html.indexOf(';\n', ini) + 1); // hasta el fin de la sentencia (el style lleva ';')

test('el recuadro del total no repite el envío gratis', () => {
  assert.ok(ini > 0, 'falta envTxt en actualizarTotalCheckout');
  assert.ok(!/env[ií]o gratis/i.test(envTxt), 'junto a las cuotas no va "Envío gratis": ' + envTxt);
});

test('si el envío vuelve a costar, el recuadro lo sigue avisando', () => {
  assert.ok(envTxt.includes('+ envío, se calcula abajo'));
});

test('el envío gratis se sigue diciendo arriba en el checkout', () => {
  assert.ok(html.includes('<b>Envío GRATIS a todo Chile</b>'), 'el recuadro verde del envío sigue');
});
