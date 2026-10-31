// Genera docs/Documentacion-Distribuidora.pdf a partir de README.md y docs/*.md:
// portada, índice, un capítulo por documento, diagramas Mermaid dibujados, capturas y números de página.
//   npm run docs:pdf
// Usa Chrome/Edge instalado (o CHROME_PATH) a través de playwright-core; no necesita internet.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { Marked } = require("marked");
const { chromium } = require("playwright-core");

const RAIZ = path.resolve(__dirname, "..", "..");
const SALIDA = path.join(RAIZ, "docs", "Documentacion-Distribuidora.pdf");
const TEMPORAL = path.join(__dirname, ".documento.html");
const REPO = "https://github.com/kredlml/distribuidora-backend/blob/master/";

const PORTADA = {
  universidad: "Universidad Mariano Gálvez de Guatemala",
  curso: "Desarrollo Web",
  catedratico: "Elmer Josué Esteban Chilel",
  integrantes: ["Oswaldo Guanche Juárez", "Carlos Daniel Rojas", "Kimberly Alejandra Yol Ixpata"],
  titulo: "Sistema Distribuidora",
  subtitulo: "Documentación técnica y manual de usuario",
  fecha: "Octubre de 2026",
};

// Capítulos en orden: [archivo, id, título en el índice]
const CAPITULOS = [
  ["README.md", "cap-00", "Presentación del proyecto"],
  ["docs/01-arquitectura.md", "cap-01", null],
  ["docs/02-modelo-de-datos.md", "cap-02", null],
  ["docs/03-roles-y-permisos.md", "cap-03", null],
  ["docs/04-reglas-de-negocio.md", "cap-04", null],
  ["docs/05-api.md", "cap-05", null],
  ["docs/06-manual-de-usuario.md", "cap-06", null],
  ["docs/07-seguridad.md", "cap-07", null],
  ["docs/08-pruebas.md", "cap-08", null],
  ["docs/09-despliegue-y-operacion.md", "cap-09", null],
];
const idDeArchivo = Object.fromEntries(CAPITULOS.map(([a, id]) => [path.basename(a), id]));

const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Mismo criterio que GitHub para los anclas de los títulos.
const slug = (t) => t.toLowerCase().trim().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

function capitulo([archivo, id, tituloFijo]) {
  const ruta = path.join(RAIZ, archivo);
  const dir = path.dirname(ruta);
  const md = fs.readFileSync(ruta, "utf8");
  const secciones = [];
  let titulo = tituloFijo;
  const vistos = {};

  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const texto = this.parser.parseInline(tokens);
        const plano = texto.replace(/<[^>]+>/g, "");
        let base = slug(plano);
        vistos[base] = (vistos[base] || 0) + 1;
        if (vistos[base] > 1) base = `${base}-${vistos[base] - 1}`;
        if (depth === 1 && !titulo) titulo = plano;
        // El índice general no repite la lista "Contenido" de cada documento.
        if (depth === 2 && plano.trim().toLowerCase() !== "contenido") secciones.push({ id: `${id}-${base}`, texto: plano });
        return `<h${depth} id="${id}-${base}">${texto}</h${depth}>\n`;
      },
      code({ text, lang }) {
        if ((lang || "").trim() === "mermaid") return `<pre class="mermaid">${escapar(text)}</pre>\n`;
        return `<pre class="codigo"><code>${escapar(text)}</code></pre>\n`;
      },
      link({ href, title, tokens }) {
        const texto = this.parser.parseInline(tokens);
        return `<a href="${escapar(enlace(href, dir, id))}"${title ? ` title="${escapar(title)}"` : ""}>${texto}</a>`;
      },
      image({ href, text }) {
        const src = /^(https?:|data:)/.test(href) ? href : pathToFileURL(path.resolve(dir, decodeURI(href))).href;
        return `<figure><img src="${escapar(src)}" alt="${escapar(text)}"><figcaption>${escapar(text)}</figcaption></figure>`;
      },
    },
  });
  const html = marked.parse(md);
  return { id, titulo: titulo || archivo, secciones, html };
}

