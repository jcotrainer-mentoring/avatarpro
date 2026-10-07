/**
 * netlify/functions/admin.js
 * Avatar Pro — JCOTRAINER
 *
 * Backend del panel de administración de códigos de acceso (public/admin).
 * Protegido con una clave simple en la variable de entorno ADMIN_ACCESS_KEY
 * (nada que ver con los códigos de los alumnos).
 *
 * POST /.netlify/functions/admin
 *   headers: { "x-admin-key": "..." }
 *   body: { op: "crear",    nombre, dias }
 *       | { op: "listar" }
 *       | { op: "revocar",  codigo }
 */

const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");
const {
  NOMBRE_STORE,
  asegurarSemillaLegacy,
  crearCodigo,
  listarCodigos,
  revocarCodigo,
} = require("../../lib/codigos.js");

function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function claveValida(recibida) {
  const esperada = process.env.ADMIN_ACCESS_KEY || "";
  if (!esperada || !recibida) return false;
  const a = Buffer.from(String(recibida));
  const b = Buffer.from(esperada);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  if (!process.env.ADMIN_ACCESS_KEY) {
    return json(500, { error: "ADMIN_ACCESS_KEY no configurada en variables de entorno." });
  }

  if (!claveValida(event.headers["x-admin-key"])) {
    return json(401, { error: "Clave de administrador inválida." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Body inválido — se esperaba JSON." });
  }

  // Las Functions normales (a diferencia de las Edge Functions) no reciben
  // el contexto de Blobs automáticamente cuando el deploy se hace por CLI
  // (bug conocido de Netlify) — se configura a mano con un Personal Access
  // Token guardado en BLOBS_TOKEN.
  const store = getStore({ name: NOMBRE_STORE, siteID: process.env.SITE_ID, token: process.env.BLOBS_TOKEN });
  await asegurarSemillaLegacy(store, process.env.ACCESS_CODES);

  if (body.op === "crear") {
    const nombre = String(body.nombre || "").trim().slice(0, 80);
    const dias = Number(body.dias);
    if (!nombre) return json(400, { error: "Falta el nombre del alumno." });
    if (!Number.isInteger(dias) || dias < 1 || dias > 3650) {
      return json(400, { error: "Los días de validez deben ser un número entero entre 1 y 3650." });
    }
    const entrada = await crearCodigo(store, nombre, dias);
    return json(200, entrada);
  }

  if (body.op === "listar") {
    const entradas = await listarCodigos(store);
    return json(200, { codigos: entradas });
  }

  if (body.op === "revocar") {
    const codigo = String(body.codigo || "").trim();
    if (!codigo) return json(400, { error: "Falta el código a revocar." });
    const ok = await revocarCodigo(store, codigo);
    if (!ok) return json(404, { error: "Ese código no existe." });
    return json(200, { ok: true });
  }

  return json(400, { error: "Operación desconocida." });
};
