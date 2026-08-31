'use strict';
// Regresión del checkout: tres clientes llenaron todos los datos y no pudieron
// pagar. La causa estaba acá — calcularEnvio() borraba selectedShipping ANTES
// de tener reemplazo, y al tocar "Pagar" en el celular el blur de la dirección
// lo disparaba justo antes del clic. asegurarEnvio() veía null y frenaba.
//
// El test corre las funciones REALES extraídas de index.html sobre un DOM
// mínimo, así que si alguien reintroduce el borrado, esto falla.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Saca `function nombre(...) { ... }` del HTML balanceando llaves.
function extraer(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const i = SRC.search(re);
  assert.ok(i >= 0, 'no encontré function ' + nombre + '() en index.html');
  let j = SRC.indexOf('{', i), prof = 0;
  for (let k = j; k < SRC.length; k++) {
    if (SRC[k] === '{') prof++;
    else if (SRC[k] === '}' && --prof === 0) return SRC.slice(i, k + 1);
  }
  throw new Error('llaves sin cerrar en ' + nombre);
}

// ── DOM mínimo ───────────────────────────────────────────────────────────
function nuevoDom() {
  const val = { 'sh-region': 'Metropolitana', 'sh-commune': 'Providencia', 'sh-address': 'Av. Siempre Viva 742' };
  const el = id => ({
    get value() { return val[id] || ''; },
    set value(v) { val[id] = v; },
    style: {}, innerHTML: '', textContent: '', classList: { add(){}, remove(){} },
    querySelectorAll: () => [], querySelector: () => null,
  });
  const cache = {};
  return {
    val,
    document: {
      getElementById: id => (cache[id] || (cache[id] = el(id))),
      querySelectorAll: () => [],
    },
  };
}

// Monta el contexto con las funciones reales + las dependencias stubbeadas.
function montar({ responder }) {
  const dom = nuevoDom();
  const eventos = [];
  const ctx = {
    document: dom.document,
    setTimeout, clearTimeout, Promise, JSON, Math, Number, Array, Object, Infinity,
    console: { error() {}, log() {} },
    window: { deusEvento: e => eventos.push(e) },
    // Dependencias que no estamos probando
    subtotalCheckout: () => 54990,
    envioGratis: () => true,
    getRegionCode: () => '13',
    mostrarAvisoEnvioGratis: () => {},
    encodeURIComponent, decodeURIComponent,
    fetchBackend: (p, o) => responder(p, o),
  };
  ctx.window.document = dom.document;
  vm.createContext(ctx);
  vm.runInContext(
    'let selectedShipping = null;\n' +
    [extraer('direccionActual'), extraer('direccionCompleta'),
     extraer('aplicarCourier'), extraer('cotizarEnvio'),
     extraer('calcularEnvio'), extraer('asegurarEnvio')].join('\n') +
    '\nlet cotizacionEnVuelo = null, turnoCotizacion = 0;',
    ctx);
  return { ctx, dom, eventos, get envio() { return vm.runInContext('selectedShipping', ctx); } };
}

const ok = () => ({ ok: true, json: async () => ({ carriers: [{ carrier: 'Starken', price: 3900 }] }) });
const msg = () => ({ style: {}, textContent: '' });

// ── Los tres síntomas ────────────────────────────────────────────────────

test('el clic en Pagar justo después del blur no pierde la venta', async () => {
  // Orden real en celular: tocar el botón dispara PRIMERO el blur de la calle
  // (que cotiza) y ~1 ms después el clic (que llama a asegurarEnvio). Antes,
  // en ese hueco selectedShipping estaba en null y la venta se caía.
  let llamadas = 0, soltar;
  const h = montar({ responder: () => { llamadas++; return new Promise(r => { soltar = r; }); } });

  vm.runInContext('calcularEnvio()', h.ctx);                       // blur
  await new Promise(r => setTimeout(r, 1));

  const m = msg();
  const clic = vm.runInContext('asegurarEnvio', h.ctx)(m);         // clic en Pagar
  assert.strictEqual(llamadas, 1, 'el clic no debe largar una segunda cotización encima del blur');

  soltar(ok());                                                    // responde la del blur
  assert.strictEqual(await clic, true, 'con la dirección completa, el cliente tiene que poder pagar');
  assert.strictEqual(h.envio.carrier, 'Starken');
  assert.ok(!h.eventos.includes('co:4xenvio'), 'no debe registrarse como caída: la cotización sí llegó');
});