// Enlaces: a otro .md → ancla del capítulo; #sección → ancla con prefijo; otros archivos → GitHub.
function enlace(href, dir, idActual) {
  if (!href || /^(https?:|mailto:)/.test(href)) return href;
  if (href.startsWith("#")) return `#${idActual}-${href.slice(1)}`;
  const [ruta, frag] = href.split("#");
  const base = path.basename(ruta);
  if (base.endsWith(".md") && idDeArchivo[base]) return frag ? `#${idDeArchivo[base]}-${frag}` : `#${idDeArchivo[base]}`;
  const absoluto = path.resolve(dir, ruta);
  return REPO + path.relative(RAIZ, absoluto).split(path.sep).join("/") + (frag ? `#${frag}` : "");
}

const CSS = `
  @page { size: Letter; margin: 22mm 18mm 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1d1d1f; margin: 0; }
  h1 { font-size: 21pt; color: #2b1a8f; border-bottom: 2px solid #5433eb; padding-bottom: 6px; margin: 0 0 14px; }
  h2 { font-size: 14.5pt; color: #2b1a8f; margin: 22px 0 8px; break-after: avoid; }
  h3 { font-size: 12pt; margin: 16px 0 6px; break-after: avoid; }
  h4 { font-size: 11pt; margin: 12px 0 4px; }
  p, li { orphans: 3; widows: 3; }
  a { color: #3d23c9; text-decoration: none; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 9pt; background: #f2f1f8; padding: 1px 4px; border-radius: 3px; }
  pre.codigo { background: #f6f6fa; border: 1px solid #e2e0ef; border-radius: 6px; padding: 9px 11px; font-size: 8.6pt; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
  pre.codigo code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; font-size: 8.8pt; break-inside: auto; }
  th, td { border: 1px solid #d6d3e6; padding: 4px 6px; text-align: left; vertical-align: top; word-break: break-word; }
  th { background: #eeebfb; }
  tr { break-inside: avoid; }
  blockquote { border-left: 4px solid #5433eb; margin: 10px 0; padding: 4px 12px; background: #f7f6fd; color: #333; }
  figure { margin: 12px 0 16px; text-align: center; break-inside: avoid; }
  figure img { max-width: 100%; max-height: 120mm; border: 1px solid #d6d3e6; border-radius: 6px; }
  figcaption { font-size: 8.8pt; color: #555; margin-top: 4px; font-style: italic; }
  pre.mermaid { text-align: center; margin: 12px 0 16px; break-inside: avoid; background: none; border: none; }
  pre.mermaid svg { max-width: 100% !important; height: auto; max-height: 200mm; }
  .capitulo { break-before: page; }
  .portada { height: 235mm; display: flex; flex-direction: column; justify-content: space-between; text-align: center; padding-top: 6mm; }
  .portada .u { font-size: 16pt; font-weight: 600; color: #2b1a8f; letter-spacing: .5px; }
  .portada .curso { font-size: 12pt; margin-top: 6px; }
  .portada .titulo { font-size: 30pt; font-weight: 700; color: #2b1a8f; margin: 0; }
  .portada .sub { font-size: 14pt; color: #444; margin-top: 8px; }
  .portada .linea { width: 60%; margin: 18px auto; border-top: 3px solid #5433eb; }
  .portada table { width: 70%; margin: 0 auto; font-size: 11pt; }
  .portada td { border: none; padding: 3px 6px; }
  .portada td:first-child { text-align: right; color: #555; width: 40%; }
  .portada .urls { font-size: 9.5pt; color: #444; }
  .indice { break-before: page; }
  .indice > ol { padding-left: 28px; }
  .indice > ol > li { font-weight: 600; margin-top: 8px; break-inside: avoid; }
  /* Las secciones ya traen su número ("1. Visión general"): sin numeración extra. */
  .indice ol ol { list-style: none; font-weight: 400; font-size: 9.6pt; margin: 2px 0 0; padding-left: 12px; }
`;

