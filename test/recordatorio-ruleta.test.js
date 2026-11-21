'use strict';
// Recordatorio de la ruleta (pedido del dueño, 21-nov-2026): a quien no compró,
// 5 horas después de que se le generó el código (al otro día si se generó desde
// las 20:00, y nunca de noche), un correo que le recuerda que su código vence y
// le mejora el premio: el descuento sube a 10% OFF y la correa o los tapones
// suman 10% OFF. Un segundo correo, el último aviso, unas 6 horas antes de que
// venza. Solo a quien no compró. Estos tests cuidan cuándo sale cada uno, qué
// premio queda (y que el cobro lo respete) y que nadie reciba de más.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ruleta = require('../services/ruleta');
const { calcularMonto, DESPUES } = require('../services/precio');
const { crearRecordatorios } = require('../services/recordatorios');
const email = require('../services/email');

const PRECIO = DESPUES.precio; // $68.990
const H = 60 * 60 * 1000;
// Noviembre: Chile en UTC-3. chile('2026-11-21 10:00') → instante en ms.
const chile = s => Date.parse(s.replace(' ', 'T') + ':00-03:00');
const horaChile = t => { const p = ruleta.partesChile(t); return `${p.d}/${p.mo} ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };

// Servicio en memoria con reloj propio y premio forzado.
function servicio(azarFijo, inicio = '2026-11-21 10:00') {
  const datos = {};
  let t = chile(inicio);
  let azar = azarFijo;
  const s = ruleta.crearServicio({
    load: async (k, f) => (k in datos ? JSON.parse(JSON.stringify(datos[k])) : f),
    save: async (k, v) => { datos[k] = JSON.parse(JSON.stringify(v)); },
    ahora: () => t,
    azar: () => azar,
  });
  return { s, datos, ahora: () => t, ir: ms => { t += ms; }, en: x => { t = chile(x); }, premio: r => { azar = r; } };
}
// Valores de azar que hacen salir cada premio (orden y pesos de PREMIOS).
const SALE = { d3000: 0.1, p5: 0.2225, correa: 0.3, p7: 0.5, d7000: 0.97, d10000: 0.99, tapones: 0.999 };

test('el 1º sale 5 horas después del código, al otro día si se generó desde las 20:00, y nunca de noche', () => {
  const caso = (generado, esperado) => assert.strictEqual(horaChile(ruleta.momentoRecordatorio(chile(generado))), esperado, generado);
  caso('2026-11-21 10:00', '21/11 15:00');
  caso('2026-11-21 16:30', '21/11 21:30');
  caso('2026-11-21 20:00', '22/11 10:00'); // pedido del dueño: desde las 20:00, al otro día
  caso('2026-11-21 23:40', '22/11 10:00');
  caso('2026-11-21 18:00', '22/11 10:00'); // 5 h después serían las 23:00
  caso('2026-11-21 01:30', '21/11 10:00'); // de madrugada: a las 10:00 de ese día
  caso('2026-11-21 04:00', '21/11 09:00');
});

test('el horario de los correos es de 9:00 a 22:00 de Chile', () => {
  assert.strictEqual(ruleta.enHorarioCorreos(chile('2026-11-21 08:59')), false);
  assert.strictEqual(ruleta.enHorarioCorreos(chile('2026-11-21 09:00')), true);
  assert.strictEqual(ruleta.enHorarioCorreos(chile('2026-11-21 21:59')), true);
  assert.strictEqual(ruleta.enHorarioCorreos(chile('2026-11-21 22:00')), false);
});

test('el 2º (último aviso) sale 6 horas antes de que venza, sin caer de noche ni con menos de 2 horas', () => {
  const caso = (vence, esperado) => assert.strictEqual(horaChile(ruleta.momentoUltimoRecordatorio(chile(vence))), esperado, vence);
  caso('2026-11-23 20:00', '23/11 14:00');
  caso('2026-11-23 14:00', '23/11 10:00'); // 6 h antes son las 8:00: a las 10:00, quedan 4 h
  caso('2026-11-23 11:00', '22/11 21:00'); // a las 10:00 quedaría 1 h: la noche anterior
  caso('2026-11-23 05:00', '22/11 21:00');
  caso('2026-11-23 03:00', '22/11 21:00');
});

test('cada premio mejora como pidió el dueño', async () => {
  const esperado = {
    p7: { id: 'p10', mejoradoDe: 'p7' },
    p5: { id: 'p10', mejoradoDe: 'p5' },
    d3000: { id: 'p10', mejoradoDe: 'd3000' },
    correa: { id: 'correa', pctExtra: 10 },
    tapones: { id: 'tapones', pctExtra: 10 },
    // Ya valen 10% o más: se quedan como están (subirlos a 10% sería bajarlos).
    d7000: { id: 'd7000' },
    d10000: { id: 'd10000' },
  };
  for (const [premio, e] of Object.entries(esperado)) {
    const x = servicio(SALE[premio]);
    const g = await x.s.girar('camila' + premio + '@gmail.com');
    assert.strictEqual(g.publico.premio.id, premio);
    x.ir(5 * H);
    const datos = await x.s.prepararRecordatorio(g.paraCorreo.codigo);
    const p = datos.codigos[0].premio;
    assert.strictEqual(p.id, e.id, premio);
    assert.strictEqual(p.mejoradoDe, e.mejoradoDe, premio);
    assert.strictEqual(p.pctExtra, e.pctExtra, premio);
    assert.strictEqual(datos.codigos[0].antes.id, premio);
    // El checkout ve lo mismo al revisar el código.
    const v = await x.s.validar(g.paraCorreo.codigo);
    assert.strictEqual(v.premio.id, e.id);
  }
});

test('el cobro respeta el premio mejorado: 10% OFF, y la correa con su 10% OFF', async () => {
  const x = servicio(SALE.p7);
  const g = await x.s.girar('ana@gmail.com');
  x.ir(5 * H);
  await x.s.prepararRecordatorio(g.paraCorreo.codigo);
  const p = await x.s.premioParaCobro(g.paraCorreo.codigo, null, { cliente: 'ana@gmail.com' });
  assert.deepStrictEqual({ id: p.id, pct: p.pct }, { id: 'p10', pct: 10 });
  assert.strictEqual(calcularMonto({ cantidad: 1, premio: p }).total, PRECIO - Math.ceil(PRECIO * 0.1));

  const y = servicio(SALE.correa);
  const gc = await y.s.girar('beto@gmail.com');
  y.ir(5 * H);
  await y.s.prepararRecordatorio(gc.paraCorreo.codigo);
  const pc = await y.s.premioParaCobro(gc.paraCorreo.codigo, 'gris', { cliente: 'beto@gmail.com' });
  assert.deepStrictEqual({ tipo: pc.tipo, color: pc.color, pctExtra: pc.pctExtra }, { tipo: 'correa', color: 'gris', pctExtra: 10 });
  const m = calcularMonto({ cantidad: 1, premio: pc });
  assert.strictEqual(m.correaPremio, 'gris', 'la correa sigue yendo en el paquete');
  assert.strictEqual(m.total, PRECIO - Math.ceil(PRECIO * 0.1));
});

test('quién está pendiente: hora cumplida, sin usar, sin vencer y una vez cada recordatorio', async () => {
  const x = servicio(SALE.p7);
  const g = await x.s.girar('caro@gmail.com');
  x.ir(5 * H - 60 * 1000);
  assert.deepStrictEqual(await x.s.pendientesRecordatorio(), [], 'todavía no son las 5 horas');
  x.ir(60 * 1000);
  const p1 = await x.s.pendientesRecordatorio();
  assert.deepStrictEqual(p1.map(p => [p.codigo, p.vez]), [[g.paraCorreo.codigo, 1]]);
  await x.s.prepararRecordatorio(g.paraCorreo.codigo, 1);
  await x.s.marcarRecordatorio(g.paraCorreo.codigo, 'enviado', 1);
  assert.deepStrictEqual(await x.s.pendientesRecordatorio(), [], 'el 1º no se repite');
  // Vence 48 h después del giro (21/11 10:00 → 23/11 10:00): el 2º, la noche anterior a las 21:00.
  x.en('2026-11-22 20:59');
  assert.deepStrictEqual(await x.s.pendientesRecordatorio(), []);
  x.en('2026-11-22 21:00');
  assert.deepStrictEqual((await x.s.pendientesRecordatorio()).map(p => p.vez), [2]);
  await x.s.marcarRecordatorio(g.paraCorreo.codigo, 'enviado', 2);
  assert.deepStrictEqual(await x.s.pendientesRecordatorio(), [], 'no hay un tercero');
  const fila = (await x.s.lista())[0];
  assert.ok(fila.recordatorio && fila.recordatorio2 && fila.mejorado);
  assert.strictEqual(fila.premio, '7% OFF → 10% OFF');
});

test('nadie que ya usó su código (o el otro del par), ni con el código vencido, recibe recordatorio', async () => {
  const x = servicio(SALE.p7);
  const g = await x.s.girar('dani@gmail.com');
  await x.s.marcarUsado(g.paraCorreo.codigo, 'orden-1');
  x.ir(6 * H);
  assert.deepStrictEqual(await x.s.pendientesRecordatorio(), []);

  const y = servicio(SALE.p7, '2026-11-21 10:00');
  await y.s.girar('eli@gmail.com');
  y.ir(49 * H); // venció sin recordatorio (p. ej. el servidor estuvo dormido)
  assert.deepStrictEqual(await y.s.pendientesRecordatorio(), []);
});

test('con segundo lanzamiento cuenta desde el correo con los dos códigos y mejora los dos', async () => {
  const x = servicio(SALE.p7);
  const g = await x.s.girar('fran@gmail.com');
  x.ir(2 * H);
  x.premio(0.7); // en el 2º lanzamiento (sin el 7%, pesos normalizados) sale la correa
  const o = await x.s.otroLanzamiento('fran@gmail.com', g.paraCorreo.codigo);
  assert.strictEqual(o.publico.premio.id, 'correa');
  x.ir(4 * H); // 6 h desde el 1º, 4 h desde el 2º: todavía no
  assert.deepStrictEqual(await x.s.pendientesRecordatorio(), []);
  x.ir(1 * H);
  const [p] = await x.s.pendientesRecordatorio();
  const datos = await x.s.prepararRecordatorio(p.codigo, p.vez);
  assert.deepStrictEqual(datos.codigos.map(c => c.premio.id), ['p10', 'correa']);
  assert.strictEqual(datos.codigos[1].premio.pctExtra, 10);
});

// El proceso automático, con un correo falso.
function proceso(x, opciones = {}) {
  const enviados = [];
  const r = crearRecordatorios({
    ruleta: x.s,
    ahora: x.ahora,
    esperar: async () => {},
    fuentes: async () => opciones.fuentes || {},
    enviar: async d => { enviados.push(d); return opciones.respuesta ? opciones.respuesta(d) : { ok: true, status: 200 }; },
  });
  return { r, enviados };
}

test('el proceso manda el recordatorio mejorado una vez, y el último aviso después', async () => {
  const x = servicio(SALE.p7);
  const g = await x.s.girar('gabi@gmail.com');
  x.ir(5 * H);
  const { r, enviados } = proceso(x);
  assert.strictEqual((await r.revisar()).enviados, 1);
  assert.strictEqual(enviados[0].vez, 1);
  assert.strictEqual(enviados[0].codigos[0].codigo, g.paraCorreo.codigo);
  assert.strictEqual(enviados[0].codigos[0].premio.id, 'p10');
  assert.strictEqual((await r.revisar()).enviados, 0, 'no se repite');
  x.en('2026-11-22 21:00');
  assert.strictEqual((await r.revisar()).enviados, 1);
  assert.strictEqual(enviados[1].vez, 2);
  assert.ok(enviados[1].horasQuedan >= 12 && enviados[1].horasQuedan <= 13);
});

test('a quien ya compró no se le escribe; a quien está pagando se le espera', async () => {
  const x = servicio(SALE.correa);
  await x.s.girar('hugo@gmail.com');
  await x.s.girar('ines@gmail.com');
  x.ir(5 * H);
  const ahora = x.ahora();
  const { r, enviados } = proceso(x, { fuentes: {
    correosCompradores: ['Hugo@gmail.com'],
    intentos: [{ email: 'ines@gmail.com', fecha: new Date(ahora - 10 * 60 * 1000).toISOString() }],
  } });
  assert.strictEqual((await r.revisar()).enviados, 0);
  assert.strictEqual(enviados.length, 0);
  const filas = await x.s.lista();
  assert.strictEqual(filas.find(f => f.email === 'hugo@gmail.com').recordatorioResultado, 'compro');
  assert.strictEqual(filas.find(f => f.email === 'ines@gmail.com').recordatorioResultado, null, 'se reintenta en la próxima vuelta');
});

test('fuera de horario no manda nada, y si se acaba la cuota de Resend sigue en la próxima vuelta', async () => {
  const x = servicio(SALE.p7, '2026-11-21 16:00'); // el 1º toca a las 21:00
  await x.s.girar('juan@gmail.com');
  x.en('2026-11-21 22:30');
  const a = proceso(x);
  assert.strictEqual((await a.r.revisar()).motivo, 'fuera de horario');
  assert.strictEqual(a.enviados.length, 0);
  x.en('2026-11-22 10:00');
  const b = proceso(x, { respuesta: () => ({ ok: false, status: 429, cuerpo: 'daily quota exceeded' }) });
  const rb = await b.r.revisar();
  assert.strictEqual(rb.enviados, 0);
  assert.match(rb.motivo, /límite/);
  assert.strictEqual((await x.s.lista())[0].recordatorioResultado, null, 'no se da por enviado');
  const c = proceso(x);
  assert.strictEqual((await c.r.revisar()).enviados, 1);
});

test('hay un tope de recordatorios por día, y primero salen los que vencen antes', async () => {
  const x = servicio(SALE.p7, '2026-11-21 09:00');
  await x.s.girar('uno@gmail.com');
  x.ir(1 * H);
  await x.s.girar('dos@gmail.com');
  x.ir(1 * H);
  await x.s.girar('tres@gmail.com');
  x.en('2026-11-21 16:00'); // los tres ya cumplieron sus 5 horas
  const enviados = [];
  const r = crearRecordatorios({ ruleta: x.s, ahora: x.ahora, esperar: async () => {}, fuentes: async () => ({}), maxDia: 2,
    enviar: async d => { enviados.push(d.email); return { ok: true, status: 200 }; } });
  const v = await r.revisar();
  assert.strictEqual(v.enviados, 2);
  assert.deepStrictEqual(enviados, ['uno@gmail.com', 'dos@gmail.com'], 'el que vence antes, primero');
  assert.match((await r.revisar()).motivo, /tope de 2/);
  x.en('2026-11-22 10:00'); // otro día: hay cupo de nuevo
  assert.strictEqual((await r.revisar()).enviados, 1);
  assert.deepStrictEqual(enviados.slice(2), ['tres@gmail.com']);
});

test('el correo dice qué pasa: vence, el premio mejorado, el código y cómo darse de baja', async () => {
  const x = servicio(SALE.p7);
  const g = await x.s.girar('karla@gmail.com');
  x.ir(5 * H);
  const d = await x.s.prepararRecordatorio(g.paraCorreo.codigo, 1);
  const asunto = email.asuntoRecordatorioRuleta(d.codigos, d.vez, d.horasQuedan);
  assert.match(asunto, /vence/);
  assert.match(asunto, /10% OFF/);
  const html = email.htmlRecordatorioRuleta(d);
  assert.ok(html.includes(g.paraCorreo.codigo));
  assert.ok(html.includes('de 7% OFF pasa a 10% OFF'));
  assert.ok(html.includes('?premio=' + encodeURIComponent(g.paraCorreo.codigo)));
  assert.ok(html.includes('BAJA'));
  assert.ok(html.includes('$62.091'), 'precio con el 10%');

  const y = servicio(SALE.correa);
  const gc = await y.s.girar('lalo@gmail.com');
  y.ir(5 * H);
  const dc = await y.s.prepararRecordatorio(gc.paraCorreo.codigo, 1);
  assert.match(email.asuntoRecordatorioRuleta(dc.codigos, 1), /correa extra.*10% OFF/i);
  assert.ok(email.htmlRecordatorioRuleta(dc).includes('a tu correa extra le sumamos un 10% de descuento'));

  const ultimo = { ...d, vez: 2, horasQuedan: 6 };
  assert.strictEqual(email.asuntoRecordatorioRuleta(ultimo.codigos, 2, 6), '⏰ Último aviso: tu código DEUS vence en 6 horas');
  assert.ok(email.htmlRecordatorioRuleta(ultimo).includes('Te quedan <b>6 horas</b>'));
});

test('el checkout de la tienda descuenta el 10% extra de la correa y muestra el premio de ahora', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const i = html.indexOf('function descuentoRuleta()');
  let prof = 0, fin = -1;
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') prof++;
    else if (html[k] === '}' && --prof === 0) { fin = k + 1; break; }
  }
  const ctx = vm.createContext({ checkoutTapones: false, checkoutQty: 1, precioBanda: () => PRECIO, premioRuleta: null });
  vm.runInContext(html.slice(i, fin), ctx);
  ctx.premioRuleta = { codigo: 'CORREA-AAAAAA', premio: { id: 'correa', tipo: 'correa', pctExtra: 10 }, color: 'negra' };
  assert.strictEqual(vm.runInContext('descuentoRuleta()', ctx), Math.ceil(PRECIO * 0.1));
  ctx.premioRuleta = { codigo: 'DEUS7-AAAAAA', premio: { id: 'p10', tipo: 'descuento', pct: 10, mejoradoDe: 'p7' } };
  assert.strictEqual(vm.runInContext('descuentoRuleta()', ctx), Math.ceil(PRECIO * 0.1));
  // Al abrir el checkout se toma el premio que dice el servidor (pudo mejorar).
  assert.ok(html.includes('premioRuleta.premio = d.premio;'));
});
