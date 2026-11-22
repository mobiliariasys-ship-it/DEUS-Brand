'use strict';
// En los celulares más angostos (320px) la pastilla "100% gratis · sin pagos
// ni suscripciones" de la app no cabía en una línea y se salía 25px por la
// derecha (revisión general, 22-nov-2026): ahí pasa a dos líneas.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('la pastilla de la app pasa a dos líneas en pantallas de 350px o menos', () => {
  assert.match(html, /@media\(max-width:350px\)\{\.app-badge-sub\{white-space:normal;/);
});
