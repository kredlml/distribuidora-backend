/* Interfaz de Logística Inversa y Trazabilidad — HTML/CSS/JS sin dependencias. */

// ===== Configuración: dirección del backend (único lugar a cambiar) =====
const API_URL = "http://localhost:8080";

// ===== Utilidades =====
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ACENTOS = [["cambio talla", "cambio de talla"], ["cambio variante", "cambio de variante"], ["devolucion", "devolución"], ["reintegracion", "reintegración"], ["revision", "revisión"], ["danado", "dañado"], ["envio", "envío"], ["danada", "dañada"]];
const humanizar = (s) => {
  if (!s) return "—";
  let t = s.toLowerCase().replace(/_/g, " ");
  ACENTOS.forEach(([a, b]) => (t = t.split(a).join(b)));
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const fecha = (v) => {
  const d = v ? new Date(v) : null;
  return d && !isNaN(d) ? d.toLocaleString("es-GT", { dateStyle: "medium", timeStyle: "short" }) : "—";
};
const fechaDe = (x) => fecha(x.createdAt || x.fecha_movimiento || x.fecha || x.fecha_hora || x.updatedAt);
const nombreCli = (d) => (d.Cliente ? `${d.Cliente.nombre} ${d.Cliente.apellido || ""}`.trim() : `Cliente ${d.id_cliente}`);
const nombreEmp = (e) => (e ? `${e.nombre} ${e.apellido || ""}`.trim() : "Sistema");
const prod = (p) => (p ? [p.nombre, p.talla, p.color].filter(Boolean).join(" ") : "—");

const ESTADOS = {
  SOLICITADA: "Solicitada", APROBADA: "Aprobada", RECHAZADA: "Rechazada", RECIBIDA: "Recibida",
  EN_REVISION: "En revisión", ACEPTADA: "Aceptada", RECHAZADA_EN_REVISION: "Rechazada en revisión",
  REINTEGRADA: "Reintegrada", CAMBIADA: "Cambiada",
};
const TONO = { RECHAZADA: "bad", RECHAZADA_EN_REVISION: "bad", REINTEGRADA: "ok", CAMBIADA: "ok" };
const chipEstado = (e) => `<span class="st ${TONO[e] || ""}">${esc(ESTADOS[e] || e)}</span>`;

let tt;
function aviso(msg, mal) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (mal ? " bad" : "");
  clearTimeout(tt);
  tt = setTimeout(() => (t.className = ""), 4500);
}

// ===== Sesión y API =====
const sesion = () => { try { return JSON.parse(localStorage.getItem("sesion")); } catch { return null; } };
const guardarSesion = (s) => (s ? localStorage.setItem("sesion", JSON.stringify(s)) : localStorage.removeItem("sesion"));

