// Persistencia simple en disco (mismo patrón que ya usa stock.js).
// Nota: el disco de Render es efímero en cada *deploy* (se borra), pero
// sobrevive cuando el servicio solo se duerme/despierta por inactividad —
// que es la causa más común de que el panel "pierda" ventas del día.
// El respaldo definitivo de cada venta y ticket sigue siendo el correo.
const fs = require('fs');
const path = require('path');

function load(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function save(file, data) {
  try {
    fs.writeFileSync(path.join(__dirname, '..', file), JSON.stringify(data));
  } catch (e) {
    console.error(`[persist] Error guardando ${file}:`, e.message);
  }
}

module.exports = { load, save };
