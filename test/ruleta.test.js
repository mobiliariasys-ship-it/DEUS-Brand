'use strict';
// Ruleta "Gira y gana" (desde el 4-nov-2026, en lugar de la pestaña del
// sorteo): a los 11 segundos aparece, la persona deja su correo, gira (máximo
// 3 segundos) y le llega un código de 48 horas. El premio lo decide el
// servidor y lo que se cobra lo calcula calcularMonto(): el navegador solo
// manda el código. Estos tests cuidan las tres cosas que tocan plata: las
// probabilidades que eligió el dueño, que un código sirva UNA vez y antes de
// vencer, y que las tres pasarelas cobren igual con el premio.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const ruleta = require('../services/ruleta');
const { calcularMonto, nombreProducto, llevaRegaloTapones, DESPUES } = require('../services/precio');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const HTML = leer('index.html');
const PRECIO = DESPUES.precio; // $68.990

// Almacenamiento en memoria y reloj controlable para el servicio.
function servicio(opciones = {}) {
  const datos = {};
  let t = Date.parse('2026-11-04T12:00:00Z');
  const s = ruleta.crearServicio({
    load: async (k, f) => (k in datos ? JSON.parse(JSON.stringify(datos[k])) : f),
    save: async (k, v) => { datos[k] = JSON.parse(JSON.stringify(v)); },
    ahora: () => t,
    azar: opciones.azar,
  });
  return { s, datos, avanzar: ms => { t += ms; } };
}

test('las probabilidades son las que eligió el dueño y suman 100%', () => {
  const p = Object.fromEntries(ruleta.PREMIOS.map(x => [x.id, x.prob]));
  assert.deepStrictEqual(p, { d3000: 0.592, p5: 0.20, correa: 0.15, p7: 0.03, tapones: 0.02, p10: 0.008 });
  const suma = ruleta.PREMIOS.reduce((s, x) => s + x.prob, 0);
  assert.ok(Math.abs(suma - 1) < 1e-9, 'suman ' + suma);
});

test('ningún premio que se ve en la ruleta tiene 0% (SERNAC: publicidad engañosa)', () => {
  for (const p of ruleta.PREMIOS) assert.ok(p.prob > 0, p.etiqueta + ' nunca saldría');
});

test('el sorteo reparte exactamente según las probabilidades', () => {
  const N = 100000, cuenta = {};
  for (let i = 0; i < N; i++) {
    const p = ruleta.sortear(i / N);
    cuenta[p.id] = (cuenta[p.id] || 0) + 1;
  }
  for (const p of ruleta.PREMIOS) {
    assert.ok(Math.abs(cuenta[p.id] / N - p.prob) < 0.0001, p.id + ': ' + cuenta[p.id] / N);
  }
  assert.strictEqual(ruleta.sortear(0).id, 'd3000');
  assert.strictEqual(ruleta.sortear(0.9999999).id, 'p10');
});