async function api(path, { method = "GET", body } = {}) {
  const s = sesion();
  let r;
  try {
    r = await fetch(API_URL + path, {
      method,
      headers: { "Content-Type": "application/json", ...(s ? { Authorization: "Bearer " + s.token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`No se pudo conectar con el servidor (${API_URL}). Comprueba que el backend esté en marcha.`);
  }
  let data = null;
  try { data = await r.json(); } catch { /* respuesta sin JSON */ }
  if (!r.ok) {
    const msg = (data && data.message) || `Error ${r.status}`;
    if (s && (r.status === 401 || (r.status === 403 && /token/i.test(msg)))) {
      guardarSesion(null);
      aviso("Tu sesión expiró. Inicia sesión de nuevo.", true);
      ruta();
    }
    throw new Error(msg);
  }
  return data;
}

function salir() {
  guardarSesion(null);
  if (location.hash && location.hash !== "#/") location.hash = "#/"; else ruta();
}

// ===== Permisos (reflejan los roles del backend; el servidor siempre valida) =====
const PERMISOS = {
  aprobar: ["ADMIN"], rechazar: ["ADMIN"],
  recibir: ["ADMIN", "BODEGUERO"], revisar: ["ADMIN", "BODEGUERO"],
  reintegrar: ["ADMIN", "BODEGUERO"], cambiar: ["ADMIN", "BODEGUERO"],
  crear: ["ADMIN", "CAJERO"],
};
const miRol = () => ((sesion() || {}).puesto || "").trim().toUpperCase();
const puede = (a) => PERMISOS[a].includes(miRol());

const ACCION = {
  aprobar: { boton: "Aprobar", titulo: "Aprobar devolución", texto: "La solicitud pasará a Aprobada y podrá recibirse en bodega.", obs: true, ok: "aprobada" },
  rechazar: { boton: "Rechazar", titulo: "Rechazar devolución", texto: "La solicitud se cierra y sus prendas dejan de contar como devueltas.", obs: true, ok: "rechazada" },
  recibir: { boton: "Marcar como recibida", titulo: "Recibir prendas", texto: "Confirma que las prendas llegaron físicamente a la sucursal.", obs: true, ok: "recibida" },
  revisar: { boton: "Registrar inspección", titulo: "Inspección de prendas", texto: "Indica el estado de cada prenda y si la devolución se acepta.", obs: true, ok: "inspeccionada" },
  reintegrar: { boton: "Reintegrar a inventario", titulo: "Reintegrar a inventario", texto: "Cada prenda vuelve al inventario según el resultado de su inspección.", obs: false, ok: "reintegrada a inventario" },
  cambiar: { boton: "Procesar cambio", titulo: "Procesar cambio", texto: "Se descuenta la prenda nueva del inventario y se reingresa la devuelta.", obs: false, ok: "cambio procesado" },
};
function accionesDe(d) {
  switch (d.estado) {
    case "SOLICITADA": return ["aprobar", "rechazar"];
    case "APROBADA": return ["recibir"];
    case "RECIBIDA": return ["revisar"];
    case "ACEPTADA": return [d.tipo === "DEVOLUCION" ? "reintegrar" : "cambiar"];
    default: return [];
  }
}

// ===== Barra lateral =====
const ICON = {
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  out: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  go: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

function renderRail() {
  const s = sesion(), r = $("#rail");
  r.hidden = !s;
  if (!s) { r.innerHTML = ""; return; }
  const ini = ((s.nombre || "?")[0] + ((s.apellido || "")[0] || "")).toUpperCase();
  const h = location.hash, aqui = h === "#/nueva" ? "nn" : h.startsWith("#/trazabilidad") ? "nt" : h === "#/inventario" ? "ni" : "nl";
  const btn = (id, t, i) => `<button class="nav ${aqui === id ? "on" : ""}" id="${id}" title="${t}" aria-label="${t}">${svg(i)}</button>`;
  r.innerHTML =
    btn("nl", "Devoluciones", "list") + btn("nn", "Nueva solicitud", "plus") + btn("nt", "Trazabilidad", "route") + btn("ni", "Inventario", "box") +
    `<span class="sp"></span><div class="avatar" title="${esc(s.nombre)} (${esc(s.puesto || "sin puesto")})">${esc(ini)}</div>` +
    `<button class="nav" id="out" title="Cerrar sesión" aria-label="Cerrar sesión">${svg("out")}</button>`;
  $("#nl").onclick = () => (location.hash = "#/");
  $("#nn").onclick = () => (location.hash = "#/nueva");
  $("#nt").onclick = () => (location.hash = "#/trazabilidad");
  $("#ni").onclick = () => (location.hash = "#/inventario");
  $("#out").onclick = salir;
}

// ===== Router =====
function ruta() {
  renderRail();
  if (!sesion()) return vistaLogin();
  if (location.hash === "#/nueva") return vistaNueva();
  if (location.hash === "#/inventario") return vistaInventario();
  if (location.hash.startsWith("#/trazabilidad")) return vistaTraza();
  const m = location.hash.match(/^#\/devolucion\/(\d+)$/);
  return m ? vistaDetalle(m[1]) : vistaLista();
}
window.addEventListener("hashchange", ruta);

// ===== Login =====
function vistaLogin() {
  $("#app").innerHTML = `
    <section class="card login">
      <div class="mark">devoluciones<i>.</i></div>
      <p class="muted">Inicia sesión para gestionar devoluciones y cambios.</p>
      <form id="f">
        <input class="field" type="email" name="email" placeholder="Correo" autocomplete="username" required>
        <input class="field" type="password" name="password" placeholder="Contraseña" autocomplete="current-password" required>
        <div class="err" id="e" role="alert"></div>
        <button class="btn pri">Iniciar sesión</button>
      </form>
    </section>`;
  $("#f").onsubmit = async (ev) => {
    ev.preventDefault();
    const btn = ev.submitter, fd = new FormData(ev.target);
    btn.disabled = true; $("#e").textContent = "";
    try {
      const r = await api("/api/auth/login", { method: "POST", body: { email: fd.get("email"), password: fd.get("password") } });
      guardarSesion(r);
      if (location.hash && location.hash !== "#/") location.hash = "#/"; else ruta();
    } catch (e) { $("#e").textContent = e.message; btn.disabled = false; }
  };
}

// ===== Listado =====
const filtros = { estado: "", tipo: "", desde: "", hasta: "", q: "" };
let cacheLista = [];
const CHIPS = ["", "SOLICITADA", "APROBADA", "RECIBIDA", "ACEPTADA", "REINTEGRADA", "CAMBIADA", "RECHAZADA", "RECHAZADA_EN_REVISION"];

function pintarChips() {
  $("#chips").innerHTML = CHIPS.map((e) => `<button class="chip ${filtros.estado === e ? "on" : ""}" data-e="${e}">${e ? ESTADOS[e] : "Todas"}</button>`).join("");
  document.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => { filtros.estado = b.dataset.e; pintarChips(); cargarLista(); }));
}

function vistaLista() {
  const s = sesion();
  const rolValido = ["ADMIN", "CAJERO", "BODEGUERO"].includes(miRol());
  $("#app").innerHTML = `
    <div class="head">
      <div><h1>Devoluciones y cambios</h1><div class="muted sm" id="cnt">&nbsp;</div></div>
      <div class="bar"><span class="muted sm">${esc(s.nombre)}, ${esc(s.puesto || "sin puesto")}</span>${PERMISOS.crear.includes(miRol()) ? '<a class="btn pri" href="#/nueva">Nueva solicitud</a>' : ""}</div>
    </div>
    ${rolValido ? "" : `<div class="card sec err">Tu puesto no está entre ADMIN, CAJERO o BODEGUERO: podrás consultar, pero no gestionar devoluciones.</div>`}
    <div class="bar"><form class="search" id="sf"><input id="q" placeholder="Buscar por devolución, pedido o cliente" aria-label="Buscar" value="${esc(filtros.q)}"><button class="go" aria-label="Buscar">${svg("go")}</button></form></div>
    <div class="bar" id="chips"></div>
    <div class="bar">
      <select class="pill" id="tipo" aria-label="Tipo">
        <option value="">Todos los tipos</option>
        ${["DEVOLUCION", "CAMBIO_TALLA", "CAMBIO_VARIANTE"].map((t) => `<option value="${t}" ${filtros.tipo === t ? "selected" : ""}>${humanizar(t)}</option>`).join("")}
      </select>
      <label class="muted sm">Desde <input class="pill" type="date" id="d1" value="${filtros.desde}"></label>
      <label class="muted sm">Hasta <input class="pill" type="date" id="d2" value="${filtros.hasta}"></label>
    </div>
    <div class="stack" id="lista"></div>`;
  pintarChips();
  $("#sf").onsubmit = (ev) => { ev.preventDefault(); pintarLista(); };
  $("#q").oninput = (ev) => { filtros.q = ev.target.value; pintarLista(); };
  $("#tipo").onchange = (ev) => { filtros.tipo = ev.target.value; cargarLista(); };
  $("#d1").onchange = (ev) => { filtros.desde = ev.target.value; cargarLista(); };
  $("#d2").onchange = (ev) => { filtros.hasta = ev.target.value; cargarLista(); };
  cargarLista();
}

async function cargarLista() {
  const p = new URLSearchParams();
  ["estado", "tipo", "desde", "hasta"].forEach((k) => filtros[k] && p.set(k, filtros[k]));
  $("#lista").innerHTML = `<div class="card empty muted">Cargando devoluciones…</div>`;
  try {
    const datos = await api("/api/devoluciones?" + p);
    if (!$("#lista")) return;
    cacheLista = datos;
    pintarLista();
  } catch (e) {
    if (!$("#lista") || !sesion()) return;
    $("#lista").innerHTML = `<div class="card empty"><p class="err">${esc(e.message)}</p><button class="btn" id="r">Reintentar</button></div>`;
    $("#r").onclick = cargarLista;
  }
}

function pintarLista() {
  const q = filtros.q.trim().toLowerCase();
  const datos = cacheLista.filter((d) => !q || [d.id_devolucion, d.id_pedido, nombreCli(d)].join(" ").toLowerCase().includes(q));
  $("#cnt").textContent = `${datos.length} resultado${datos.length === 1 ? "" : "s"}`;
  $("#lista").innerHTML = datos.length
    ? datos.map((d) => `
      <button class="card row" data-id="${d.id_devolucion}">
        <span class="id">#${d.id_devolucion}</span>
        <span>Pedido ${d.id_pedido}<br><span class="muted sm">${esc(nombreCli(d))}</span></span>
        <span>${humanizar(d.tipo)}<br><span class="muted sm">${humanizar(d.motivo)}</span></span>
        ${chipEstado(d.estado)}
        <span class="muted sm">${fecha(d.fecha_solicitud)}</span>
      </button>`).join("")
    : `<div class="card empty muted">No hay devoluciones con estos filtros.</div>`;
  document.querySelectorAll(".row").forEach((b) => (b.onclick = () => (location.hash = "#/devolucion/" + b.dataset.id)));
}

// ===== Detalle =====
async function vistaDetalle(id) {
  $("#app").innerHTML = `<button class="back" id="b">Volver al listado</button><div class="card empty muted">Cargando devolución…</div>`;
  $("#b").onclick = () => (location.hash = "#/");
  try {
    const [d, h] = await Promise.all([api(`/api/devoluciones/${id}`), api(`/api/devoluciones/${id}/historial`)]);
    if (!$("#b")) return;
    pintarDetalle(d, h);
  } catch (e) {
    if (!$("#b") || !sesion()) return;
    $("#app").innerHTML = `<button class="back" id="b">Volver al listado</button><div class="card empty"><p class="err">${esc(e.message)}</p></div>`;
    $("#b").onclick = () => (location.hash = "#/");
  }
}

function pintarDetalle(d, h) {
  const acciones = accionesDe(d);
  const botones = acciones.filter(puede).map((a) => `<button class="btn ${a === "rechazar" ? "bad" : "pri"}" data-a="${a}">${ACCION[a].boton}</button>`).join("");
  let pie = "";
  if (botones) pie = `<div class="bar sec">${botones}</div>`;
  else if (acciones.length) pie = `<p class="muted sm sec">Siguiente paso: ${ACCION[acciones[0]].boton.toLowerCase()}. Lo realiza ${PERMISOS[acciones[0]].join(" o ")}.</p>`;
  else pie = `<p class="muted sm sec">Esta devolución ya está cerrada.</p>`;

  const prendas = (d.DetalleDevolucions || []).map((x) => `
    <div class="item">
      <div>${esc(prod(x.Producto))}<br><span class="muted sm">${x.cantidad} unidad${x.cantidad === 1 ? "" : "es"}${x.ProductoNuevo ? ", cambia por " + esc(prod(x.ProductoNuevo)) : ""}</span></div>
      <span class="muted sm">Inspección: ${humanizar(x.resultado_revision)}</span>
    </div>`).join("");

  const decisiones = (h.auditoria || []).map((a) => `
    <li><div>${humanizar((a.accion || "").replace(/^DEVOLUCION_/, ""))}</div>
    <div class="muted sm">${esc(nombreEmp(a.Empleado))}, ${fechaDe(a)}</div>
    ${a.detalles ? `<div class="sm">${esc(a.detalles)}</div>` : ""}</li>`).join("");
  const movs = (h.movimientos || []).map((m) => `
    <li><div>${humanizar(m.tipo_movimiento)}</div>
    <div class="muted sm">${esc(prod(m.Producto))}, ${m.cantidad} u.</div>
    <div class="muted sm">${esc(nombreEmp(m.Empleado))}, ${fechaDe(m)}</div>
    ${m.observacion ? `<div class="sm">${esc(/^[A-Z_]+$/.test(m.observacion) ? humanizar(m.observacion) : m.observacion)}</div>` : ""}</li>`).join("");

  $("#app").innerHTML = `
    <button class="back" id="b">Volver al listado</button>
    <div class="head"><h1>Devolución #${d.id_devolucion}</h1>${chipEstado(d.estado)}</div>
    <section class="card">
      <div class="kv">
        <div><b>Cliente</b>${esc(nombreCli(d))}</div>
        <div><b>Pedido</b><a href="#/trazabilidad?pedido=${d.id_pedido}">${d.id_pedido}, ver trazabilidad</a></div>
        <div><b>Tipo</b>${humanizar(d.tipo)}</div>
        <div><b>Motivo</b>${humanizar(d.motivo)}</div>
        <div><b>Solicitada</b>${fecha(d.fecha_solicitud)}</div>
        <div><b>Última actualización</b>${fecha(d.fecha_actualizacion)}</div>
        <div><b>Gestionada por</b>${esc(nombreEmp(d.Empleado))}</div>
        <div><b>Observación</b>${esc(d.observacion || "—")}</div>
      </div>
      ${pie}
    </section>
    <section class="card sec"><h2>Prendas</h2>${prendas || '<p class="muted">Sin prendas registradas.</p>'}</section>
    <div class="cols sec">
      <section class="card"><h2>Decisiones</h2><ul class="tl">${decisiones || '<li class="vacio muted">Aún sin decisiones registradas.</li>'}</ul></section>
      <section class="card"><h2>Movimientos de inventario</h2><ul class="tl">${movs || '<li class="vacio muted">Sin movimientos.</li>'}</ul></section>
    </div>`;
  $("#b").onclick = () => (location.hash = "#/");
  document.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => abrirAccion(b.dataset.a, d)));
}

// ===== Acciones (diálogo de confirmación) =====
function abrirAccion(a, d) {
  const A = ACCION[a], dlg = $("#dlg");
  const revision = a !== "revisar" ? "" : `
    <div class="stack">${d.DetalleDevolucions.map((x) => `
      <label class="sm muted">${esc(prod(x.Producto))}, ${x.cantidad} u.
        <select class="pill" name="r_${x.id_detalle_devolucion}">
          <option value="BUEN_ESTADO">Buen estado</option><option value="DANADO">Dañado</option><option value="DEFECTUOSO">Defectuoso</option>
        </select></label>`).join("")}</div>
    <div class="radios">
      <label><input type="radio" name="aceptar" value="1" checked> Aceptar devolución</label>
      <label><input type="radio" name="aceptar" value="0"> Rechazar</label>
    </div>`;
  dlg.innerHTML = `
    <form id="df">
      <h1>${A.titulo}</h1><p class="muted">${A.texto}</p>
      ${revision}
      ${A.obs ? '<textarea class="field" name="observacion" maxlength="255" placeholder="Observación (opcional)"></textarea>' : ""}
      <div class="acts"><button type="button" class="btn" id="cx">Cancelar</button><button class="btn pri" id="ok">${A.boton}</button></div>
    </form>`;
  $("#cx").onclick = () => dlg.close();
  $("#df").onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target), body = {}, obs = (fd.get("observacion") || "").trim();
    if (obs) body.observacion = obs;
    if (a === "revisar") {
      body.aceptar = fd.get("aceptar") === "1";
      body.detalles = d.DetalleDevolucions.map((x) => ({ id_detalle_devolucion: x.id_detalle_devolucion, resultado_revision: fd.get("r_" + x.id_detalle_devolucion) }));
    }
    $("#ok").disabled = true;
    try {
      await api(`/api/devoluciones/${d.id_devolucion}/${a}`, { method: "PUT", body });
      dlg.close();
      aviso(`Devolución #${d.id_devolucion}: ${A.ok}.`);
      vistaDetalle(d.id_devolucion);
    } catch (e) { $("#ok").disabled = false; aviso(e.message, true); }
  };
  dlg.showModal();
}

