/**
 * netlify/functions/claude-proxy.js
 * Avatar Pro — JCOTRAINER
 *
 * Proxy serverless que mantiene la API key de Anthropic en el servidor.
 * El frontend NUNCA ve la key. Soporta CORS para el dominio de Netlify.
 */

exports.handler = async (event) => {
  // ── Solo POST ──────────────────────────────────────────────────────
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // ── CORS headers ───────────────────────────────────────────────────
  const headers = {
    "Access-Control-Allow-Origin": "*",          // en producción cambia a tu dominio
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // ── Preflight OPTIONS ──────────────────────────────────────────────
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  // ── Validar API key configurada ────────────────────────────────────
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada en variables de entorno." }),
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
