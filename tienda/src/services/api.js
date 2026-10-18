import { API_URL } from "../config/env";
import { leerSesion } from "./session";

let onUnauthorized = () => {};
/** El AuthProvider registra aquí qué hacer cuando el token expira. */
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = "GET", body } = {}) {
  const s = leerSesion();
  let r;
  try {
    r = await fetch(API_URL + path, {
      method,
      headers: { "Content-Type": "application/json", ...(s ? { Authorization: "Bearer " + s.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("No pudimos conectar con la tienda. Revisa tu conexión e inténtalo de nuevo.");
  }
  let data = null;
  try { data = await r.json(); } catch { /* respuesta sin JSON */ }
  if (!r.ok) {
    const msg = (data && data.message) || `Error ${r.status}`;
    if (s && (r.status === 401 || (r.status === 403 && /token/i.test(msg)))) onUnauthorized();
    throw new Error(msg);
  }
  return data;
}
