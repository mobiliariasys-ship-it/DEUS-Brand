'use strict';
// Las pasarelas reavisan el MISMO pago más de una vez. MercadoPago manda
// 'payment.updated' días después (p. ej. al liberar el dinero retenido) y
// reintenta los webhooks que fallaron; Flow reconsulta el estado. Cada reaviso
// vuelve a entrar al bloque de "pago aprobado".
//
// Bug real (Álvaro Bravo, compra del 19 reavisada el 23): llegaba un segundo
// correo de "pago confirmado" y —peor— un segundo correo AL CLIENTE, que a los
// días parece un cobro doble. Y la venta se contaba dos veces en el panel.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const metrics = require('../services/metrics');

const ORDEN = 'test-reaviso-' + Date.now();

// metrics.guardar() escribe en metrics-data.json del repo. El test agrega
// ventas de mentira, así que se respalda el archivo y se repone al terminar:
// correr la suite no puede ensuciar el ledger de nadie.
const LEDGER = path.join(__dirname, '..', 'metrics-data.json');
let respaldo = null;
test.before(() => { try { respaldo = fs.readFileSync(LEDGER); } catch (e) { respaldo = null; } });
test.after(() => {
  if (respaldo !== null) fs.writeFileSync(LEDGER, respaldo);
  else { try { fs.unlinkSync(LEDGER); } catch (e) { /* no existía */ } }
});

test('el mismo pago avisado dos veces se registra UNA sola vez', () => {
  const antes = metrics.snapshot().ventas.total.count;

  const t1 = metrics.registrarVenta({ monto: 68990, metodo: 'MercadoPago', nombre: 'Prueba Reaviso', orden: ORDEN, email: 'prueba@ejemplo.com', unidades: 1 });
  const despuesPrimera = metrics.snapshot().ventas.total.count;
  assert.strictEqual(despuesPrimera, antes + 1, 'la primera vez sí tiene que contar');

  // El reaviso, con exactamente los mismos datos.
  const t2 = metrics.registrarVenta({ monto: 68990, metodo: 'MercadoPago', nombre: 'Prueba Reaviso', orden: ORDEN, email: 'prueba@ejemplo.com', unidades: 1 });
  const despuesSegunda = metrics.snapshot().ventas.total.count;

  assert.strictEqual(despuesSegunda, despuesPrimera, 'el reaviso NO puede agregar otra venta al panel');
  assert.deepStrictEqual(t2, t1, 'tiene que devolver el mismo ticket, no uno nuevo');
});

test('una venta sin número de orden sigue entrando (carga manual)', () => {
  const antes = metrics.snapshot().ventas.total.count;
  metrics.registrarVenta({ monto: 68990, metodo: 'Efectivo', nombre: 'Venta presencial' });
  assert.strictEqual(metrics.snapshot().ventas.total.count, antes + 1);
});

test('las tres pasarelas no reenvían los correos en un reaviso', () => {
  // El corte tiene que preguntarse ANTES de registrarVenta(), que es lo que
  // deja la marca. Si alguien reordena eso, `reaviso` queda siempre en true y
  // los correos dejan de salir — por eso se verifica el orden, no solo que la
  // guarda exista.
  const casos = [
    ['../server.js', 'info.id'],
    ['../routes/flow.js', 'st.commerceOrder'],
    ['../routes/transbank.js', 'result.buy_order'],
  ];
  for (const [archivo, orden] of casos) {
    const src = fs.readFileSync(path.join(__dirname, archivo), 'utf8');

    assert.ok(src.includes(`const reaviso = !!metrics.buscarTicketPorOrden(${orden})`),
      archivo + ' no consulta si el pago ya fue procesado');
    assert.ok(/if \(!reaviso\) (await )?enviarPagoConfirmado\(/.test(src),
      archivo + ' manda el correo al dueño sin mirar si es un reaviso');
    assert.ok(/if \(!reaviso\) enviarConfirmacionCliente\(/.test(src),
      archivo + ' manda el correo AL CLIENTE sin mirar si es un reaviso');

    assert.ok(src.indexOf('const reaviso =') < src.indexOf('registrarVenta('),
      archivo + ': la consulta quedó DESPUÉS de registrarVenta(), que es la que deja la marca');
  }
});
