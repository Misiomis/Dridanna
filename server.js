'use strict';
require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const META_TOKEN    = process.env.META_TOKEN;
const META_PHONE_ID = process.env.META_PHONE_ID;
const ADMIN_PHONE   = process.env.ADMIN_PHONE  || process.env.META_PHONE_ID;
const ADMIN_NAME    = process.env.ADMIN_NAME   || 'Administración Dridanna';
const META_VER      = 'v21.0';

if (!META_TOKEN || !META_PHONE_ID) {
  console.error('\nERROR: Faltan META_TOKEN y META_PHONE_ID en .env\n');
  process.exit(1);
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

/* ─── Helpers ──────────────────────────────────── */

function normalizePhone(raw) {
  return String(raw).replace(/\D/g, '').replace(/^0/, '').replace(/^(?!54)/, '54');
}

const txt = (v) => ({ type: 'text', text: String(v || '—') });

function bodyComp(...params) {
  return [{ type: 'body', parameters: params }];
}

async function sendTemplate({ to, template, language = 'es_AR', components }) {
  const res = await fetch(
    `https://graph.facebook.com/${META_VER}/${META_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_TOKEN}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name:     template,
          language: { code: language },
          ...(components?.length && { components }),
        },
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) {
    const err     = new Error(json?.error?.message || 'Error en API de Meta');
    err.metaCode  = json?.error?.code;
    err.raw       = json;
    throw err;
  }
  return json?.messages?.[0]?.id;
}

function buildDireccion(direccion, barrio) {
  return [direccion, barrio ? 'Barrio ' + barrio : ''].filter(Boolean).join(', ') || '—';
}

function shortName(nombre, apellido) {
  const n = (nombre  || '').trim();
  const a = (apellido|| '').trim();
  return n + (a ? ' ' + a.charAt(0).toUpperCase() + '.' : '');
}

/* ══════════════════════════════════════════════════════
   PLANTILLAS DISPONIBLES (configuradas en Meta BM)

   1. alta_cliente         → al CLIENTE: bienvenida
      {{1}} nombre completo

   2. confirmacion_reserva → al CLIENTE: confirmación
      {{1}} nombre completo
      {{2}} juego/inflable
      {{3}} fecha ("20 de junio de 2026")
      {{4}} horario ("Tarde (14:00 – 18:00)")
      {{5}} dirección + barrio

   3. recordatorio_reserva → al CLIENTE: recordatorio
      {{1}} nombre completo
      {{2}} juego/inflable
      {{3}} fecha
      {{4}} horario

   4. nueva_reserva        → al ADMIN: aviso de nueva reserva
      {{1}} nombre del admin
      {{2}} nombre corto del cliente (Nombre A.)
      {{3}} teléfono del cliente
      {{4}} DNI del cliente (o "—")
      {{5}} producto
      {{6}} fecha
      {{7}} horario
      {{8}} dirección + barrio
      {{9}} referencia / observaciones
══════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────
   POST /api/notify
   Llamado desde confirmacion.html.
   Envía confirmacion_reserva al cliente
   y nueva_reserva al admin simultáneamente.
   ───────────────────────────────────────────── */
app.post('/api/notify', async (req, res) => {
  const {
    celular, nombre, apellido, producto,
    fechaLabel, turnoLabel,
    direccion, barrio, referencia, dni,
  } = req.body || {};

  if (!celular || !nombre) {
    return res.status(400).json({ ok: false, error: 'celular y nombre son obligatorios.' });
  }

  const customerPhone = normalizePhone(celular);
  const adminPhone    = normalizePhone(ADMIN_PHONE);
  const fullName      = `${nombre}${apellido ? ' ' + apellido : ''}`;
  const dir           = buildDireccion(direccion, barrio);
  const results       = {};

  /* 1. Confirmación al cliente */
  try {
    results.confirmacion = await sendTemplate({
      to:         customerPhone,
      template:   'confirmacion_reserva',
      components: bodyComp(
        txt(fullName), txt(producto), txt(fechaLabel), txt(turnoLabel), txt(dir)
      ),
    });
    console.log(`[confirmacion_reserva] → ${customerPhone} ✓ ${results.confirmacion}`);
  } catch (e) {
    results.confirmacion_error = e.message;
    console.error('[confirmacion_reserva]', e.message);
  }

  /* 2. Aviso al admin */
  try {
    results.nueva_reserva = await sendTemplate({
      to:         adminPhone,
      template:   'nueva_reserva',
      components: bodyComp(
        txt(ADMIN_NAME),
        txt(shortName(nombre, apellido)),
        txt(celular),
        txt(dni),
        txt(producto),
        txt(fechaLabel),
        txt(turnoLabel),
        txt(dir),
        txt(referencia),
      ),
    });
    console.log(`[nueva_reserva] → ${adminPhone} ✓ ${results.nueva_reserva}`);
  } catch (e) {
    results.nueva_reserva_error = e.message;
    console.error('[nueva_reserva]', e.message);
  }

  return res.json({ ok: true, results });
});

/* ─────────────────────────────────────────────
   POST /api/notify/recordatorio
   Admin envía recordatorio previo al evento.
   ───────────────────────────────────────────── */
app.post('/api/notify/recordatorio', async (req, res) => {
  const { celular, nombre, apellido, producto, fechaLabel, turnoLabel } = req.body || {};
  if (!celular || !nombre) {
    return res.status(400).json({ ok: false, error: 'celular y nombre son obligatorios.' });
  }

  const phone    = normalizePhone(celular);
  const fullName = `${nombre}${apellido ? ' ' + apellido : ''}`;

  try {
    const id = await sendTemplate({
      to:         phone,
      template:   'recordatorio_reserva',
      components: bodyComp(txt(fullName), txt(producto), txt(fechaLabel), txt(turnoLabel)),
    });
    console.log(`[recordatorio_reserva] → ${phone} ✓ ${id}`);
    return res.json({ ok: true, messageId: id });
  } catch (e) {
    console.error('[recordatorio_reserva]', e.message);
    return res.status(502).json({ ok: false, error: e.message, code: e.metaCode });
  }
});

/* ─────────────────────────────────────────────
   POST /api/notify/alta-cliente
   Admin da la bienvenida a un nuevo cliente.
   ───────────────────────────────────────────── */
app.post('/api/notify/alta-cliente', async (req, res) => {
  const { celular, nombre, apellido } = req.body || {};
  if (!celular || !nombre) {
    return res.status(400).json({ ok: false, error: 'celular y nombre son obligatorios.' });
  }

  const phone    = normalizePhone(celular);
  const fullName = `${nombre}${apellido ? ' ' + apellido : ''}`;

  try {
    const id = await sendTemplate({
      to:         phone,
      template:   'alta_cliente',
      components: bodyComp(txt(fullName)),
    });
    console.log(`[alta_cliente] → ${phone} ✓ ${id}`);
    return res.json({ ok: true, messageId: id });
  } catch (e) {
    console.error('[alta_cliente]', e.message);
    return res.status(502).json({ ok: false, error: e.message, code: e.metaCode });
  }
});

/* ─────────────────────────────────────────────
   POST /api/notify/confirmar
   Admin confirma una reserva existente.
   Envía nueva_reserva al admin (Estela) como
   notificación de que la reserva fue confirmada.
   ───────────────────────────────────────────── */
app.post('/api/notify/confirmar', async (req, res) => {
  const {
    celular, nombre, apellido, producto,
    fechaLabel, turnoLabel,
    direccion, barrio, referencia, dni,
  } = req.body || {};
  if (!nombre) return res.status(400).json({ ok: false, error: 'nombre es obligatorio.' });

  const adminPhone = normalizePhone(ADMIN_PHONE);
  const dir        = buildDireccion(direccion, barrio);

  try {
    const id = await sendTemplate({
      to:         adminPhone,
      template:   'nueva_reserva',
      components: bodyComp(
        txt(ADMIN_NAME),
        txt(shortName(nombre, apellido)),
        txt(celular),
        txt(dni),
        txt(producto),
        txt(fechaLabel),
        txt(turnoLabel),
        txt(dir),
        txt(referencia),
      ),
    });
    console.log(`[confirmar→nueva_reserva] → ${adminPhone} ✓ ${id}`);
    return res.json({ ok: true, messageId: id });
  } catch (e) {
    console.error('[confirmar→nueva_reserva]', e.message);
    return res.status(502).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`Dridanna API → http://localhost:${PORT}`));