// ===== Nueva solicitud =====
const MOTIVOS = ["DEFECTUOSO", "TALLA_INCORRECTA", "PRODUCTO_INCORRECTO", "DANADO_ENVIO", "OTRO"];
const TIPOS = ["DEVOLUCION", "CAMBIO_TALLA", "CAMBIO_VARIANTE"];
const opts = (arr, ph) => `<option value="">${esc(ph)}</option>` + arr.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");

async function vistaNueva() {
  const crea = PERMISOS.crear.includes(miRol());
  $("#app").innerHTML = `
    <button class="back" id="b">Volver al listado</button>
    <div class="head"><h1>Nueva solicitud</h1></div>
    <div class="stack">
      ${crea ? "" : '<div class="card err">Tu puesto no puede registrar solicitudes: requiere CAJERO o ADMIN.</div>'}
      <form class="card stack" id="nf">
        <label class="sm muted">Cliente<select class="field" id="cli"><option value="">Cargando clientes…</option></select></label>
        <label class="sm muted">Pedido entregado<select class="field" id="ped" disabled><option value="">Primero elige un cliente</option></select></label>
        <div id="lin"></div>
        <div class="stack" id="cfg" hidden>
          <label class="sm muted">Tipo<select class="field" id="tipo">${opts(TIPOS.map((t) => [t, humanizar(t)]), "Elige el tipo")}</select></label>
          <label class="sm muted">Motivo<select class="field" id="mot">${opts(MOTIVOS.map((t) => [t, humanizar(t)]), "Elige el motivo")}</select></label>
          <textarea class="field" id="obs" maxlength="255" placeholder="Observación (opcional)"></textarea>
        </div>
        <div class="err" id="e" role="alert"></div>
        <div><button class="btn pri" id="go" disabled>Registrar solicitud</button></div>
      </form>
    </div>`;
  $("#b").onclick = () => (location.hash = "#/");

  let clientes, productos, info = null;
  try {
    [clientes, productos] = await Promise.all([api("/api/clientes"), api("/api/productos")]);
  } catch (e) { if ($("#nf")) $("#e").textContent = e.message; return; }
  if (!$("#nf")) return;
  $("#cli").innerHTML = opts(clientes.map((c) => [c.id_cliente, `${c.nombre} ${c.apellido}`]), "Elige un cliente");

  const esCambio = () => $("#tipo").value.startsWith("CAMBIO");
  const raiz = (p) => Number(p.id_producto_padre || p.id_producto);
  // Variantes válidas para un cambio: mismo grupo (mismo padre), activas y distintas del original.
  const variantes = (id) => {
    const base = productos.find((p) => p.id_producto === id);
    return base ? productos.filter((p) => p.activo && p.id_producto !== id && raiz(p) === raiz(base)) : [];
  };

  function refrescar() {
    document.querySelectorAll("#lin input[type=checkbox]").forEach((c) => {
      const i = c.dataset.i, n = $(`[data-n="${i}"]`);
      $(`[data-q="${i}"]`).hidden = !c.checked;
      n.hidden = !(c.checked && esCambio());
      if (!n.hidden && !n.dataset.ok) {
        const v = variantes(info.detalles[i].id_producto);
        n.innerHTML = v.length ? opts(v.map((p) => [p.id_producto, prod(p)]), "Cambiar por…") : '<option value="">Sin variantes registradas</option>';
        n.dataset.ok = "1";
      }
    });
  }

  function pintarLin() {
    const L = info ? info.detalles : [];
    $("#cfg").hidden = !L.length;
    $("#go").disabled = !(crea && L.some((l) => l.cantidad_devolvible > 0));
    $("#lin").innerHTML = L.map((l, i) => `
      <div class="item">
        <label class="chk"><input type="checkbox" data-i="${i}" ${l.cantidad_devolvible ? "" : "disabled"}>
          <span>${esc(prod(l.Producto))}<br><span class="muted sm">Comprado ${l.cantidad_comprada}, ya solicitado ${l.cantidad_solicitada}, por devolver ${l.cantidad_devolvible}</span></span></label>
        <div class="ctl">
          <input class="pill qty" type="number" min="1" max="${l.cantidad_devolvible}" value="1" data-q="${i}" aria-label="Cantidad" hidden>
          <select class="pill" data-n="${i}" aria-label="Producto nuevo" hidden></select>
        </div>
      </div>`).join("");
  }
  $("#lin").onchange = refrescar;
  $("#tipo").onchange = refrescar;

  $("#cli").onchange = async () => {
    info = null; pintarLin(); $("#e").textContent = "";
    const id = $("#cli").value, ped = $("#ped");
    ped.disabled = true; ped.innerHTML = opts([], id ? "Buscando pedidos…" : "Primero elige un cliente");
    if (!id) return;
    try {
      const peds = await api(`/api/pedidos?id_cliente=${id}&estado=ENTREGADO`);
      ped.innerHTML = opts(peds.map((p) => [p.id_pedido, `Pedido ${p.id_pedido}, ${fecha(p.fecha_pedido)}, total ${Number(p.total).toFixed(2)}`]), peds.length ? "Elige un pedido" : "Este cliente no tiene pedidos entregados");
      ped.disabled = !peds.length;
    } catch (e) { $("#e").textContent = e.message; }
  };

  $("#ped").onchange = async () => {
    info = null; pintarLin(); $("#e").textContent = "";
    const id = $("#ped").value;
    if (!id) return;
    try { info = await api(`/api/devoluciones/pedido/${id}/devolvible`); pintarLin(); }
    catch (e) { $("#e").textContent = e.message; }
  };

  $("#nf").onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $("#e"); err.textContent = "";
    const sel = [...document.querySelectorAll("#lin input[type=checkbox]:checked")];
    if (!sel.length) { err.textContent = "Marca al menos una prenda a devolver."; return; }
    if (!$("#tipo").value || !$("#mot").value) { err.textContent = "Elige el tipo y el motivo."; return; }
    const detalles = [];
    for (const c of sel) {
      const i = c.dataset.i, l = info.detalles[i], q = Number($(`[data-q="${i}"]`).value);
      if (!Number.isInteger(q) || q < 1 || q > l.cantidad_devolvible) { err.textContent = `La cantidad de ${prod(l.Producto)} debe estar entre 1 y ${l.cantidad_devolvible}.`; return; }
      const d = { id_detalle_pedido: l.id_detalle_pedido, cantidad: q };
      if (esCambio()) {
        const n = $(`[data-n="${i}"]`).value;
        if (!n) { err.textContent = `Elige por qué prenda se cambia ${prod(l.Producto)}.`; return; }
        d.id_producto_nuevo = Number(n);
      }
      detalles.push(d);
    }
    $("#go").disabled = true;
    try {
      const r = await api("/api/devoluciones", { method: "POST", body: { id_pedido: info.id_pedido, id_cliente: info.id_cliente, tipo: $("#tipo").value, motivo: $("#mot").value, observacion: $("#obs").value.trim() || undefined, detalles } });
      aviso(`Solicitud #${r.devolucion.id_devolucion} registrada.`);
      location.hash = "#/devolucion/" + r.devolucion.id_devolucion;
    } catch (e) { err.textContent = e.message; $("#go").disabled = false; }
  };
}

