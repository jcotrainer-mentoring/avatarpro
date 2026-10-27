// netlify/edge-functions/claude-proxy.js
// Avatar Pro — JCOTRAINER
//
// POST /api/claude
//   headers: { "x-access-code": "..." }
//   body: { check: true }                    → sólo valida el código de acceso
//       | { system?, messages, mcp_servers? } → consulta a la IA
//
// Mantiene la API key de Anthropic en el servidor: el frontend NUNCA la ve.
// Exige además un código de acceso válido, que se valida contra el almacén de
// Netlify Blobs (ver lib/codigos.js y netlify/edge-functions/admin.js).
//
// Es Edge Function y no Function normal POR UNA RAZÓN, no por gusto:
//
// Las Functions normales de este sitio nunca recibieron el contexto de Blobs
// solas, así que esto usaba `getStore({ siteID, token })` con un Personal
// Access Token de la cuenta guardado en BLOBS_TOKEN. Ese token venció el
// 2026-10-26 y dejó caído el panel de administración. Acá no llegó a pasar,
// pero era cuestión de tiempo — y acá el costo habría sido peor: los alumnos
// sin poder usar la herramienta.
//
// Las Edge Functions reciben ese contexto solas, por otra vía. Sin token, no
// hay token que vencer.
//
// Corre en Deno, no en Node: `Netlify.env.get(...)` en vez de `process.env`.
//
// Variables de entorno en Netlify:
//   ANTHROPIC_API_KEY  → la API key de Anthropic
//   ACCESS_CODES       → ya no es la fuente de verdad: se lee una sola vez
//                        para sembrar el código antiguo compartido en Blobs

import { getStore } from "@netlify/blobs";
import {
  NOMBRE_STORE,
  asegurarSemillaLegacy,
  estadoCodigo,
  registrarUso,
} from "../../lib/codigos.js";

const MODELO = "claude-sonnet-4-6";
const MAX_TOKENS = 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-access-code",
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: CORS });
  }

  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const codigo = (request.headers.get("x-access-code") || "").trim();

  // `consistency: "strong"` a propósito: un código recién creado en el panel
  // tiene que servir de inmediato. Con la consistencia eventual que Blobs usa
  // por defecto, el alumno al que le acabás de mandar su código podía recibir
  // "clave inválida" — y el error te haría dudar del código, no de esto.
  const store = getStore({ name: NOMBRE_STORE, consistency: "strong" });
  await asegurarSemillaLegacy(store, Netlify.env.get("ACCESS_CODES"));

  const estado = codigo ? await estadoCodigo(store, codigo) : "invalido";
  if (estado !== "ok") {
    // Medio segundo largo de espera para que probar códigos al azar salga
    // caro. No se aplica al código vencido: ése ya se sabe que era de alguien
    // real, y hacerlo esperar sólo empeora el momento en que descubre que se
    // le acabó el acceso.
    if (estado !== "vencido") {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    return json(401,
      estado === "vencido"
        ? { error: "Tu acceso venció.", reason: "expired" }
        : { error: "Clave de acceso inválida.", reason: "invalid" }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "Body inválido — se esperaba JSON." });
  }

  // Sólo verificar el código: no llama a Anthropic, así que no cuesta nada.
  if (payload && payload.check === true) {
    return json(200, { ok: true });
  }

  const ANTHROPIC_API_KEY = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return json(500, { error: "ANTHROPIC_API_KEY no configurada en variables de entorno." });
  }

  const { system, messages, mcp_servers } = payload;
  if (!messages || !Array.isArray(messages)) {
    return json(400, { error: "Campo 'messages' requerido y debe ser un array." });
  }

  const cuerpo = {
    model: MODELO,
    max_tokens: MAX_TOKENS,
    messages,
    ...(system && { system }),
    ...(mcp_servers && { mcp_servers }),
  };

  let respuesta;
  try {
    respuesta = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(cuerpo),
    });
  } catch (err) {
    return json(502, { error: "Error de red al contactar Anthropic: " + err.message });
  }

  const data = await respuesta.json();

  if (!respuesta.ok) {
    return json(respuesta.status, { error: data?.error?.message || "Error de Anthropic API" });
  }

  // Recién acá se sabe que la generación de verdad ocurrió (Anthropic
  // respondió bien) — por eso el contador vive aquí y no antes, al validar el
  // código, ni en el "check" de sólo verificar acceso.
  await registrarUso(store, codigo);

  return json(200, data);
};
