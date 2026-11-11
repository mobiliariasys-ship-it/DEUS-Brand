'use strict';
// Correo 11:11 (11-nov-2026): 10% OFF por 24 horas a quien dejó su correo en
// la web y no compró. Estos tests cuidan lo que no tiene vuelta atrás: que no
// le llegue a quien ya compró, que nadie lo reciba dos veces, que el código
// sirva solo con su correo y venza a las 24 h, y que el envío se detenga si
// Resend se queda sin cuota.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ruleta = require('../services/ruleta');
const promo = require('../services/promo');
const email = require('../services/email');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

function memoria() {
  const datos = {};
  return {
    datos,
    load: async (k, f) => (k in datos ? JSON.parse(JSON.stringify(datos[k])) : f),
    save: async (k, v) => { datos[k] = JSON.parse(JSON.stringify(v)); },
  };
}

test('audiencia: saca a los que compraron y junta el mismo correo escrito distinto', () => {
  const lista = promo.audiencia({
    personasRuleta: [
      { email: 'ana@gmail.com', fecha: '2026-11-05T10:00:00Z', estado: 'vencido', manual: false },
      { email: 'a.na+promo@gmail.com', fecha: '2026-11-09T10:00:00Z', estado: 'vigente', manual: false },
      { email: 'compro@gmail.com', fecha: '2026-11-08T10:00:00Z', estado: 'vigente', manual: false },
      { email: 'uso-codigo@gmail.com', fecha: '2026-11-08T10:00:00Z', estado: 'usado', manual: false },
      { email: 'regalo@gmail.com', fecha: '2026-11-08T10:00:00Z', estado: 'vigente', manual: true },
      { email: 'falso@mailinator.com', fecha: '2026-11-08T10:00:00Z', estado: 'vigente', manual: false },
    ],
    pedidos: [
      { status: 'pending', created_at: '2026-11-10T10:00:00Z', customer: { email: 'mp@hotmail.com' } },
      { status: 'approved', created_at: '2026-11-10T11:00:00Z', customer: { email: 'pago@hotmail.com' } },
      { status: 'pending', created_at: '2026-11-09T11:00:00Z', customer: { email: 'pago@hotmail.com' } },
    ],
    correosCompradores: ['Compro@Gmail.com'],
  });
  assert.deepStrictEqual(lista.map(p => p.clave), ['mp@hotmail.com', 'ana@gmail.com']);
  // Del mismo correo queda la vez más reciente, que es a donde se escribe.
  assert.strictEqual(lista[1].email, 'a.na+promo@gmail.com');
  assert.deepStrictEqual(lista[0].origenes, ['checkout']);
});

test('audiencia: el pago a medias de alguien que después compró con otro correo no entra', () => {
  const lista = promo.audiencia({
    pedidos: [
      // Pagó después con otro correo: su nombre está en las compras.
      { status: 'pending', created_at: '2026-11-10T10:00:00Z', customer: { name: 'María José  Pérez', email: 'mjp@hotmail.com' } },
      // Un nombre de una sola palabra no basta para sacarlo.
      { status: 'pending', created_at: '2026-11-10T10:00:00Z', customer: { name: 'Juan', email: 'juan@hotmail.com' } },
      // Anterior a los tickets de compra: no se sabe si compró, no entra.
      { status: 'pending', created_at: '2026-07-20T10:00:00Z', customer: { name: 'Luis Soto', email: 'luis@hotmail.com' } },
    ],
    nombresCompradores: ['maria jose perez', 'Juan'],
  });
  assert.deepStrictEqual(lista.map(p => p.clave), ['juan@hotmail.com']);
});

test('audiencia: quien ya recibió el correo no vuelve a aparecer', () => {
  const lista = promo.audiencia({
    personasRuleta: [{ email: 'ana@gmail.com', fecha: '2026-11-05T10:00:00Z', estado: 'vencido' }],
    yaEnviados: new Set(['ana@gmail.com']),
  });
  assert.strictEqual(lista.length, 0);
});

test('ruleta.generar acepta otra vigencia y marca la campaña', async () => {
  const m = memoria();
  const t0 = Date.parse('2026-11-11T17:00:00Z');
  const s = ruleta.crearServicio({ load: m.load, save: m.save, ahora: () => t0 });
  const c = await s.generar('p10', { email: 'ana@gmail.com', vigenciaMs: promo.VIGENCIA_MS, campana: '11.11' });
  assert.strictEqual(Date.parse(c.vence) - t0, 24 * 60 * 60 * 1000);
  assert.strictEqual(m.datos['ruleta.json'].codigos[c.codigo].campana, '11.11');
  // Sin opciones sigue durando 48 h.
  const d = await s.generar('p10');
  assert.strictEqual(Date.parse(d.vence) - t0, ruleta.VIGENCIA_MS);
});

