'use strict';
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Credenciales Meta (desde .env) ──────────── */
const META_TOKEN    = process.env.META_TOKEN;
const META_PHONE_ID = process.env.META_PHONE_ID;
const META_TEMPLATE = process.env.META_TEMPLATE_NAME || 'hello_world';
const META_VER      = 'v21.0';

if (!META_TOKEN || !META_PHONE_ID) {
  console.error(
    '\nERROR: Faltan variables de entorno.\n' +
    'Copiá .env.example a .env y completá META_TOKEN y META_PHONE_ID.\n'
  );
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ── POST /api/notify ─────────────────────────────────────────────
 *
 *  Envía una notificación de WhatsApp al cliente cuando confirma
 *  una reserva en el frontend de Dridanna.
 *
 *  El token de Meta NUNCA sale del servidor; el frontend solo envía
 *  los datos del pedido (celular, nombre, producto, fecha, etc.).
 *
 *  PLANTILLAS (requeridas para mensajes a nuevos contactos):
 *  ─────────────────────────────────────────────────────────
 *  1. Ir a Meta Business Manager → Herramientas → Plantillas de mensaje
 *  2. Crear plantilla en "Español (Argentina)" con el texto:
 *
 *     "Hola {{1}}! Recibimos tu solicitud para *{{2}}* el {{3}}
 *      (turno {{4}}). Precio estimado: {{5}}.
 *      Te confirmamos a la brevedad. — Dridanna"
 *
 *  3. Una vez aprobada (24-48 hs), actualizar META_TEMPLATE_NAME en .env.
 *  4. Mientras tanto, usar 'hello_world' (plantilla de prueba de Meta).
 * ────────────────────────────────────────────────────────────── */
app.post('/api/notify', async (req, res) => {
  const { celular, nombre, apellido, producto, fecha, turno, precio } = req.body || {};

  if (!celular || !nombre) {
    return res.status(400).json({ ok: false, error: 'Faltan campos: celular y nombre son obligatorios.' });
  }

  /* Normaliza número: solo dígitos + prefijo Argentina 54 */
  const phone = celular
    .replace(/\D/g, '')
    .replace(/^0/, '')
    .replace(/^(?!54)/, '54');

  /* hello_world no tiene parámetros y es en_US; las plantillas personalizadas sí */
  const isHelloWorld = META_TEMPLATE.toLowerCase() === 'hello_world';

  const template = {
    name:     META_TEMPLATE,
    language: { code: isHelloWorld ? 'en_US' : 'es_AR' },
    ...(!isHelloWorld && {
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: `${nombre}${apellido ? ' ' + apellido : ''}` },
          { type: 'text', text: producto || '—' },
          { type: 'text', text: fecha    || '—' },
          { type: 'text', text: turno    || '—' },
          { type: 'text', text: precio   || '—' },
        ],
      }],
    }),
  };

  try {
    const apiRes = await fetch(
      `https://graph.facebook.com/${META_VER}/${META_PHONE_ID}/messages`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${META_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:       phone,
          type:     'template',
          template,
        }),
      }
    );

    const result = await apiRes.json();

    if (!apiRes.ok) {
      console.error('[Meta API Error]', JSON.stringify(result?.error || result));
      return res.status(502).json({
        ok:    false,
        error: result?.error?.message || 'Error en la API de Meta',
        code:  result?.error?.code,
      });
    }

    const msgId = result?.messages?.[0]?.id;
    console.log(`[Notify OK] → ${phone} | id: ${msgId}`);
    return res.json({ ok: true, messageId: msgId });

  } catch (err) {
    console.error('[Server Error]', err.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor.' });
  }
});

app.listen(PORT, () =>
  console.log(`Dridanna API → http://localhost:${PORT}`)
);