test('los gajos de la página son los mismos premios del servidor', () => {
  // Si un premio se agrega en services/ruleta.js y no en la ruleta de la
  // página (o al revés), la ruleta se detendría en un gajo equivocado.
  const ids = [...HTML.matchAll(/\{ id: '([a-z0-9]+)',\s+a: '/g)].map(m => m[1]);
  assert.deepStrictEqual([...ids].sort(), ruleta.PREMIOS.map(p => p.id).sort());
});

test('aparece a los 11 segundos y el giro dura máximo 3 segundos', () => {
  assert.match(HTML, /var SEGUNDOS = 11;/);
  assert.match(HTML, /var GIRO_MAX_MS = 3000;/);
  // El giro se planifica para terminar ANTES de los 3 s (deja 300 ms de margen
  // para lo que tarda el celular en dibujar cada cuadro).
  assert.ok(HTML.includes('GIRO_MAX_MS / 1000 - .3'));
});

test('la pestaña del sorteo ahora abre la ruleta', () => {
  assert.ok(HTML.includes('id="ruleta-tab" onclick="abrirRuleta()"'));
  assert.ok(!HTML.includes('onclick="abrirRifa()" role="button"'), 'quedó la pestaña del sorteo');
  // La ventana del sorteo sigue: noviembre se sortea igual con quienes ya participan.
  assert.ok(HTML.includes('id="rifaOverlay"'));
});

test('un giro por persona: el mismo correo (con puntos o +etiqueta en Gmail) recibe el mismo premio', async () => {
  const { s } = servicio();
  const a = await s.girar('camila.rojas@gmail.com');
  assert.strictEqual(a.yaGiro, false);
  assert.strictEqual(a.reenviar, true, 'el primer giro manda el correo');
  assert.match(a.publico.codigo, /^(DEUS3K|DEUS5|DEUS7|DEUS10|CORREA|TAPONES)-[A-HJ-NP-Z2-9]{6}$/);
  assert.strictEqual(a.paraCorreo.email, 'camila.rojas@gmail.com', 'el correo va escrito como lo dejó');
  for (const variante of ['  Camila.Rojas@Gmail.com ', 'camilarojas@gmail.com', 'c.a.m.i.l.a.rojas+ofertas@googlemail.com']) {
    const b = await s.girar(variante);
    assert.strictEqual(b.yaGiro, true, variante + ' giró de nuevo');
    assert.strictEqual(b.paraCorreo.codigo, a.publico.codigo);
  }
  const c = await s.girar('otra@gmail.com');
  assert.notStrictEqual(c.publico.codigo, a.publico.codigo);
  assert.ok(!('email' in a.publico), 'el navegador no necesita ver el correo guardado');
});

test('si alguien escribe un correo que ya giró, NO ve el código: se le reenvía al dueño', async () => {
  const { s, avanzar } = servicio();
  await s.girar('camila@gmail.com');
  const otro = await s.girar('camila@gmail.com');
  assert.strictEqual(otro.publico.yaGiro, true);
  assert.ok(!('codigo' in otro.publico), 'mostró el código de otra persona');
  assert.ok(!('color' in otro.publico));
  assert.ok(otro.publico.premio && otro.publico.premio.id, 'igual se puede mostrar qué ganó');
  assert.strictEqual(otro.reenviar, false, 'no se reenvía en ráfaga (máx. 1 cada 10 min)');
  avanzar(11 * 60 * 1000);
  assert.strictEqual((await s.girar('camila@gmail.com')).reenviar, true);
});

test('los correos temporales y los mal escritos no pueden girar', async () => {
  const { s } = servicio();
  await assert.rejects(() => s.girar('alguien@mailinator.com'), e => e.codigoError === 'desechable');
  await assert.rejects(() => s.girar('alguien@yopmail.com'), e => e.codigoError === 'desechable');
  for (const malo of ['', 'sin-arroba', 'a@b', '<script>@x.com', 'x'.repeat(300) + '@gmail.com', '+@gmail.com']) {
    await assert.rejects(() => s.girar(malo), e => e.codigoError === 'formato', JSON.stringify(malo).slice(0, 40));
  }
});

test('los códigos no se pueden adivinar ni romper con textos raros', async () => {
  const { s } = servicio();
  const codigos = new Set();
  for (let i = 0; i < 300; i++) codigos.add((await s.girar('p' + i + '@gmail.com')).publico.codigo);
  assert.strictEqual(codigos.size, 300, 'se repitió un código');
  for (const raro of ['__proto__', 'constructor', 'toString', 'DEUS3K-', '../../etc', 'a'.repeat(500), '<img src=x>']) {
    const v = await s.validar(raro);
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.error, 'no-existe', raro.slice(0, 20));
  }
});

test('el código dura 48 horas y sirve una sola vez', async () => {
  const { s, avanzar } = servicio();
  const { codigo } = (await s.girar('a@gmail.com')).publico;
  assert.strictEqual((await s.validar(codigo.toLowerCase())).ok, true, 'se acepta en minúscula');
  assert.strictEqual((await s.validar('DEUS5-XXXX')).error, 'no-existe');
  avanzar(48 * 3600 * 1000 - 1000);
  assert.strictEqual((await s.validar(codigo)).ok, true, 'a 1 segundo de vencer todavía sirve');
  assert.strictEqual(await s.marcarUsado(codigo, 'orden-1'), true);
  assert.strictEqual(await s.marcarUsado(codigo, 'orden-2'), false, 'un reaviso no pisa la primera orden');
  assert.strictEqual((await s.validar(codigo)).error, 'usado');
  const { s: s2, avanzar: av2 } = servicio();
  const otro = (await s2.girar('b@gmail.com')).publico;
  av2(48 * 3600 * 1000 + 1000);
  assert.strictEqual((await s2.validar(otro.codigo)).error, 'vencido');
});

test('un solo código por correo: solo lo usa el correo que lo ganó, una vez', async () => {
  const { s } = servicio();
  const { codigo } = (await s.girar('dueno.real@gmail.com')).publico;
  // Otro correo (aunque tenga el código) no lo puede usar: se le dice qué correo usar, enmascarado.
  await assert.rejects(() => s.premioParaCobro(codigo, '', { cliente: 'otro@gmail.com' }),
    e => e.codigoError === 'otro-correo' && e.campo === 'email' && e.message.includes('du•••@gmail.com') && !e.message.includes('dueno.real'));
  await assert.rejects(() => s.premioParaCobro(codigo, '', {}), e => e.codigoError === 'otro-correo', 'sin correo tampoco');
  // El dueño sí, escriba su correo como lo escriba (Gmail ignora puntos, +etiqueta y mayúsculas).
  assert.ok(await s.premioParaCobro(codigo, '', { cliente: 'dueno.real@gmail.com' }));
  assert.ok(await s.premioParaCobro(codigo, '', { cliente: 'D.U.E.N.O.Real+tienda@Gmail.com' }), 'el mismo correo escrito distinto');
  await s.marcarUsado(codigo, 'orden-9');
  await assert.rejects(() => s.premioParaCobro(codigo, '', { cliente: 'dueno.real@gmail.com' }), e => e.codigoError === 'usado');
});

test('una compra lleva UN solo código: dos juntos no pasan', async () => {
  const { s } = servicio();
  const a = (await s.girar('uno@gmail.com')).publico.codigo;
  const otra = await s.girar('uno+dos@gmail.com');
  assert.strictEqual(otra.yaGiro, true);
  assert.strictEqual(otra.paraCorreo.codigo, a, 'el mismo correo no tiene un segundo código');
  const c = (await s.girar('otra.persona@gmail.com')).publico.codigo;
  for (const varios of [[a, c], a + ',' + c, a + ' ' + c, a + ';' + c, { codigo: a }, 12345]) {
    await assert.rejects(() => s.premioParaCobro(varios, '', { cliente: 'uno@gmail.com' }),
      e => e.codigoError === 'uno-solo' && e.message === 'Solo se puede usar un código por compra.', JSON.stringify(varios));
  }
  assert.ok(HTML.includes("msg.textContent = 'Solo se puede usar un código por compra.';"), 'el checkout tampoco deja pegar dos');
  // El checkout manda un solo código (un string), nunca una lista.
  assert.ok(HTML.includes("codigoPremio: (!checkoutTapones && premioRuleta) ? premioRuleta.codigo : ''"));
  assert.ok(HTML.includes("k.textContent = 'Código · uno por compra';"));
});

test('desde la ruleta, el checkout trae escrito el correo con el que giró', () => {
  assert.ok(HTML.includes('if (em && !em.value && e.email) {'));
  assert.ok(HTML.includes('em.value = e.email;'));
});

test('premioParaCobro: sin código nada; con uno malo, un mensaje para el cliente', async () => {
  const { s } = servicio();
  assert.strictEqual(await s.premioParaCobro('', ''), null);
  assert.strictEqual(await s.premioParaCobro(null), null);
  await assert.rejects(() => s.premioParaCobro('NOEXISTE-1234'), /no existe/);
});

test('la correa: color elegido de base, negra si nunca eligió, y se puede cambiar al pagar', async () => {
  // azar 0.80 → correa (0.792 a 0.942)
  const { s } = servicio({ azar: () => 0.80 });
  const { codigo, premio } = (await s.girar('c@gmail.com')).publico;
  const yo = { cliente: 'c@gmail.com' };
  assert.strictEqual(premio.id, 'correa');
  assert.strictEqual((await s.premioParaCobro(codigo, '', yo)).color, 'negra');
  assert.strictEqual(await s.elegirColor(codigo, 'gris'), true);
  assert.strictEqual(await s.elegirColor(codigo, 'rosada'), false, 'no hay correa de tela rosada');
  assert.strictEqual((await s.premioParaCobro(codigo, '', yo)).color, 'gris');
  assert.strictEqual((await s.premioParaCobro(codigo, 'negra', yo)).color, 'negra', 'el checkout manda el color final');
  await s.marcarUsado(codigo, 'orden-1');
  assert.strictEqual(await s.elegirColor(codigo, 'negra'), false, 'después de comprar ya no se cambia');
});

test('lo que se cobra con cada premio', () => {
  const m = premio => calcularMonto({ cantidad: 1, premio });
  assert.strictEqual(m(null).total, PRECIO);
  assert.strictEqual(m({ tipo: 'descuento', monto: 3000 }).total, PRECIO - 3000);
  // El % se redondea a favor del cliente: 5% de 68.990 = 3.449,5 → 3.450.
  assert.strictEqual(m({ tipo: 'descuento', pct: 5 }).descuento, 3450);
  assert.strictEqual(m({ tipo: 'descuento', pct: 7 }).descuento, 4830);
  assert.strictEqual(m({ tipo: 'descuento', pct: 10 }).total, PRECIO - 6899);
  // Con 2 bandas el % va sobre las dos; el monto fijo, una vez.
  assert.strictEqual(calcularMonto({ cantidad: 2, premio: { tipo: 'descuento', pct: 5 } }).descuento, Math.ceil(PRECIO * 2 * 0.05));
  assert.strictEqual(calcularMonto({ cantidad: 2, premio: { tipo: 'descuento', monto: 3000 } }).descuento, 3000);
  // Correa y tapones no cambian el monto: cambian el paquete.
  const correa = m({ tipo: 'correa', color: 'gris' });
  assert.strictEqual(correa.total, PRECIO);
  assert.strictEqual(correa.correaPremio, 'gris');
  assert.deepStrictEqual(correa.correas, [], 'la correa del premio no se cobra como par extra');
  assert.strictEqual(m({ tipo: 'correa', color: 'verde' }).correaPremio, 'negra');
  const tap = m({ tipo: 'tapones' });
  assert.strictEqual(tap.total, PRECIO);
  assert.strictEqual(tap.regaloPremio, true);
  assert.strictEqual(llevaRegaloTapones({ premio: { tipo: 'tapones' } }), true);
  // El envío no se descuenta, y en una compra de solo tapones el premio no va.
  assert.strictEqual(calcularMonto({ cantidad: 1, shippingCost: 4000, premio: { tipo: 'descuento', monto: 3000 } }).total, PRECIO - 3000 + 4000);
  assert.strictEqual(calcularMonto({ cantidad: 1, soloTapones: true, premio: { tipo: 'descuento', monto: 3000 } }).descuento, 0);
  assert.strictEqual(nombreProducto({ qty: 1, correaPremio: 'gris' }), 'DEUS Band + Correa de tela gris (premio ruleta)');
});

test('el navegador no puede mandar la correa del premio como un par extra pagado', () => {
  // Las claves de la correa del premio NO son claves de CORREAS: si el
  // navegador las mandara en `correas`, no se cobrarían ni se regalarían.
  const r = calcularMonto({ cantidad: 1, correas: ['negra', 'gris', 'tela-gris'] });
  assert.deepStrictEqual(r.correas, []);
  assert.strictEqual(r.correaPremio, null);
});

test('el checkout estima el descuento con la MISMA regla que el servidor', () => {
  assert.ok(HTML.includes('const d = pr.monto ? pr.monto : Math.ceil(bandas * (pr.pct || 0) / 100);'));
  assert.match(leer('services', 'precio.js'), /Math\.ceil\(precioBanda\(\) \* \(qty \|\| 1\) \* premio\.pct \/ 100\)/);
});

test('las tres pasarelas validan el código antes de cobrar y lo marcan usado al aprobarse', () => {
  for (const archivo of [['server.js'], ['routes', 'flow.js'], ['routes', 'transbank.js']]) {
    const src = leer(...archivo);
    const n = archivo.join('/');
    assert.ok(src.includes('premioParaCobro(codigoPremio, colorPremio, { cliente: customerEmail })'), n + ': no valida (ni reserva) el código');
    assert.ok(src.includes("return res.status(400).json({ error: e.message, campo: e.campo || 'codigo' })"), n + ': un código malo no se le avisa al cliente');
    assert.ok(src.includes('.marcarUsado('), n + ': el código quedaría reutilizable');
  }
  // Mercado Pago no acepta ítems negativos: con descuento, una sola línea al monto rebajado.
  assert.ok(leer('server.js').includes('unit_price: m.productos - m.descuento'));
  // El checkout manda el código y el color con el pedido.
  assert.ok(HTML.includes("codigoPremio: (!checkoutTapones && premioRuleta) ? premioRuleta.codigo : ''"));
});

test('el servidor limita los intentos (girar, consultar códigos y elegir color)', () => {
  const src = leer('server.js');
  for (const l of ['giroNuevoIp = limitador(5, HORA)', 'giroPedidoIp = limitador(15, HORA)', 'giroNuevoTodos = limitador(120, DIEZ_MIN)',
                   'codigoConsultaIp = limitador(30, DIEZ_MIN)', 'codigoFalloIp = limitador(10, DIEZ_MIN)', 'colorIp = limitador(20, DIEZ_MIN)']) {
    assert.ok(src.includes(l), 'falta ' + l);
  }
  // Al navegador va r.publico (sin el código si ya había girado), nunca r.paraCorreo.
  assert.ok(src.includes('res.json(r.publico);'));
  assert.ok(!src.includes('res.json(r.paraCorreo'));
});

test('el panel ve cuánta gente dejó su correo, los correos y qué pasó con cada premio', async () => {
  const { s, avanzar } = servicio();
  const a = (await s.girar('Primera.Persona@gmail.com')).publico;
  avanzar(60 * 1000);
  const b = (await s.girar('segunda@hotmail.com')).publico;
  await s.girar('segunda+repetida@hotmail.com'); // mismo correo: no suma otra fila
  let l = await s.lista();
  assert.strictEqual(l.length, 2);
  assert.deepStrictEqual(l.map(x => x.email), ['segunda@hotmail.com', 'primera.persona@gmail.com'], 'del más nuevo al más viejo, como lo escribió');
  assert.ok(l.every(x => x.estado === 'vigente' && x.codigo && x.premio && x.fecha && x.vence));
  await s.marcarUsado(a.codigo, 'orden-77');
  avanzar(49 * 3600 * 1000);
  l = await s.lista();
  assert.strictEqual(l.find(x => x.codigo === a.codigo).estado, 'usado');
  assert.strictEqual(l.find(x => x.codigo === a.codigo).orden, 'orden-77');
  assert.strictEqual(l.find(x => x.codigo === b.codigo).estado, 'vencido');
  const src = leer('server.js');
  assert.ok(src.includes("res.json({ ...(await s.resumen()), personas: await s.lista() });"));
  // Los correos son datos personales: el endpoint pide la clave del panel.
  const ep = src.slice(src.indexOf("app.get('/admin/ruleta'"), src.indexOf("app.get('/admin/ruleta'") + 500);
  assert.ok(ep.includes("if ((req.query.clave || '') !== clave) return res.status(403)"));
  const admin = leer('admin.html');
  assert.ok(admin.includes('<section id="sec-ruleta">'));
  assert.ok(admin.includes('cargarResenasPanel(); cargarRuleta();'), 'se carga al entrar al panel');
  assert.ok(admin.includes("if(/^[=+\\-@]/.test(v)) v = \"'\" + v;"), 'el CSV no deja colar fórmulas en Excel');
});

test('Netlify pasa /ruleta/* al servidor y los códigos no van al repositorio', () => {
  assert.match(leer('netlify.toml'), /from = "\/ruleta\/\*"\s+to = "https:\/\/deus-band\.onrender\.com\/ruleta\/:splat"/);
  assert.match(leer('.gitignore'), /^ruleta\.json$/m);
});

// Captura lo que se le mandaría a Resend, sin red (igual que en correas.test.js).
async function conCorreos(fn) {
  const enviados = [];
  const orig = https.request;
  const entorno = { k: process.env.RESEND_API_KEY, t: process.env.MAIL_TO };
  process.env.RESEND_API_KEY = 'test';
  process.env.MAIL_TO = 'despacho@ejemplo.com';
  https.request = (opts, cb) => {
    const req = new EventEmitter();
    let cuerpo = '';
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.write = c => { cuerpo += c; };
    req.end = () => {
      enviados.push(JSON.parse(cuerpo));
      const res = new EventEmitter();
      res.statusCode = 200;
      cb(res);
      res.emit('data', '{}');
      res.emit('end');
    };
    return req;
  };
  try { await fn(); } finally {
    https.request = orig;
    if (entorno.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = entorno.k;
    if (entorno.t === undefined) delete process.env.MAIL_TO; else process.env.MAIL_TO = entorno.t;
  }
  return enviados;
}

test('el correo del premio lleva el código, el envío gratis y el botón que lo aplica', async () => {
  const email = require('../services/email');
  const [desc] = await conCorreos(() => email.enviarPremioRuleta({
    email: 'camila@gmail.com', codigo: 'DEUS3K-K7Q2', vence: '2026-11-06T18:42:00Z',
    premio: { id: 'd3000', etiqueta: '$3.000 OFF', tipo: 'descuento', monto: 3000 }
  }));
  assert.deepStrictEqual(desc.to, ['camila@gmail.com']);
  assert.match(desc.subject, /\$3\.000 OFF \+ envío gratis/);
  assert.ok(desc.html.includes('DEUS3K-K7Q2'));
  assert.ok(desc.html.includes('https://deusbrand.cl/?premio=DEUS3K-K7Q2'));
  assert.ok(desc.html.includes('$65.990'), 'muestra el precio con el descuento');
  assert.ok(desc.html.includes('este mismo correo'), 'avisa que se usa con el mismo correo');
  const [correa] = await conCorreos(() => email.enviarPremioRuleta({
    email: 'camila@gmail.com', codigo: 'CORREA-K7Q2', vence: '2026-11-06T18:42:00Z',
    premio: { id: 'correa', etiqueta: 'Correa extra', tipo: 'correa' }
  }));
  // El color se elige en la web al usar el código, no en el correo.
  assert.ok(correa.html.includes('https://deusbrand.cl/?premio=CORREA-K7Q2"'));
  assert.ok(!correa.html.includes('&color='), 'el correo no debe hacer elegir el color');
  assert.ok(correa.html.includes('el color lo eliges en la web cuando uses tu código'));
});

test('el correo de despacho dice qué correa del premio meter en el paquete', async () => {
  const email = require('../services/email');
  const [d] = await conCorreos(() => email.enviarPagoConfirmado(
    { id: '123', transaction_amount: 65990, payer: { email: 'c@gmail.com' } },
    { customer: { name: 'Camila' }, color: 'negra', correas: [], correaPremio: 'gris', descuento: 3000, codigoPremio: 'DEUS3K-K7Q2', shipping: { cost: 0, address: {} } }
  ));
  assert.ok(d.html.includes('INCLUIR EN EL PAQUETE: CORREA DE TELA GRIS (PREMIO RULETA)'));
  assert.ok(d.html.includes('Premio ruleta DEUS3K-K7Q2: −$3.000'));
  assert.match(d.subject, /\+ ➕ CORREAS/);
});
