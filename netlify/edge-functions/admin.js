// netlify/edge-functions/admin.js
// Avatar Pro — JCOTRAINER
//
// Backend del panel de administración de códigos de acceso (public/admin).
// Protegido con una clave simple en la variable de entorno ADMIN_ACCESS_KEY
// (nada que ver con los códigos de los alumnos).
//
// POST /api/admin
//   headers: { "x-admin-key": "..." }
//   body: { op: "crear",    nombre, dias }
//       | { op: "listar" }
//       | { op: "revocar",  codigo }
//
// Es Edge Function y no Function normal POR UNA RAZÓN, no por gusto:
//
// Las Functions normales de este sitio nunca recibieron el contexto de Blobs
// solas —se probó por CLI, por build de Git, en ESM, y forzando
// use_edge_functions, sin efecto— así que esta misma lógica vivía con
// `getStore({ siteID, token })` y un Personal Access Token de la cuenta
// guardado en BLOBS_TOKEN. Ese token venció el 2026-10-26 y tiró el panel
// entero: Blobs respondía 401 y no se podía crear ni revocar ningún código.
//
// Las Edge Functions reciben ese contexto por otra vía (`globalThis`). En el
// sitio hermano (Guion de Consulta) la Edge Function que atiende a los alumnos
// siguió funcionando perfecto durante esa misma caída, y por eso el panel se
// movió acá: no se le pasa ni siteID ni token a `getStore`, no hay token
// que vencer.
//
// OJO: esta es la primera Edge Function de este sitio. En Guion el patrón está
// probado desde hace meses; acá se verificó recién al desplegarla.
//
// Corre en Deno, no en Node: `Netlify.env.get(...)` en vez de `process.env`,
// y nada de `node:crypto` ni `Buffer`.

import { getStore } from "@netlify/blobs";
import {
  NOMBRE_STORE,
  asegurarSemillaLegacy,
  crearCodigo,
  listarCodigos,
  revocarCodigo,
} from "../../lib/codigos.js";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Comparación en tiempo constante, sin `crypto.timingSafeEqual` porque acá no
// hay Node. Se recorren SIEMPRE todos los bytes en vez de cortar en el primero
// que no coincide: salir antes haría que una clave con los primeros caracteres
// correctos tardara un pelo más en ser rechazada, y eso se puede medir y usar
// para adivinarla de a un carácter por vez.
//
// La diferencia de largo se mezcla en el mismo acumulador por lo mismo.
function claveValida(recibida) {
  const esperada = Netlify.env.get("ADMIN_ACCESS_KEY") || "";
  if (!esperada || !recibida) return false;

  const codificador = new TextEncoder();
  const a = codificador.encode(String(recibida));
  const b = codificador.encode(esperada);

  let distinto = a.length ^ b.length;
  const largo = Math.max(a.length, b.length);
  for (let i = 0; i < largo; i++) {
    distinto |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return distinto === 0;
}

export default async (request) => {
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  if (!Netlify.env.get("ADMIN_ACCESS_KEY")) {
    return json(500, { error: "ADMIN_ACCESS_KEY no configurada en variables de entorno." });
  }

  if (!claveValida(request.headers.get("x-admin-key"))) {
    return json(401, { error: "Clave de administrador inválida." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Body inválido — se esperaba JSON." });
  }

  // `consistency: "strong"` porque este panel lee lo que acaba de escribir.
  // Por defecto Blobs es eventualmente consistente, y se notó: crear un código
  // y revocarlo de inmediato devolvía "ese código no existe", porque la
  // escritura todavía no era visible para la lectura siguiente. Acá el volumen
  // es de unas pocas operaciones al día, así que la consistencia fuerte no
  // cuesta nada y evita un error que parece un bug del panel.
  const store = getStore({ name: NOMBRE_STORE, consistency: "strong" });
  await asegurarSemillaLegacy(store, Netlify.env.get("ACCESS_CODES"));

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
