const crypto = require("crypto");

// Fotos de las prendas en Cloudinary. El navegador sube la foto DIRECTO a Cloudinary con una firma
// que genera este backend (la clave secreta nunca sale del servidor); en la base solo se guarda la
// URL (Producto.imagen_url). Sin las tres variables el panel solo permite pegar un enlace.
const CLOUD_NAME = (process.env.CLOUDINARY_CLOUD_NAME || "").trim();
const API_KEY = (process.env.CLOUDINARY_API_KEY || "").trim();
const API_SECRET = (process.env.CLOUDINARY_API_SECRET || "").trim();
const API_BASE = (process.env.CLOUDINARY_API_BASE || "https://api.cloudinary.com").replace(/\/+$/, "");
const CARPETA = "distribuidora/prendas";
const FORMATOS = "jpg,jpeg,png,webp";
const MAX_MB = 5;

const configurado = () => !!(CLOUD_NAME && API_KEY && API_SECRET);

// Firma de Cloudinary: parámetros ordenados "a=1&b=2" + secreto, en SHA-1.
function firmar(params) {
  const texto = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(texto + API_SECRET).digest("hex");
}

// Datos para que el navegador suba una foto a la carpeta de prendas.
function firmaDeSubida() {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { allowed_formats: FORMATOS, folder: CARPETA, timestamp };
  return {
    upload_url: `${API_BASE}/v1_1/${CLOUD_NAME}/image/upload`,
    api_key: API_KEY, signature: firmar(params), max_mb: MAX_MB, ...params
  };
}

// public_id de una foto NUESTRA (de este cloud y de la carpeta de prendas), o null si la URL es de
// otro sitio (enlaces pegados a mano: esos no se borran nunca).
// Ej.: https://res.cloudinary.com/<cloud>/image/upload/v1712/distribuidora/prendas/abc123.jpg
function publicIdDe(url) {
  if (!url || !CLOUD_NAME) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== "res.cloudinary.com") return null;
  const partes = u.pathname.split("/").filter(Boolean);
  if (partes[0] !== CLOUD_NAME || partes[1] !== "image" || partes[2] !== "upload") return null;
  const resto = partes.slice(3);
  const inicio = resto.findIndex((p, i) => p === "distribuidora" && resto[i + 1] === "prendas");
  if (inicio < 0) return null;
  const id = resto.slice(inicio).join("/").replace(/\.[a-z0-9]+$/i, "");
  return /^distribuidora\/prendas\/[\w-]+$/.test(id) ? id : null;
}

// Borra una foto nuestra de Cloudinary. Nunca lanza: si falla, la foto queda huérfana (no rompe nada).
async function destruir(url) {
  const public_id = publicIdDe(url);
  if (!public_id || !configurado()) return false;
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const cuerpo = new URLSearchParams({ public_id, timestamp: String(timestamp), api_key: API_KEY, signature: firmar({ public_id, timestamp }) });
    const r = await fetch(`${API_BASE}/v1_1/${CLOUD_NAME}/image/destroy`, { method: "POST", body: cuerpo });
    const data = await r.json().catch(() => ({}));
    return r.ok && data.result === "ok";
  } catch (error) {
    console.warn(`[cloudinary] No se pudo borrar ${public_id}: ${error.message}`);
    return false;
  }
}

module.exports = { configurado, firmaDeSubida, publicIdDe, destruir, CLOUD_NAME, MAX_MB, firmar };
