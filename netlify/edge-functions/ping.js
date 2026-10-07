// Edge function mínima de diagnóstico: existe sólo para activar la capa de
// Edge Functions del sitio, a ver si eso resuelve la inyección de Blobs en
// las Functions normales (hipótesis a probar).
export default async () => new Response("ok");

export const config = { path: "/.netlify/edge-ping" };