test('el envío manda un código propio a cada uno, de 10%, 24 h y solo con su correo', async () => {
  const m = memoria();
  let t = Date.parse('2026-11-11T17:00:00Z');
  const r = ruleta.crearServicio({ load: m.load, save: m.save, ahora: () => t });
  const enviados = [];
  const c = promo.crearCampana({
    load: m.load, save: m.save, ruleta: r, ahora: () => t, esperar: async () => {},
    enviar: async d => { enviados.push(d); return { ok: true, status: 200 }; },
  });
  const fuentes = { personasRuleta: [
    { email: 'ana@gmail.com', fecha: '2026-11-05T10:00:00Z', estado: 'vencido' },
    { email: 'beto@gmail.com', fecha: '2026-11-06T10:00:00Z', estado: 'vencido' },
  ] };
  assert.strictEqual((await c.vistaPrevia(fuentes)).total, 2);
  await c.iniciar(fuentes);
  await c.terminado();
  const e = await c.estado();
  assert.strictEqual(e.estado, 'listo');
  assert.strictEqual(e.enviados, 2);
  assert.notStrictEqual(enviados[0].codigo, enviados[1].codigo);

  const premio = await r.premioParaCobro(enviados[0].codigo, null, { cliente: enviados[0].email });
  assert.strictEqual(premio.pct, 10);
  await assert.rejects(r.premioParaCobro(enviados[1].codigo, null, { cliente: 'otra@gmail.com' }));
  t += 24 * 60 * 60 * 1000 + 1;
  await assert.rejects(r.premioParaCobro(enviados[1].codigo, null, { cliente: enviados[1].email }));

  // Nadie lo recibe dos veces, aunque se vuelva a apretar Enviar.
  assert.strictEqual((await c.vistaPrevia(fuentes)).total, 0);
  await c.iniciar(fuentes);
  await c.terminado();
  assert.strictEqual(enviados.length, 2);
});

test('el envío respeta el máximo y se detiene si Resend se queda sin cuota', async () => {
  const m = memoria();
  const r = ruleta.crearServicio({ load: m.load, save: m.save });
  let n = 0;
  const c = promo.crearCampana({
    load: m.load, save: m.save, ruleta: r, esperar: async () => {},
    enviar: async () => (++n <= 2 ? { ok: true, status: 200 } : { ok: false, status: 429, cuerpo: '{"name":"daily_quota_exceeded"}' }),
  });
  const personasRuleta = ['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => ({ email: x + '@gmail.com', fecha: '2026-11-0' + (i + 1) + 'T10:00:00Z', estado: 'vencido' }));
  await c.iniciar({ personasRuleta }, { maximo: 5 });
  await c.terminado();
  const e = await c.estado();
  assert.strictEqual(e.totalEnvio, 5);
  assert.strictEqual(e.estado, 'detenido');
  assert.strictEqual(e.enviados, 2);
  assert.match(e.motivo, /límite/);
  // Los que faltaron siguen pendientes para un segundo envío.
  assert.strictEqual((await c.vistaPrevia({ personasRuleta })).total, 4);
});

test('el correo: varita en el asunto, aviso, 24 horas, precio con 10% y cómo darse de baja', () => {
  assert.match(email.ASUNTO_1111, /^🪄/);
  assert.match(email.ASUNTO_1111, /10%/);
  const html = email.html1111({ codigo: 'DEUS10-ABC234', vence: '2026-11-12T17:00:00Z' });
  assert.match(html, /DEUS10-ABC234/);
  assert.match(html, /\?premio=DEUS10-ABC234/);
  assert.match(html, /⚠️/);
  assert.match(html, /¿Estabas buscando una DEUS Band\?/);
  assert.match(html, /11:11/);
  assert.match(html, /24 horas/);
  assert.match(html, /\$62\.091/); // $68.990 − 10% (redondeado igual que el cobro)
  assert.match(html, /BAJA/);
  assert.match(html, /jueves 12 de noviembre a las 14:00/);
});

test('el panel tiene el envío 11:11 con confirmación y el servidor lo protege con la clave', () => {
  const admin = leer('admin.html');
  assert.match(admin, /id="promo-1111"/);
  assert.match(admin, /confirm\('¿Enviar el correo 11:11/);
  const server = leer('server.js');
  for (const ruta of ["app.get('/admin/promo-1111'", "app.post('/admin/promo-1111/enviar'"]) {
    const i = server.indexOf(ruta);
    assert.ok(i > 0, ruta);
    assert.match(server.slice(i, i + 400), /Clave incorrecta/);
  }
});
