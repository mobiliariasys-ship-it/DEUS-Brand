'use strict';
// Panel: aviso de venta nueva como notificación del sistema (Windows/Mac).
// Corre las funciones REALES de admin.html con un Notification falso: al
// abrir el panel no avisa lo ya vendido, y después avisa una vez por cada
// subida del total de ventas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

function extraer(nombre) {
  const i = SRC.search(new RegExp('function\\s+' + nombre + '\\s*\\('));
  assert.ok(i >= 0, 'no encontré function ' + nombre + '() en admin.html');
  let prof = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') prof++;
    else if (SRC[k] === '}' && --prof === 0) return SRC.slice(i, k + 1);
  }
  throw new Error('llaves sin cerrar en ' + nombre);
}

function panel(permiso) {
  const avisos = [];
  function Notification(titulo, op) { avisos.push({ titulo, cuerpo: op.body, tag: op.tag }); }
  Notification.permission = permiso;
  const ctx = { avisos, window: { Notification }, Notification, String, Number };
  vm.createContext(ctx);
  vm.runInContext([
    "function money(n){ return '$'+(Number(n)||0).toLocaleString('es-CL'); }",
    'var avisoVentas = { visto: null };',
    extraer('ventasNuevas'), extraer('avisarVentas')
  ].join('\n'), ctx);
  return ctx;
}

const venta = (monto, extra) => Object.assign({ monto, metodo: 'MercadoPago', nombre: 'Camila Rojas', unidades: 1 }, extra);
const datos = (total, ultimas, hoy) => ({ ventas: { total: { count: total }, hoy: hoy || { count: 2, monto: 137980 }, ultimas } });

test('al abrir el panel no avisa lo ya vendido; después avisa cada venta nueva', () => {
  const p = panel('granted');
  p.avisarVentas(datos(304, [venta(68990)]));
  assert.strictEqual(p.avisos.length, 0, 'abrir el panel no es una venta nueva');
  p.avisarVentas(datos(304, [venta(68990)]));
  assert.strictEqual(p.avisos.length, 0, 'sin cambios no avisa');
  p.avisarVentas(datos(305, [venta(87980, { tapones: true })], { count: 3, monto: 225960 }));
  assert.strictEqual(p.avisos.length, 1);
  assert.match(p.avisos[0].titulo, /Nueva venta · \$87\.980/);
  assert.match(p.avisos[0].cuerpo, /1 banda \+ tapones · MercadoPago · Camila/);
  assert.match(p.avisos[0].cuerpo, /Hoy llevas 3 ventas · \$225\.960/);
  assert.ok(!/Rojas/.test(p.avisos[0].cuerpo), 'solo el primer nombre');
  assert.strictEqual(p.avisos[0].tag, 'deus-venta-305', 'dos pestañas no duplican el aviso');
});

test('si entran varias juntas, un solo aviso con la cantidad y el total', () => {
  const p = panel('granted');
  p.avisarVentas(datos(10, []));
  p.avisarVentas(datos(12, [venta(68990), venta(137980, { unidades: 2 })]));
  assert.strictEqual(p.avisos.length, 1);
  assert.match(p.avisos[0].titulo, /2 ventas nuevas · \$206\.970/);
});

test('sin permiso de notificaciones no intenta avisar, pero sigue llevando la cuenta', () => {
  const p = panel('default');
  p.avisarVentas(datos(10, []));
  p.avisarVentas(datos(11, [venta(68990)]));
  assert.strictEqual(p.avisos.length, 0);
  assert.strictEqual(p.avisoVentas.visto, 11);
});

test('el panel llama al aviso en cada actualización y tiene el botón para activarlo', () => {
  assert.match(SRC, /pintar\(d\);\s*avisarVentas\(d\);/);
  assert.match(SRC, /id="aviso-btn"[^>]*onclick="activarAvisoVentas\(\)"/);
});
