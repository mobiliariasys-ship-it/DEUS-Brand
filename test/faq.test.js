'use strict';
// Preguntas frecuentes: lo que ve Google (FAQPage en JSON-LD) tiene que estar
// también a la vista en la página, con el mismo texto de pregunta.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const datosFaq = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => JSON.parse(m[1])).find((d) => d['@type'] === 'FAQPage');

test('cada pregunta de los datos para Google está a la vista en la página', () => {
  assert.ok(datosFaq, 'falta el FAQPage en los datos estructurados');
  for (const q of datosFaq.mainEntity) {
    assert.ok(html.includes('<summary>' + q.name + '</summary>'), 'no está en la página: ' + q.name);
  }
});

test('la FAQ aclara que no es un dispositivo de diagnóstico médico', () => {
  const p = '¿Es un dispositivo médico? ¿Tiene aval de instituciones clínicas?';
  const i = html.indexOf('<summary>' + p + '</summary>');
  assert.ok(i !== -1, 'falta la pregunta en la página');
  const r = html.slice(i, html.indexOf('</details>', i));
  assert.match(r, /No es un dispositivo de diagnóstico médico/);
  assert.match(r, /no sustituye una polisomnografía ni un ECG clínico/);
  assert.match(r, /literatura en ciencias del deporte/);
  assert.ok(datosFaq.mainEntity.some((q) => q.name === p), 'falta la pregunta en los datos para Google');
});

test('la FAQ de certificaciones describe bien cada una (RoHS no es biocompatibilidad)', () => {
  const p = '¿Qué certificaciones tiene?';
  const i = html.indexOf('<summary>' + p + '</summary>');
  assert.ok(i !== -1, 'falta la pregunta en la página');
  const r = html.slice(i, html.indexOf('</details>', i));
  for (const c of ['CE', 'FCC', 'RoHS', 'PPG', 'acelerómetro de 3 ejes']) assert.ok(r.includes(c), 'falta ' + c);
  assert.match(r, /RoHS, que certifica que sus componentes electrónicos están libres de sustancias peligrosas/);
  assert.doesNotMatch(r, /biocompatib/i, 'RoHS trata sustancias peligrosas en la electrónica, no la biocompatibilidad con la piel');
  assert.ok(datosFaq.mainEntity.some((q) => q.name === p), 'falta la pregunta en los datos para Google');
});
