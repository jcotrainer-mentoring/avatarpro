/**
 * netlify/functions/claude-proxy.js
 * Avatar Pro — JCOTRAINER
 *
 * Proxy serverless que mantiene la API key de Anthropic en el servidor.
 * El frontend NUNCA ve la key. Además exige una clave de acceso, validada
 * contra el almacén de códigos en Netlify Blobs (ver lib/codigos.js y
 * netlify/functions/admin.js, el panel que genera y administra esos códigos).
 *
 * ACCESS_CODES ya no es la fuente de verdad: sólo se lee una vez, en el
 * primer arranque después del despliegue, para sembrar el código compartido
 * que hoy circula (ver asegurarSemillaLegacy en lib/codigos.js).
 *
 * Variables de entorno en Netlify:
 *   ANTHROPIC_API_KEY  → tu API key de Anthropic
 *   ADMIN_ACCESS_KEY   → clave del panel de administración (netlify/functions/admin.js)
 */

const { getStore } = require("@netlify/blobs");
const { NOMBRE_STORE, asegurarSemillaLegacy, estadoCodigo } = require("../../lib/codigos.js");

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

  // ── Validar la clave enviada por el navegador contra Blobs ─────────
  // Las Functions normales no reciben el contexto de Blobs automáticamente
  // cuando el deploy se hace por CLI (bug conocido de Netlify) — se
  // configura a mano con un Personal Access Token guardado en BLOBS_TOKEN.
  const provided = (event.headers["x-access-code"] || "").trim();
  const store = getStore({ name: NOMBRE_STORE, siteID: process.env.SITE_ID, token: process.env.BLOBS_TOKEN });
  await asegurarSemillaLegacy(store, process.env.ACCESS_CODES);

  const estado = provided ? await estadoCodigo(store, provided) : "invalido";
  if (estado !== "ok") {
    if (estado !== "vencido") {
      await new Promise((resolve) => setTimeout(resolve, 800)); // frena intentos repetidos
    }
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify(
        estado === "vencido"
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