// ===== Trazabilidad =====
function lineaMovs(movs, conProducto) {
  if (!movs.length) return '<ul class="tl"><li class="vacio muted">Sin movimientos registrados.</li></ul>';
  return `<ul class="tl">${movs.map((m) => `
    <li><div>${humanizar(m.tipo_movimiento)}, ${m.cantidad} u.</div>
    ${conProducto ? `<div class="muted sm">${esc(prod(m.Producto))}</div>` : ""}
    ${m.estado_anterior || m.estado_nuevo ? `<div class="muted sm">${humanizar(m.estado_anterior)} a ${humanizar(m.estado_nuevo)}</div>` : ""}
    <div class="muted sm">${esc(nombreEmp(m.Empleado))}, ${fechaDe(m)}${m.id_devolucion ? `, <a href="#/devolucion/${m.id_devolucion}">devolución #${m.id_devolucion}</a>` : ""}</div>
    ${m.observacion ? `<div class="sm">${esc(/^[A-Z_]+$/.test(m.observacion) ? humanizar(m.observacion) : m.observacion)}</div>` : ""}</li>`).join("")}</ul>`;
}

async function vistaTraza() {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  let modo = qs.get("producto") ? "producto" : "pedido", productos = null;
  const inicial = qs.get("producto") || qs.get("pedido") || "";
  $("#app").innerHTML = `
    <div class="head"><div><h1>Trazabilidad</h1><div class="muted sm">Historial de movimientos de inventario por pedido o por prenda.</div></div></div>
    <div class="bar" id="modos"></div><div class="bar" id="ctl"></div><div class="stack" id="res"></div>`;

  const pintarModos = () => {
    $("#modos").innerHTML = ["pedido", "producto"].map((m) => `<button class="chip ${modo === m ? "on" : ""}" data-m="${m}">Por ${m}</button>`).join("");
    document.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { modo = b.dataset.m; pintarModos(); pintarCtl(""); $("#res").innerHTML = ""; }));
  };
  async function pintarCtl(valor) {
    if (modo === "pedido") {
      $("#ctl").innerHTML = `<form class="search" id="tf"><input id="tq" type="number" min="1" placeholder="Número de pedido" aria-label="Número de pedido" value="${esc(valor)}"><button class="go" aria-label="Consultar">${svg("go")}</button></form>`;
      $("#tf").onsubmit = (ev) => { ev.preventDefault(); const n = $("#tq").value; if (n) cargar(`/api/pedidos/${encodeURIComponent(n)}/historial`, "pedido"); };
      return;
    }
    if (!productos) {
      try { productos = await api("/api/productos"); }
      catch (e) { if ($("#ctl")) $("#ctl").innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    }
    if (!$("#ctl") || modo !== "producto") return;
    $("#ctl").innerHTML = `<select class="pill" id="tp" aria-label="Producto">${opts(productos.map((p) => [p.id_producto, `#${p.id_producto} ${prod(p)}`]), "Elige un producto")}</select>`;
    $("#tp").value = valor;
    $("#tp").onchange = (ev) => ev.target.value && cargar(`/api/productos/${ev.target.value}/historial`, "producto");
  }
  async function cargar(url, tipo) {
    $("#res").innerHTML = `<div class="card empty muted">Consultando…</div>`;
    try {
      const d = await api(url);
      if (!$("#res")) return;
      const x = tipo === "pedido" ? d.pedido : d.producto;
      const cab = tipo === "pedido"
        ? `<div><b>Pedido</b>${x.id_pedido}</div><div><b>Estado</b>${humanizar(x.estado)}</div><div><b>Fecha</b>${fecha(x.fecha_pedido)}</div><div><b>Total</b>${x.total != null ? Number(x.total).toFixed(2) : "—"}</div>`
        : `<div><b>Producto</b>#${x.id_producto} ${esc(prod(x))}</div>`;
      $("#res").innerHTML = `<section class="card"><div class="kv">${cab}</div></section><section class="card"><h2>Movimientos</h2>${lineaMovs(d.movimientos || [], tipo === "pedido")}</section>`;
    } catch (e) {
      if (!$("#res") || !sesion()) return;
      $("#res").innerHTML = `<div class="card empty"><p class="err">${esc(e.message)}</p></div>`;
    }
  }
  pintarModos();
  await pintarCtl(inicial);
  if (inicial) cargar(modo === "pedido" ? `/api/pedidos/${encodeURIComponent(inicial)}/historial` : `/api/productos/${encodeURIComponent(inicial)}/historial`, modo);
}

