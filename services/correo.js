// Validación de correo compartida entre el sitio y el backend.
//
// POR QUÉ EXISTE: Flow rechaza la transacción COMPLETA cuando el correo no le
// parece válido — no es que rebote el comprobante, es que el cliente no puede
// pagar. Caso real:
//
//   {"code":1620,"message":"The userEmail: andressherranz@gmail.con is not valid."}
//
// Ese pedido se perdió entero. El sitio ya avisa del tipeo antes de pagar, pero
// esto es la red de abajo: si algo se le escapa al navegador, el backend lo
// frena acá y devuelve un mensaje que el cliente PUEDE arreglar, en vez de
// dejar que la pasarela tire un error genérico.
//
// Transbank no le manda el correo a la pasarela, así que es inmune. Flow y
// MercadoPago sí.

// Terminaciones que NO EXISTEN en internet: escribirlas es siempre un tipeo.
// La lista es corta y explícita a propósito. Ojo con .co (Colombia), .cm
// (Camerún), .om (Omán) y .cl — esos SÍ existen, y meterlos acá botaría
// correos válidos, que es exactamente el error que estamos tratando de evitar.
const TLD_IMPOSIBLES = ['con', 'cmo', 'comm', 'ocm', 'vom', 'xom', 'cim', 'cpm', 'clm', 'coom', 'cok'];

function normalizar(email) {
  return String(email || '').trim().toLowerCase().replace(/\s+/g, '');
}

// Estructura mínima: algo, arroba, algo, punto, algo.
function tieneForma(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizar(email));
}

function tldImposible(email) {
  const m = normalizar(email).match(/\.([a-z]+)$/);
  return !!m && TLD_IMPOSIBLES.indexOf(m[1]) >= 0;
}

// Lo que se le puede mandar a una pasarela sin que rechace el pago.
function esUsable(email) {
  return tieneForma(email) && !tldImposible(email);
}

// Mensaje para el cliente. Tiene que decirle QUÉ arreglar: "no se pudo iniciar
// el pago" lo manda a reintentar el mismo error hasta que se aburre y se va.
const MENSAJE = 'Revisa tu correo: la pasarela de pago no lo acepta. ¿Escribiste bien la terminación (.com)?';

module.exports = { TLD_IMPOSIBLES, normalizar, tieneForma, tldImposible, esUsable, MENSAJE };
