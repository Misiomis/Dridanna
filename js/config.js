// ─── Configuración global Dridanna ───────────────────────────────────────────
// Cuando despliegues el backend en Render/Railway, actualizá PROD_API_BASE.
const PROD_API_BASE = 'https://dridanna-api.onrender.com'; // ← cambiar al URL real

const API_BASE = (() => {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3000';
  return PROD_API_BASE;
})();
