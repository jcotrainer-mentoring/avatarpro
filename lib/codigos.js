// lib/codigos.js
//
// Códigos de acceso guardados en Netlify Blobs (store "codigos"), con el
// nombre del alumno y la fecha de vencimiento. Reemplaza a la variable de
// entorno ACCESS_CODES como fuente de verdad.
//
// Cada código se guarda con su propio valor como clave del blob:
//   { nombre, codigo, creado: "AAAA-MM-DD", vence: "AAAA-MM-DD", revocado }

const NOMBRE_STORE = "codigos";
const CLAVE_SEMILLA = "_meta_semilla_legacy";

function hoyEnChile() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" });
}

function sumarDias(fechaISO, dias) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const fecha = new Date(Date.UTC(y, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

function normalizar(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function codigoAleatorio(nombre) {
  const base = normalizar(nombre).slice(0, 20) || "alumno";
  const sufijo = Math.random().toString(36).slice(2, 6);
  return `${base}-${sufijo}`;
}

// Siembra, una sola vez, el código compartido que hoy vive en ACCESS_CODES,
// con vencimiento fijo a 30 días desde la primera vez que esto corre. No
// hace nada si ya se sembró antes, ni si ACCESS_CODES está vacía.
async function asegurarSemillaLegacy(store, accessCodesRaw) {
  const yaSembrado = await store.get(CLAVE_SEMILLA, { type: "json" });
  if (yaSembrado) return;

  const raw = String(accessCodesRaw || "").trim();
  if (raw) {
    const hoy = hoyEnChile();
    const vence = sumarDias(hoy, 30);
    const codigos = raw
      .split(/[,;\s]+/)
      .map((entrada) => entrada.split(":")[0].trim())
      .filter(Boolean);

    for (const codigo of codigos) {
      const existente = await store.get(codigo, { type: "json" });
      if (!existente) {
        await store.setJSON(codigo, {
          nombre: "código antiguo compartido",
          codigo,
          creado: hoy,
          vence,
          revocado: false,
        });
      }
    }
  }

  await store.setJSON(CLAVE_SEMILLA, { sembrado: true, fecha: hoyEnChile() });
}

// Devuelve "ok", "vencido" o "invalido".
async function estadoCodigo(store, codigo) {
  const entrada = await store.get(codigo, { type: "json" });
  if (!entrada) return "invalido";
  if (entrada.revocado) return "vencido";
  if (entrada.vence && hoyEnChile() > entrada.vence) return "vencido";
  return "ok";
}

async function crearCodigo(store, nombre, dias) {
  const hoy = hoyEnChile();
  const vence = sumarDias(hoy, dias);

  let codigo = codigoAleatorio(nombre);
  // Evita colisiones improbables con un código ya existente.
  for (let intentos = 0; intentos < 5 && (await store.get(codigo, { type: "json" })); intentos++) {
    codigo = codigoAleatorio(nombre);
  }

  const entrada = { nombre, codigo, creado: hoy, vence, revocado: false };
  await store.setJSON(codigo, entrada);
  return entrada;
}

async function listarCodigos(store) {
  const hoy = hoyEnChile();
  const { blobs } = await store.list();
  const entradas = [];
  for (const { key } of blobs) {
    if (key === CLAVE_SEMILLA) continue;
    const entrada = await store.get(key, { type: "json" });
    if (!entrada) continue;
    const estado = entrada.revocado ? "revocado" : hoy > entrada.vence ? "vencido" : "activo";
    entradas.push({ ...entrada, estado });
  }
  entradas.sort((a, b) => (a.creado < b.creado ? 1 : -1));
  return entradas;
}

async function revocarCodigo(store, codigo) {
  const entrada = await store.get(codigo, { type: "json" });
  if (!entrada) return false;
  entrada.revocado = true;
  await store.setJSON(codigo, entrada);
  return true;
}

export {
  NOMBRE_STORE,
  hoyEnChile,
  asegurarSemillaLegacy,
  estadoCodigo,
  crearCodigo,
  listarCodigos,
  revocarCodigo,
};