test('no se lanzan dos cotizaciones en paralelo por el mismo destino', async () => {
  let llamadas = 0;
  const h = montar({ responder: () => { llamadas++; return Promise.resolve(ok()); } });
  const a = vm.runInContext('calcularEnvio()', h.ctx);   // blur
  const b = vm.runInContext('calcularEnvio()', h.ctx);   // asegurarEnvio detrás
  await Promise.all([a, b]);
  assert.strictEqual(llamadas, 1, 'la segunda debe esperar la misma promesa, no pedir de nuevo');
});

test('si la cotización falla, el cliente PUEDE pagar igual (envío gratis)', async () => {
  const h = montar({ responder: () => Promise.reject(new Error('backend dormido')) });
  const m = msg();
  const puede = await vm.runInContext('asegurarEnvio', h.ctx)(m);
  assert.strictEqual(puede, true, 'no debe frenar la venta: el envío es gratis y la dirección viaja igual');
  assert.strictEqual(h.envio.carrier, 'Starken');
  assert.strictEqual(h.envio.price, 0, 'el respaldo no puede cobrar despacho');
  assert.strictEqual(h.envio.address.commune, 'Providencia', 'la dirección escrita debe viajar en el pedido');
  assert.ok(h.eventos.includes('co:4xenvio'), 'el embudo debe registrar que falló la cotización');
  assert.ok(h.eventos.includes('co:4xrescate'), 'y que igual pudo pagar');
});

test('la respuesta vieja no pisa a la nueva', async () => {
  const pendientes = [];
  const h = montar({ responder: () => new Promise(r => pendientes.push(r)) });
  vm.runInContext('calcularEnvio()', h.ctx);              // turno 1
  h.dom.val['sh-address'] = 'Otra calle 100';            // cambia el destino
  const nueva = vm.runInContext('calcularEnvio()', h.ctx); // turno 2
  pendientes[1]({ ok: true, json: async () => ({ carriers: [{ carrier: 'Nueva', price: 100 }] }) });
  await nueva;
  pendientes[0]({ ok: true, json: async () => ({ carriers: [{ carrier: 'Vieja', price: 999 }] }) });
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(h.envio.carrier, 'Nueva', 'la cotización vieja no debe sobrescribir a la nueva');
});

// ── Y la guarda del código fuente ────────────────────────────────────────

test('cotizarEnvio() no vuelve a borrar selectedShipping antes de reemplazarlo', () => {
  const cuerpo = extraer('cotizarEnvio');
  const antesDelFetch = cuerpo.slice(0, cuerpo.indexOf('await fetchBackend'));
  assert.ok(!/selectedShipping\s*=\s*null/.test(antesDelFetch),
    'borrar la cotización antes de tener reemplazo es exactamente el bug que dejó a 3 clientes sin poder pagar');
});

test('las tres vías de pago reintentan si el backend está dormido', () => {
  for (const fn of ['iniciarPagoFlow', 'iniciarPagoWebpay', 'iniciarPago']) {
    const cuerpo = extraer(fn);
    assert.ok(/fetchBackend\(/.test(cuerpo), fn + ' debe usar fetchBackend (reintentos + timeout), no fetch pelado');
    assert.ok(/pagoEnCurso\s*=\s*true/.test(cuerpo), fn + ' debe bloquear el doble toque');
  }
});
