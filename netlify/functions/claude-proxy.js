/**
 * netlify/functions/claude-proxy.js
 * Avatar Pro — JCOTRAINER
 *
 * Proxy serverless que mantiene la API key de Anthropic en el servidor.
 * El frontend NUNCA ve la key. Además exige una clave de acceso
 * (variable de entorno ACCESS_CODES) para poder usarlo.
 *
 * Variables de entorno en Netlify:
 *   ANTHROPIC_API_KEY  → tu API key de Anthropic
 *   ACCESS_CODES       → una o varias claves separadas por coma y sin espacios.
 *                        Cada clave puede llevar una fecha de vencimiento
 *                        con el formato  clave:AAAA-MM-DD
 *
 *   Ejemplos:
 *     clave-ana-8x2k                          → sin vencimiento
 *     clave-ana-8x2k:2026-12-31               → sirve hasta el 31-12-2026 (hora de Chile)
 *     clave-ana-8x2k:2026-12-31,clave-luis-7m4p   → una con fecha y otra sin fecha
 */

const crypto = require("crypto");

// Compara dos textos sin filtrar información por tiempos de respuesta
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Fecha de hoy en Chile, con formato AAAA-MM-DD
function todayInChile() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

// Interpreta una entrada de ACCESS_CODES: "clave" o "clave:AAAA-MM-DD"
function parseEntry(raw) {
  const entry = raw.trim();
  if (!entry) return null;

  const m = entry.match(/^(.*?):(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return { code: entry, expires: null, invalidDate: false };

  const code = m[1];
  const y = Number(m[2]);
  const mo = Number(m[3]);
  const d = Number(m[4]);
  if (!code) return null;

  // Verifica que sea una fecha real (rechaza por ejemplo 2026-13-45)
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const isRealDate =
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  if (!isRealDate) return { code, expires: null, invalidDate: true };

  const expires = `${m[2]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { code, expires, invalidDate: false };
}

exports.handler = async (event) => {
  // ── CORS headers ───────────────────────────────────────────────────
  const headers = {
    "Access-Control-Allow-Origin": "*",          // en producción cambia a tu dominio
    "Access-Control-Allow-Headers": "Content-Type, x-access-code",
    "Content-Type": "application/json",
  };

  // ── Preflight OPTIONS ──────────────────────────────────────────────
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  // ── Solo POST ──────────────────────────────────────────────────────
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // ── Claves de acceso configuradas ──────────────────────────────────
  const entries = (process.env.ACCESS_CODES || "")
    .split(",")
    .map(parseEntry)
    .filter(Boolean);

  if (entries.length === 0) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "ACCESS_CODES no configurada en variables de entorno." }),
    };
  }

  if (entries.some((e) => e.invalidDate)) {
    // No se imprime la clave, solo el aviso, para que quede en los logs de Netlify
    console.warn("ACCESS_CODES: hay una entrada con fecha inválida; fue ignorada (nadie puede entrar con ella).");
  }

  // ── Validar la clave enviada por el navegador ──────────────────────
  const provided = (event.headers["x-access-code"] || "").trim();
  const today = todayInChile();

  let authorized = false;
  let expired = false;
  if (provided !== "") {
    for (const e of entries) {
      if (e.invalidDate) continue;
      if (!safeEqual(e.code, provided)) continue;
      if (e.expires && today > e.expires) expired = true;
      else authorized = true;
    }
  }

  if (!authorized) {
    await new Promise((resolve) => setTimeout(resolve, 800)); // frena intentos repetidos
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify(
        expired
          ? { error: "Tu acceso venció.", reason: "expired" }
          : { error: "Clave de acceso inválida.", reason: "invalid" }
      ),
    };
  }

  // ── Parsear body ───────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Body inválido — se esperaba JSON." }),
    };
  }

  // ── Solo verificar la clave (no llama a Anthropic, no cuesta nada) ─
  if (payload && payload.check === true) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  }

  // ── Validar API key de Anthropic configurada ───────────────────────
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada en variables de entorno." }),
    };
  }

  // ── Validar campos requeridos ──────────────────────────────────────
  const { system, messages, mcp_servers } = payload;
  if (!messages || !Array.isArray(messages)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Campo 'messages' requerido y debe ser un array." }),
    };
  }

  // ── Construir request a Anthropic ──────────────────────────────────
  const anthropicBody = {
    model: "claude-sonnet-4-6",          // modelo vigente a 2026
    max_tokens: 1000,
    messages,
    ...(system && { system }),
    ...(mcp_servers && { mcp_servers }),
  };

  // ── Llamada a Anthropic ────────────────────────────────────────────
  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicBody),
    });
  } catch (err) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Error de red al contactar Anthropic: " + err.message }),
    };
  }

  const data = await response.json();

  // ── Error de Anthropic ─────────────────────────────────────────────
  if (!response.ok) {
    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify({ error: data?.error?.message || "Error de Anthropic API" }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(data),
  };
};