function documento(caps) {
  const integrantes = PORTADA.integrantes.map((n) => escapar(n)).join("<br>");
  const portada = `
  <section class="portada">
    <div><div class="u">${escapar(PORTADA.universidad)}</div><div class="curso">Curso: ${escapar(PORTADA.curso)}</div></div>
    <div><div class="linea"></div><p class="titulo">${escapar(PORTADA.titulo)}</p><div class="sub">${escapar(PORTADA.subtitulo)}</div><div class="linea"></div></div>
    <table>
      <tr><td>Catedrático:</td><td><b>${escapar(PORTADA.catedratico)}</b></td></tr>
      <tr><td>Integrantes:</td><td>${integrantes}</td></tr>
      <tr><td>Fecha:</td><td>${escapar(PORTADA.fecha)}</td></tr>
    </table>
    <div class="urls">Tienda: https://distribuidora-tienda.onrender.com · Panel: https://distribuidora-panel.onrender.com<br>
      Repositorio: https://github.com/kredlml/distribuidora-backend</div>
  </section>`;
  const indice = `
  <section class="indice"><h1>Índice</h1><ol>
    ${caps.map((c) => `<li><a href="#${c.id}">${escapar(c.titulo)}</a>${c.secciones.length ? `<ol>${c.secciones.map((s) => `<li><a href="#${s.id}">${escapar(s.texto)}</a></li>`).join("")}</ol>` : ""}</li>`).join("\n")}
  </ol></section>`;
  const cuerpo = caps.map((c) => `<section class="capitulo" id="${c.id}">${c.html}</section>`).join("\n");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapar(PORTADA.titulo)} — Documentación</title><style>${CSS}</style></head>
  <body>${portada}${indice}${cuerpo}</body></html>`;
}

(async () => {
  const caps = CAPITULOS.map(capitulo);
  fs.writeFileSync(TEMPORAL, documento(caps));
  const browser = await chromium.launch({ executablePath: require("../../tests/soporte/chrome")(), headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(TEMPORAL).href, { waitUntil: "load" });
    await page.addScriptTag({ path: path.join(RAIZ, "node_modules", "mermaid", "dist", "mermaid.min.js") });
    const fallos = await page.evaluate(async () => {
      /* global mermaid */
      mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose", fontFamily: "Segoe UI, Arial, sans-serif" });
      const errores = [];
      const bloques = [...document.querySelectorAll("pre.mermaid")];
      for (let i = 0; i < bloques.length; i++) {
        const b = bloques[i];
        try {
          const { svg } = await mermaid.render(`diagrama-${i}`, b.textContent);
          b.innerHTML = svg;
        } catch (e) {
          const cap = b.closest("section.capitulo");
          errores.push(`${cap ? cap.id : "?"}: ${String(e.message || e).split("\n")[0]}`);
          b.outerHTML = `<pre class="codigo"><code>${b.innerHTML}</code></pre>`;
        }
      }
      return { total: bloques.length, errores };
    });
    await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((ok) => { i.onload = i.onerror = ok; })))));
    const rotas = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")));
    await page.pdf({
      path: SALIDA, format: "Letter", printBackground: true, preferCSSPageSize: true, outline: true, tagged: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7.5pt;color:#888;width:100%;padding:0 18mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial"><span>${escapar(PORTADA.titulo)} — Documentación</span><span>${escapar(PORTADA.universidad)}</span></div>`,
      footerTemplate: `<div style="font-size:7.5pt;color:#888;width:100%;padding:0 18mm;text-align:right;font-family:Segoe UI,Arial">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`,
    });
    const kb = (fs.statSync(SALIDA).size / 1024).toFixed(0);
    console.log(`PDF generado: ${SALIDA} (${kb} KB)`);
    console.log(`Diagramas: ${fallos.total - fallos.errores.length}/${fallos.total} dibujados.`);
    if (fallos.errores.length) { console.log("Diagramas con error:\n - " + fallos.errores.join("\n - ")); process.exitCode = 1; }
    if (rotas.length) { console.log("Imágenes que no cargaron:\n - " + rotas.join("\n - ")); process.exitCode = 1; }
  } finally {
    await browser.close();
    // MANTENER_HTML=1 deja el HTML intermedio (para revisar el diseño).
    if (!process.env.MANTENER_HTML) fs.rmSync(TEMPORAL, { force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
