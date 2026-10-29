import { api } from "./api";

let configCache = null;
/** Si la subida de fotos está activada en el backend (se consulta una vez por sesión de la página). */
export const config = () => (configCache ||= api("/api/imagenes/config").catch((e) => { configCache = null; throw e; }));

export const TIPOS = ["image/jpeg", "image/png", "image/webp"];

/**
 * Sube una foto directo a Cloudinary con el permiso firmado que entrega el backend y devuelve su URL.
 * La clave secreta nunca pasa por el navegador.
 */
export async function subir(archivo) {
  if (!TIPOS.includes(archivo.type)) throw new Error("La foto debe ser JPG, PNG o WebP.");
  const f = await api("/api/imagenes/firma", { method: "POST" });
  if (archivo.size > f.max_mb * 1024 * 1024) throw new Error(`La foto pesa más de ${f.max_mb} MB. Usa una más liviana.`);
  const datos = new FormData();
  datos.append("file", archivo);
  for (const k of ["api_key", "timestamp", "signature", "folder", "allowed_formats"]) datos.append(k, f[k]);
  let r;
  try {
    r = await fetch(f.upload_url, { method: "POST", body: datos });
  } catch {
    throw new Error("No se pudo conectar con el servicio de fotos. Revisa tu conexión.");
  }
  const res = await r.json().catch(() => ({}));
  if (!r.ok || !res.secure_url) throw new Error((res.error && res.error.message) || "No se pudo subir la foto.");
  return res.secure_url;
}

/** Fotos subidas que no se guardaron: el backend borra solo las que ninguna prenda usa. */
export const descartar = (urls) => (urls.length ? api("/api/imagenes/descartar", { method: "POST", body: { urls } }).catch(() => {}) : Promise.resolve());

/** Versión optimizada de una foto de Cloudinary (formato y calidad automáticos, ancho dado). */
export const optimizada = (url, ancho = 400) =>
  url && /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url)
    ? url.replace("/image/upload/", `/image/upload/f_auto,q_auto,c_limit,w_${ancho}/`)
    : url;
