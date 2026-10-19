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

function panel(permiso, sonidoListo) {
  const avisos = [];
  function Notification(titulo, op) { avisos.push({ titulo, cuerpo: op.body, tag: op.tag, silent: op.silent }); }
  Notification.permission = permiso;
  const ctx = { avisos, window: { Notification }, Notification, String, Number, sonidoListo: !!sonidoListo };
  vm.createContext(ctx);
  vm.runInContext([
    "function money(n){ return '$'+(Number(n)||0).toLocaleString('es-CL'); }",
    'var avisoVentas = { visto: null, sonado: 0, push: false, reg: null };',
    'var audioVenta = sonidoListo ? { state: "running" } : null; var sonidos = 0;',
    'function sonarVenta(){ sonidos++; }',
    extraer('ventasNuevas'), extraer('avisarVentas'), extraer('ventaPorPush')
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

test('suena el ka-ching con cada venta nueva (no al abrir) y la notificación va en silencio', () => {
  const p = panel('granted', true);
  p.avisarVentas(datos(50, []));
  assert.strictEqual(p.sonidos, 0, 'abrir el panel no suena');
  p.avisarVentas(datos(51, [venta(68990)]));
  assert.strictEqual(p.sonidos, 1);
  assert.strictEqual(p.avisos[0].silent, true, 'sin doble sonido');
});

test('si el audio no está habilitado, no intenta sonar y deja el sonido de Windows', () => {
  const p = panel('granted', false);
  p.avisarVentas(datos(50, []));
  p.avisarVentas(datos(51, [venta(68990)]));
  assert.strictEqual(p.sonidos, 0);
  assert.strictEqual(p.avisos[0].silent, false);
});

test('el botón del aviso hace sonar la venta al tocarlo', () => {
  const f = SRC.slice(SRC.indexOf('function activarAvisoVentas'));
  assert.match(f.slice(0, 200), /sonarVenta\(\)/);
});

test('venta que llega por push con el panel abierto: suena una vez y el panel no la repite', () => {
  const p = panel('granted', true);
  p.avisarVentas(datos(60, []));
  p.ventaPorPush({ tipo: 'venta', total: 61, title: 't', body: 'b', tag: 'deus-venta-61' });
  assert.strictEqual(p.sonidos, 1, 'suena el ka-ching');
  p.ventaPorPush({ tipo: 'venta', total: 61, title: 't', body: 'b', tag: 'deus-venta-61' });
  assert.strictEqual(p.sonidos, 1, 'el mismo aviso repetido no vuelve a sonar');
  p.avisarVentas(datos(61, [venta(68990)]));
  assert.strictEqual(p.avisos.length, 0, 'al refrescar, el panel no repite el aviso que ya llegó por push');
  assert.strictEqual(p.sonidos, 1);
});

test('venta por push con el audio del panel sin habilitar: repite el aviso con el sonido de Windows', () => {
  const p = panel('granted', false);
  const mostradas = [];
  p.avisoVentas.reg = { showNotification: (t, o) => { mostradas.push({ t, ...o }); return Promise.resolve(); } };
  p.avisarVentas(datos(60, []));
  p.ventaPorPush({ tipo: 'venta', total: 61, title: '💰 Nueva venta · $68.990', body: 'b', tag: 'deus-venta-61' });
  assert.strictEqual(p.sonidos, 0);
  assert.strictEqual(mostradas.length, 1);
  assert.strictEqual(mostradas[0].silent, false);
  assert.strictEqual(mostradas[0].renotify, true);
  assert.strictEqual(mostradas[0].tag, 'deus-venta-61');
});
