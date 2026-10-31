const fs = require("fs");
const path = require("path");

// Envío de correos. Modos (CORREO_MODO):
//  - "smtp": por SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS). Es el modo por defecto si hay SMTP_HOST.
//  - "consola": no envía; muestra en consola a quién y qué se habría enviado (por defecto sin SMTP).
//  - "archivo": guarda cada correo como JSON en CORREO_CARPETA (lo usan las pruebas).
// Enviar nunca lanza: un correo que falla no debe romper una venta ni un pago.
const MODO = process.env.CORREO_MODO || (process.env.SMTP_HOST ? "smtp" : "consola");
const REMITENTE = process.env.CORREO_REMITENTE || "Distribuidora <no-responder@distribuidora.local>";
const TIENDA_URL = (process.env.TIENDA_URL || "http://localhost:8082").replace(/\/+$/, "");
const PRODUCCION = process.env.NODE_ENV === "production";

// En producción, sin SMTP las clientas no reciben nada (ni el enlace de «olvidé mi contraseña») y
// sin TIENDA_URL los enlaces apuntarían a localhost: se avisa fuerte al arrancar.
if (PRODUCCION && MODO === "consola") console.error("[correo] ATENCIÓN: no hay SMTP configurado (SMTP_HOST…): en producción NO se envía ningún correo.");
if (PRODUCCION && !process.env.TIENDA_URL) console.error("[correo] ATENCIÓN: falta TIENDA_URL: los enlaces de los correos apuntarían a localhost.");

let transporte = null;
function smtp() {
  if (!transporte) {
    const nodemailer = require("nodemailer");
    const puerto = Number(process.env.SMTP_PORT) || 587;
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: puerto, secure: puerto === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  return transporte;
}

const escapar = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Plantilla común: título, párrafos (texto plano, se escapa), un botón opcional y el pie.
function plantilla({ titulo, parrafos = [], boton }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f2f4f5;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:20px;padding:28px">
      <div style="font-size:20px;margin-bottom:16px">Distribuidora<span style="color:#5433eb">.</span></div>
      <h1 style="font-size:20px;font-weight:normal;margin:0 0 12px">${escapar(titulo)}</h1>
      ${parrafos.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${escapar(p)}</p>`).join("")}
      ${boton ? `<p style="margin:20px 0 4px"><a href="${escapar(boton.url)}" style="background:#5433eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;display:inline-block">${escapar(boton.texto)}</a></p>` : ""}
    </div>
    <p style="font-size:12px;color:#787574;text-align:center;margin-top:16px">Este correo se envió automáticamente; no respondas a esta dirección.</p>
  </div></body></html>`;
  const texto = [titulo, "", ...parrafos, ...(boton ? ["", `${boton.texto}: ${boton.url}`] : [])].join("\n");
  return { html, texto };
}

// Solo direcciones simples (sin comillas, comentarios, ";", "<" ni ">"): así ningún correo guardado
// puede aprovechar los fallos del parser de direcciones de nodemailer < 10.1.4
// (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h) para mandar a otro destinatario.
const DIRECCION_SIMPLE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

async function enviar({ para, asunto, titulo, parrafos, boton, etiqueta }) {
  if (!para) return false;
  if (!DIRECCION_SIMPLE.test(String(para)) || String(para).length > 120) {
    console.warn(`[correo] Dirección no admitida para envío; se omite "${asunto}".`);
    return false;
  }
  const { html, texto } = plantilla({ titulo: titulo || asunto, parrafos, boton });
  try {
    if (MODO === "archivo") {
      const carpeta = process.env.CORREO_CARPETA || path.join(process.cwd(), "correos");
      fs.mkdirSync(carpeta, { recursive: true });
      const nombre = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
      fs.writeFileSync(path.join(carpeta, nombre), JSON.stringify({ para, asunto, texto, html, etiqueta, boton: boton || null, fecha: new Date() }, null, 2));
    } else if (MODO === "smtp") {
      await smtp().sendMail({ from: REMITENTE, to: { name: "", address: para }, subject: asunto, text: texto, html });
    } else {
      // En desarrollo se muestra el enlace (sirve para probar sin SMTP); en producción nunca: un
      // enlace de restablecimiento en los logs permitiría tomar la cuenta.
      const enlace = boton ? (PRODUCCION ? boton.url.split("?")[0] : boton.url) : "";
      console.log(`[correo] (sin SMTP configurado) Para: ${para} | ${asunto}${enlace ? ` | ${enlace}` : ""}`);
    }
    return true;
  } catch (error) {
    console.warn(`[correo] No se pudo enviar "${asunto}" a ${para}: ${error.message}`);
    return false;
  }
}

// Validación de correos para registrar cuentas y clientes: la misma que se usa al enviar, así
// nunca se acepta una dirección a la que después no se podría escribir.
const EMAIL_VALIDO = DIRECCION_SIMPLE;

module.exports = { enviar, TIENDA_URL, MODO, EMAIL_VALIDO };