// ===== Inventario por estado =====
const INV_ESTADOS = ["DISPONIBLE", "DANADA", "DEFECTUOSA"];
const INV_TONO = { DISPONIBLE: "ok", DANADA: "bad", DEFECTUOSA: "bad" };

async function vistaInventario() {
  const f = { estado: "", suc: "", q: "" };
  $("#app").innerHTML = `
    <div class="head"><div><h1>Inventario por estado</h1><div class="muted sm" id="cnt">&nbsp;</div></div></div>
    <div class="bar" id="tot"></div>
    <div class="bar"><form class="search" id="sf"><input id="q" placeholder="Buscar producto por nombre, talla, color o número" aria-label="Buscar"><button class="go" aria-label="Buscar">${svg("go")}</button></form></div>
    <div class="bar" id="chips"></div>
    <div class="bar"><select class="pill" id="suc" aria-label="Sucursal"></select></div>
    <div class="stack" id="lista"><div class="card empty muted">Cargando inventario…</div></div>`;
  let inv, prods, sucs;
  try {
    [inv, prods, sucs] = await Promise.all([api("/api/inventario"), api("/api/productos"), api("/api/sucursales").catch(() => [])]);
  } catch (e) {
    if ($("#lista") && sesion()) $("#lista").innerHTML = `<div class="card empty"><p class="err">${esc(e.message)}</p></div>`;
    return;
  }
  if (!$("#lista")) return;
  const P = Object.fromEntries(prods.map((p) => [p.id_producto, p]));
  const S = Object.fromEntries(sucs.map((x) => [x.id_sucursal, x.nombre]));
  const nombreSuc = (id) => S[id] || `Sucursal ${id}`;
  const estados = [...new Set([...INV_ESTADOS, ...inv.map((i) => i.estado)])];
  const grupos = {};
  inv.forEach((i) => {
    const g = (grupos[i.id_producto + "|" + i.id_sucursal] ||= { id_producto: i.id_producto, id_sucursal: i.id_sucursal, est: {} });
    g.est[i.estado] = (g.est[i.estado] || 0) + i.cantidad;
  });
  $("#suc").innerHTML = opts([...new Set(inv.map((i) => i.id_sucursal))].map((id) => [id, nombreSuc(id)]), "Todas las sucursales");

  function pintarChips() {
    $("#chips").innerHTML = ["", ...estados].map((e) => `<button class="chip ${f.estado === e ? "on" : ""}" data-e="${e}">${e ? humanizar(e) : "Todos"}</button>`).join("");
    document.querySelectorAll("[data-e]").forEach((b) => (b.onclick = () => { f.estado = b.dataset.e; pintarChips(); pintar(); }));
  }
  function pintar() {
    const q = f.q.trim().toLowerCase();
    let gs = Object.values(grupos).filter((g) => (!f.suc || String(g.id_sucursal) === f.suc) && (!q || `${g.id_producto} ${prod(P[g.id_producto])}`.toLowerCase().includes(q)));
    const tot = {};
    gs.forEach((g) => estados.forEach((e) => (tot[e] = (tot[e] || 0) + (g.est[e] || 0))));
    $("#tot").innerHTML = estados.map((e) => `<span class="st ${INV_TONO[e] || ""}">${humanizar(e)}: ${tot[e] || 0}</span>`).join("");
    if (f.estado) gs = gs.filter((g) => g.est[f.estado] > 0);
    gs.sort((a, b) => a.id_producto - b.id_producto || a.id_sucursal - b.id_sucursal);
    $("#cnt").textContent = `${gs.length} combinación${gs.length === 1 ? "" : "es"} de producto y sucursal`;
    $("#lista").innerHTML = gs.length
      ? gs.map((g) => `
        <div class="card inv">
          <span>${esc(prod(P[g.id_producto]))}<br><span class="muted sm">Producto #${g.id_producto}</span></span>
          <span>${esc(nombreSuc(g.id_sucursal))}</span>
          <span class="qtys">${estados.map((e) => `<span class="st ${INV_TONO[e] || ""} ${g.est[e] ? "" : "zero"}">${humanizar(e)} ${g.est[e] || 0}</span>`).join("")}</span>
        </div>`).join("")
      : `<div class="card empty muted">No hay existencias con estos filtros.</div>`;
  }
  pintarChips();
  $("#sf").onsubmit = (ev) => { ev.preventDefault(); pintar(); };
  $("#q").oninput = (ev) => { f.q = ev.target.value; pintar(); };
  $("#suc").onchange = (ev) => { f.suc = ev.target.value; pintar(); };
  pintar();
}

ruta();