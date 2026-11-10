// La API de Meta vence por versión. Con v21.0 el panel se quedó sin gasto de
// Meta el 10-nov-2026 (la versión vieja dejó de responder). Este test evita
// volver a una versión vencida y que ads y Conversions API queden desparejas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const version = f => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'services', f), 'utf8').match(/const API_VERSION = 'v(\d+)\.0';/);
  assert.ok(m, 'falta API_VERSION en ' + f);
  return Number(m[1]);
};

test('ads y Conversions API usan la misma versión de Meta, y no una vencida', () => {
  const ads = version('meta-ads.js'), capi = version('meta-capi.js');
  assert.strictEqual(ads, capi, 'meta-ads.js y meta-capi.js deben usar la misma versión');
  assert.ok(ads >= 26, 'v' + ads + '.0 ya venció o está por vencer: usar v26.0 o más nueva');
});
