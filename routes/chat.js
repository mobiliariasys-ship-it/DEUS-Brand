const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const chat = require('../services/chat');
const chatLog = require('../services/chat-log');
const { getStock } = require('../services/stock');

// Precio único: el MISMO que cobran server.js, flow.js y transbank.js. Si algún
// día cambia, cambia acá también — el bot nunca debe decir un precio distinto
// al que se cobra en la pasarela.
const precioBanda = () => 58990;

function ipDe(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : (fwd || '').split(',')[0].trim()) || req.ip || 'desconocida';
}

// El cliente manda su historial y recibe la respuesta del bot.
router.post('/chat', async (req, res) => {
  const { historial, id, ruta } = req.body || {};
  if (!Array.isArray(historial) || !historial.length) {
    return res.status(400).json({ error: 'Falta el historial' });
  }

  const convId = (typeof id === 'string' && /^[a-z0-9-]{6,40}$/.test(id))
    ? id
    : crypto.randomUUID();

  const resultado = await chat.responder({
    historial,
    precio: precioBanda(),
    stock: getStock(),
    ip: ipDe(req)
  });

  if (resultado.error) {
    // Cualquier problema (sin clave, límite, falla de red) devuelve 200 con el
    // motivo: el widget muestra un mensaje amable y ofrece WhatsApp. Nunca se
    // deja al cliente con un error crudo.
    return res.json({ error: resultado.error, whatsapp: chat.WHATSAPP, id: convId });
  }

  const ultimaPregunta = [...historial].reverse().find(m => m && m.rol !== 'bot');
  chatLog.registrar({
    id: convId,
    pregunta: ultimaPregunta ? ultimaPregunta.texto : '',
    respuesta: resultado.texto,
    ip: ipDe(req),
    ua: req.headers['user-agent'],
    ruta
  }).then(conv => chatLog.programarAviso(conv, false))
    .catch(e => console.error('[chat] registro:', e.message));

  res.json({ texto: resultado.texto, id: convId });
});

// El cliente apretó "Hablar con una persona": lo marcamos y avisamos al tiro.
router.post('/chat/escalar', async (req, res) => {
  const { id } = req.body || {};
  if (typeof id === 'string') {
    chatLog.marcarEscalado(id).catch(e => console.error('[chat] escalar:', e.message));
  }
  res.json({ ok: true, whatsapp: chat.WHATSAPP });
});

// Panel: leer las conversaciones. Protegido con STOCK_KEY, igual que el resto
// de los endpoints de administración.
router.get('/admin/chats', async (req, res) => {
  const clave = (process.env.STOCK_KEY || '').trim();
  if (!clave) return res.status(404).json({ error: 'No disponible' });
  if ((req.query.clave || '') !== clave) return res.status(403).json({ error: 'Clave incorrecta' });
  try {
    const limite = Math.min(300, Math.max(1, parseInt(req.query.limite, 10) || 100));
    res.json({ conversaciones: await chatLog.listar(limite) });
  } catch (e) {
    console.error('[chat] admin:', e.message);
    res.status(500).json({ error: 'No se pudieron leer las conversaciones' });
  }
});

module.exports = router;
