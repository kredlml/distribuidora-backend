// E2E: distrital vs sucursal (alcance de datos), reglas de gestión de empleados, catálogo solo
// distrital, devoluciones (una sola, 24 h desde la entrega), reportes y migración. BD desechable.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18089;
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  DB_PORT: "54329", STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad",
};
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + JSON.stringify(i).slice(0, 500) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pg = new Client({ host: "localhost", port: 54329, user: "tester", database: "distrib_test" });
const q = async (sql, p) => (await pg.query(sql, p)).rows;
async function call(method, url, body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const r = await fetch(`http://localhost:${PORT}${url}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let data; try { data = JSON.parse(t); } catch { data = t; }
  return { status: r.status, data };
}
const ocupado = (port) => new Promise((res) => { const s = net.connect({ port, host: "127.0.0.1" }, () => { s.destroy(); res(true); }); s.on("error", () => res(false)); });
function arrancar(log) {
  const out = fs.openSync(path.join(SALIDAS, log), "w");
  return spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });
}
async function esperar(cond) { for (let i = 0; i < 160; i++) { await sleep(500); try { if (await cond()) return true; } catch {} } return false; }
const col = async (t, c) => (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`, [t, c]))[0].n === 1;

(async () => {
  if (await ocupado(PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  let srv;
  try {
    srv = arrancar("server-alcance.log");
    check("migración: Pedido.fecha_entrega y Cliente.id_sucursal", await esperar(async () => (await col("Pedido", "fecha_entrega")) && (await col("Cliente", "id_sucursal")) && (await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='cliente_email_lower_unico'`))[0].n === 1));
    await sleep(2000);
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true),('Norte','y','Mixco',true)`);

    const tok = {}; const ids = {};
    const login = async (email) => (await call("POST", "/api/auth/login", { email, password: "Clave1234" })).data.token;
    let r = await call("POST", "/api/auth/registro", { nombre: "Dina", apellido: "Distrital", email: "dist@t.com", password: "Clave1234", puesto: "CAJERO", id_sucursal: 1 });
    const d0 = (await q(`SELECT puesto, id_sucursal FROM "Empleado"`))[0];
    check("registro inicial: queda DISTRITAL y sin sucursal", r.status === 201 && d0.puesto === "DISTRITAL" && d0.id_sucursal === null, [r, d0]);
    tok.D = await login("dist@t.com");
    r = await call("GET", "/api/auth/yo", undefined, tok.D);
    check("yo del distrital: sin sucursal", r.data.puesto === "DISTRITAL" && r.data.sucursal === null, r.data);

    console.log("\n== Alta de personal");
    for (const [k, puesto, suc] of [["AC", "ADMIN", 1], ["AN", "ADMIN", 2], ["CC", "CAJERO", 1], ["BC", "BODEGUERO", 1], ["CN", "CAJERO", 2], ["BN", "BODEGUERO", 2]]) {
      r = await call("POST", "/api/auth/registro", { nombre: k, apellido: "T", puesto, email: `${k.toLowerCase()}@t.com`, password: "Clave1234", id_sucursal: suc }, tok.D);
      check(`DISTRITAL registra ${puesto} en sucursal ${suc}`, r.status === 201, r);
      ids[k] = r.data.id; tok[k] = await login(`${k.toLowerCase()}@t.com`);
    }
    r = await call("POST", "/api/auth/registro", { nombre: "X", puesto: "CAJERO", email: "sinsuc@t.com", password: "Clave1234" }, tok.D);
    check("DISTRITAL: un cajero sin sucursal -> 400", r.status === 400, r);
    r = await call("GET", "/api/auth/yo", undefined, tok.AC);
    check("yo devuelve el nombre de la sucursal", r.data.sucursal === "Centro", r.data);
    r = await call("POST", "/api/auth/registro", { nombre: "Nuevo", puesto: "CAJERO", email: "nuevo@t.com", password: "Clave1234" }, tok.AC);
    const nuevo = (await q(`SELECT id_sucursal FROM "Empleado" WHERE email='nuevo@t.com'`))[0];
    check("ADMIN registra cajero: queda en su sucursal aunque no la indique", r.status === 201 && nuevo.id_sucursal === 1, [r, nuevo]);
    r = await call("POST", "/api/auth/registro", { nombre: "Y", puesto: "ADMIN", email: "y@t.com", password: "Clave1234" }, tok.AC);
    check("ADMIN no registra otro ADMIN -> 403", r.status === 403, r);
    r = await call("POST", "/api/auth/registro", { nombre: "Y", puesto: "DISTRITAL", email: "y@t.com", password: "Clave1234" }, tok.AC);
    check("ADMIN no registra un DISTRITAL -> 403", r.status === 403, r);
    r = await call("POST", "/api/auth/registro", { nombre: "Y", puesto: "CAJERO", email: "y@t.com", password: "Clave1234", id_sucursal: 2 }, tok.AC);
    check("ADMIN no registra en otra sucursal -> 403", r.status === 403, r);
    r = await call("POST", "/api/empleados", { nombre: "F", apellido: "X", puesto: "BODEGUERO", email: "ficha@t.com", id_sucursal: 2 }, tok.AC);
    check("ficha sin acceso: ADMIN no la crea en otra sucursal -> 403", r.status === 403, r);
    r = await call("POST", "/api/auth/registro", { nombre: "Z", puesto: "CAJERO", email: "z@t.com", password: "Clave1234" }, tok.CC);
    check("CAJERO no registra empleados -> 403", r.status === 403, r);

    console.log("\n== Gestión de empleados por sucursal");
    r = await call("GET", "/api/empleados", undefined, tok.AC);
    check("ADMIN Centro solo ve empleados de Centro", r.status === 200 && r.data.length === 4 && r.data.every((e) => e.id_sucursal === 1), r.data.map((e) => [e.email, e.id_sucursal]));
    r = await call("GET", "/api/empleados", undefined, tok.D);
    check("DISTRITAL ve a todos", r.data.length === 8, r.data.length);
    r = await call("PUT", `/api/empleados/${ids.CN}`, { nombre: "Hack" }, tok.AC);
    check("ADMIN Centro no edita a un cajero de Norte -> 404", r.status === 404, r);
    r = await call("PUT", `/api/empleados/${ids.CC}`, { nombre: "Carla" }, tok.AC);
    check("ADMIN Centro edita a su cajero", r.status === 200 && r.data.nombre === "Carla", r);
    r = await call("PUT", `/api/empleados/${ids.CC}`, { puesto: "ADMIN" }, tok.AC);
    check("ADMIN no asciende a ADMIN -> 403", r.status === 403, r);
    r = await call("PUT", `/api/empleados/${ids.CC}`, { id_sucursal: 2 }, tok.AC);
    check("ADMIN no mueve a otra sucursal -> 403", r.status === 403, r);
    r = await call("PUT", `/api/empleados/${ids.CC}`, { puesto: "BODEGUERO" }, tok.AC);
    check("ADMIN cambia cajero a bodeguero", r.status === 200 && r.data.puesto === "BODEGUERO", r);
    await call("PUT", `/api/empleados/${ids.CC}`, { puesto: "CAJERO" }, tok.AC);
    r = await call("PUT", `/api/empleados/${ids.AC}`, { nombre: "Ana Centro" }, tok.AC);
    check("ADMIN edita su propio nombre", r.status === 200, r);
    r = await call("PUT", `/api/empleados/${ids.AC}`, { id_sucursal: 2 }, tok.AC);
    check("ADMIN no se cambia de sucursal a sí mismo -> 400", r.status === 400, r);
    await call("POST", "/api/auth/registro", { nombre: "Otro", puesto: "ADMIN", email: "admin2c@t.com", password: "Clave1234", id_sucursal: 1 }, tok.D);
    const idAdmin2 = (await q(`SELECT id_empleado FROM "Empleado" WHERE email='admin2c@t.com'`))[0].id_empleado;
    r = await call("PUT", `/api/empleados/${idAdmin2}`, { activo: false }, tok.AC);
    check("ADMIN no desactiva a otro ADMIN de su sucursal -> 403", r.status === 403, r);
    r = await call("PUT", `/api/empleados/${idAdmin2}/password`, { password: "Nueva1234" }, tok.AC);
    check("ADMIN no restablece la contraseña de otro ADMIN -> 403", r.status === 403, r);
    r = await call("PUT", `/api/empleados/${ids.CN}/password`, { password: "Nueva1234" }, tok.AC);
    check("ADMIN no restablece contraseñas de otra sucursal -> 404", r.status === 404, r);
    r = await call("PUT", `/api/empleados/${ids.CC}/password`, { password: "Nueva1234" }, tok.AC);
    check("ADMIN restablece la de su cajero", r.status === 200, r);
    tok.CC = (await call("POST", "/api/auth/login", { email: "cc@t.com", password: "Nueva1234" })).data.token;
    const idD = (await q(`SELECT id_empleado FROM "Empleado" WHERE email='dist@t.com'`))[0].id_empleado;
    r = await call("PUT", `/api/empleados/${idD}`, { activo: false }, tok.AC);
    check("ADMIN no toca al DISTRITAL -> 404", r.status === 404, r);
    r = await call("PUT", `/api/empleados/${idD}`, { puesto: "ADMIN", id_sucursal: 1 }, tok.D);
    check("el DISTRITAL no se cambia el puesto a sí mismo -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/${ids.AN}`, { puesto: "DISTRITAL" }, tok.D);
    const an = (await q(`SELECT puesto, id_sucursal FROM "Empleado" WHERE id_empleado=$1`, [ids.AN]))[0];
    check("DISTRITAL asciende a otro a DISTRITAL (queda sin sucursal)", r.status === 200 && an.puesto === "DISTRITAL" && an.id_sucursal === null, [r.status, an]);
    r = await call("PUT", `/api/empleados/${ids.AN}`, { puesto: "ADMIN" }, tok.D);
    check("devolverlo a ADMIN exige sucursal -> 400", r.status === 400, r);
    r = await call("PUT", `/api/empleados/${ids.AN}`, { puesto: "ADMIN", id_sucursal: 2 }, tok.D);
    check("DISTRITAL lo regresa a ADMIN de Norte", r.status === 200, r);
    check("cambiarle puesto/sucursal cierra su sesión", (await call("GET", "/api/auth/yo", undefined, tok.AN)).status === 401);
    tok.AN = await login("an@t.com");

    console.log("\n== Catálogo, sucursales y auditoría (solo distrital)");
    r = await call("POST", "/api/categorias", { nombre: "Blusas" }, tok.AC);
    check("ADMIN no crea tipos de prenda -> 403", r.status === 403, r);
    r = await call("POST", "/api/categorias", { nombre: "Blusas" }, tok.BC);
    check("BODEGUERO no crea tipos de prenda -> 403", r.status === 403, r);
    r = await call("POST", "/api/categorias", { nombre: "Blusas" }, tok.D);
    check("DISTRITAL crea tipos de prenda", r.status === 201, r);
    r = await call("POST", "/api/productos", { nombre: "Blusa", precio_unitario: 100, id_categoria: 1, talla: "M" }, tok.AC);
    check("ADMIN no crea prendas -> 403", r.status === 403, r);
    for (const [talla, precio] of [["M", 100], ["S", 100], ["L", 120]]) {
      r = await call("POST", "/api/productos", { nombre: "Blusa", precio_unitario: precio, id_categoria: 1, talla, color: "Blanco", id_producto_padre: talla === "M" ? undefined : 1 }, tok.D);
    }
    check("DISTRITAL crea prendas y variantes", r.status === 201 && (await q(`SELECT count(*)::int n FROM "Producto"`))[0].n === 3, r);
    r = await call("PUT", "/api/productos/1", { precio_unitario: 999 }, tok.AC);
    check("ADMIN no edita prendas -> 403", r.status === 403, r);
    r = await call("POST", "/api/sucursales", { nombre: "Sur", direccion: "z", ciudad: "Escuintla" }, tok.AC);
    check("ADMIN no abre sucursales -> 403", r.status === 403, r);
    r = await call("PUT", "/api/sucursales/1", { telefono: "1" }, tok.AC);
    check("ADMIN no edita sucursales -> 403", r.status === 403, r);
    r = await call("PUT", "/api/sucursales/1", { telefono: "2233" }, tok.D);
    check("DISTRITAL edita sucursales", r.status === 200, r);
    r = await call("GET", "/api/auditoria", undefined, tok.AC);
    check("ADMIN no lee la auditoría -> 403", r.status === 403, r);
    r = await call("GET", "/api/auditoria", undefined, tok.D);
    check("DISTRITAL lee la auditoría", r.status === 200, r.status);

    console.log("\n== Inventario por sucursal");
    for (const [prod, suc, cant] of [[1, 1, 20], [2, 1, 10], [3, 1, 10], [1, 2, 15], [2, 2, 5]]) {
      r = await call("POST", "/api/inventario", { id_producto: prod, id_sucursal: suc, cantidad: cant }, tok.D);
    }
    check("DISTRITAL ingresa stock en cualquier sucursal", r.status === 201, r);
    r = await call("POST", "/api/inventario", { id_producto: 1, id_sucursal: 2, cantidad: 5 }, tok.BC);
    check("BODEGUERO Centro no ingresa stock en Norte -> 403", r.status === 403, r);
    r = await call("POST", "/api/inventario", { id_producto: 1, id_sucursal: 1, cantidad: 5 }, tok.BC);
    check("BODEGUERO Centro ingresa en su sucursal", r.status === 201, r);
    r = await call("GET", "/api/inventario", undefined, tok.BC);
    check("inventario: solo filas de Centro", r.data.length === 4 && r.data.every((i) => i.id_sucursal === 1), r.data.length);
    r = await call("GET", "/api/inventario?id_sucursal=2", undefined, tok.BC);
    check("pedir el de Norte por filtro no lo muestra", r.data.every((i) => i.id_sucursal === 1), r.data);
    r = await call("GET", "/api/inventario/stock", undefined, tok.AN);
    check("stock global de Norte para ADMIN Norte", r.data.every((s) => s.id_sucursal === 2) && r.data.length === 2, r.data);
    const filaNorte = (await q(`SELECT id_inventario FROM "Inventario" WHERE id_sucursal=2 LIMIT 1`))[0].id_inventario;
    r = await call("POST", "/api/inventario/ajustes", { id_sucursal: 2, motivo: "PERDIDA", ajustes: [{ id_inventario: filaNorte, cantidad_actual: 15, cantidad_nueva: 14 }] }, tok.BC);
    check("BODEGUERO Centro no ajusta stock de Norte -> 403", r.status === 403, r);

    console.log("\n== Clientes y pedidos por sucursal");
    r = await call("POST", "/api/clientes", { nombre: "María", apellido: "López", email: "maria@x.com" }, tok.CC);
    const maria = r.data.id_cliente;
    check("cliente registrado en Centro", r.status === 201 && r.data.id_sucursal === 1, r);
    r = await call("POST", "/api/clientes", { nombre: "Nora", apellido: "Norte" }, tok.CN);
    const nora = r.data.id_cliente;
    r = await call("GET", "/api/clientes", undefined, tok.CN);
    check("cajero Norte no ve a la clienta de Centro", r.data.length === 1 && r.data[0].id_cliente === nora, r.data);
    r = await call("PUT", `/api/clientes/${maria}`, { telefono: "1" }, tok.CN);
    check("cajero Norte no edita a la clienta de Centro -> 404", r.status === 404, r);
    r = await call("GET", "/api/clientes?email=MARIA@x.com", undefined, tok.CN);
    check("búsqueda exacta por correo la encuentra (datos básicos)", r.data.length === 1 && r.data[0].id_cliente === maria && !("telefono" in r.data[0]), r.data);
    r = await call("GET", "/api/clientes?email=no", undefined, tok.CN);
    check("búsqueda con correo incompleto -> 400", r.status === 400, r);
    r = await call("POST", "/api/pedidos", { id_cliente: maria, detalles: [{ id_producto: 1, cantidad: 2 }] }, tok.CC);
    const p1 = r.data.pedido.id_pedido;
    check("cajero Centro vende sin indicar sucursal: queda en Centro", r.status === 201 && r.data.pedido.id_sucursal === 1, r);
    r = await call("POST", "/api/pedidos", { id_cliente: maria, id_sucursal: 2, detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.CC);
    check("cajero Centro no vende en Norte -> 403", r.status === 403, r);
    r = await call("POST", "/api/pedidos", { id_cliente: maria, detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.CN);
    check("vender a una clienta de otra sucursal sin buscarla por correo -> 403", r.status === 403, r);
    r = await call("GET", "/api/clientes", undefined, tok.CN);
    check("sigue sin verla tras el intento", !r.data.some((c) => c.id_cliente === maria), r.data);
    r = await call("POST", "/api/pedidos", { id_cliente: maria, email_cliente: "Maria@X.com", detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.CN);
    const pN = r.data.pedido.id_pedido;
    check("cajero Norte vende a la clienta de Centro (encontrada por correo)", r.status === 201 && r.data.pedido.id_sucursal === 2, r);
    r = await call("GET", "/api/clientes", undefined, tok.CN);
    check("al comprarle, la clienta pasa a verse en Norte", r.data.some((c) => c.id_cliente === maria), r.data);
    r = await call("PUT", `/api/clientes/${maria}`, { telefono: "5555" }, tok.CN);
    check("…y Norte ya puede actualizar sus datos", r.status === 200, r);
    r = await call("GET", "/api/pedidos", undefined, tok.CC);
    check("cajero Centro solo ve pedidos de Centro", r.data.length === 1 && r.data[0].id_pedido === p1, r.data.map((p) => p.id_pedido));
    r = await call("GET", "/api/pedidos?id_sucursal=2", undefined, tok.CC);
    check("filtro a Norte no le muestra nada de Norte", r.data.every((p) => p.id_sucursal === 1), r.data);
    r = await call("GET", "/api/pedidos", undefined, tok.D);
    check("DISTRITAL ve todos los pedidos", r.data.length === 2, r.data.length);
    r = await call("GET", `/api/pedidos/${pN}`, undefined, tok.CC);
    check("detalle de pedido de Norte para cajero Centro -> 404", r.status === 404, r);
    r = await call("POST", "/api/pagos", { id_pedido: pN, metodo_pago: "EFECTIVO", monto: 100 }, tok.CC);
    check("no cobra pedidos de Norte -> 404", r.status === 404, r);
    r = await call("POST", "/api/detalles", { id_pedido: pN, id_producto: 2, cantidad: 1 }, tok.CC);
    check("no agrega prendas a pedidos de Norte -> 404", r.status === 404, r);
    r = await call("PUT", `/api/pedidos/${pN}/estado`, { estado: "CANCELADO" }, tok.AC);
    check("ADMIN Centro no cancela pedidos de Norte -> 404", r.status === 404, r);
    r = await call("GET", `/api/pedidos/${pN}/historial`, undefined, tok.AC);
    check("trazabilidad de pedido de Norte -> 404", r.status === 404, r);
    await call("POST", "/api/pagos", { id_pedido: pN, metodo_pago: "EFECTIVO", monto: 100 }, tok.CN);
    r = await call("GET", "/api/pagos", undefined, tok.CC);
    check("lista de pagos: Centro no ve los de Norte", r.data.length === 0, r.data);
    r = await call("GET", "/api/productos/1/historial", undefined, tok.AC);
    check("trazabilidad de prenda: ADMIN Centro solo ve movimientos de Centro", r.data.movimientos.length > 0 && r.data.movimientos.every((m) => (m.Inventario && m.Inventario.id_sucursal === 1) || (m.Pedido && m.Pedido.id_sucursal === 1)), r.data.movimientos.map((m) => [m.tipo_movimiento, m.Inventario, m.Pedido]));
    r = await call("GET", "/api/productos/1/historial", undefined, tok.D);
    check("trazabilidad de prenda: DISTRITAL ve todas", r.data.movimientos.some((m) => m.Pedido && m.Pedido.id_sucursal === 2), r.data.movimientos.length);

    console.log("\n== Devoluciones: una sola vez, 24 h desde la entrega");
    await call("POST", "/api/pagos", { id_pedido: p1, metodo_pago: "EFECTIVO", monto: 200 }, tok.CC);
    await call("PUT", `/api/pedidos/${p1}/estado`, { estado: "ENVIADO" }, tok.BC);
    const antesEntrega = Date.now();
    r = await call("PUT", `/api/pedidos/${p1}/estado`, { estado: "ENTREGADO" }, tok.BC);
    const fe = (await q(`SELECT fecha_entrega FROM "Pedido" WHERE id_pedido=$1`, [p1]))[0].fecha_entrega;
    check("al entregar se guarda la fecha de entrega", r.status === 200 && fe && Math.abs(new Date(fe).getTime() - antesEntrega) < 60000, fe);
    r = await call("GET", `/api/devoluciones/pedido/${p1}/devolvible`, undefined, tok.CC);
    const vence = new Date(r.data.plazo_vence).getTime();
    check("devolvible: permitido, vence 24 h después de la entrega", r.data.permite_devolucion === true && Math.abs(vence - (new Date(fe).getTime() + 24 * 3600000)) < 1000 && r.data.horas_plazo === 24, r.data);
    r = await call("GET", `/api/devoluciones/pedido/${p1}/devolvible`, undefined, tok.CN);
    check("devolvible de pedido de Centro para cajero Norte -> 404", r.status === 404, r);
    const det1 = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1`, [p1]))[0].id_detalle_pedido;
    const sol = (n = 1) => ({ id_pedido: p1, id_cliente: maria, tipo: "DEVOLUCION", motivo: "DEFECTUOSO", detalles: [{ id_detalle_pedido: det1, cantidad: n }] });
    r = await call("POST", "/api/devoluciones", sol(), tok.CN);
    check("cajero Norte no registra devoluciones de Centro -> 404", r.status === 404, r);
    r = await call("POST", "/api/devoluciones", sol(1), tok.CC);
    const dev1 = r.data.devolucion && r.data.devolucion.id_devolucion;
    check("primera solicitud (1 de 2 unidades) -> 201", r.status === 201, r);
    r = await call("POST", "/api/devoluciones", sol(1), tok.CC);
    check("segunda solicitud del mismo pedido -> 400 (una sola por pedido)", r.status === 400 && /solo se permite una/.test(r.data.message), r);
    r = await call("GET", `/api/devoluciones/pedido/${p1}/devolvible`, undefined, tok.CC);
    check("devolvible ahora: YA_SOLICITADO", r.data.permite_devolucion === false && r.data.motivo_no_permite === "YA_SOLICITADO" && r.data.detalles.every((l) => l.cantidad_devolvible === 0), r.data);
    r = await call("PUT", `/api/devoluciones/${dev1}/rechazar`, {}, tok.AN);
    check("ADMIN Norte no gestiona devoluciones de Centro -> 404", r.status === 404, r);
    r = await call("GET", "/api/devoluciones", undefined, tok.AN);
    check("lista de devoluciones de Norte no incluye las de Centro", r.data.length === 0, r.data);
    r = await call("PUT", `/api/devoluciones/${dev1}/rechazar`, {}, tok.AC);
    check("ADMIN Centro la rechaza", r.status === 200, r);
    r = await call("POST", "/api/devoluciones", sol(1), tok.CC);
    check("aunque se rechazó, no hay segunda solicitud -> 400", r.status === 400, r);
    // Plazo vencido
    const pv = (await call("POST", "/api/pedidos", { id_cliente: maria, detalles: [{ id_producto: 2, cantidad: 1 }] }, tok.CC)).data.pedido.id_pedido;
    await call("POST", "/api/pagos", { id_pedido: pv, metodo_pago: "EFECTIVO", monto: 100 }, tok.CC);
    await call("PUT", `/api/pedidos/${pv}/estado`, { estado: "ENVIADO" }, tok.BC);
    await call("PUT", `/api/pedidos/${pv}/estado`, { estado: "ENTREGADO" }, tok.BC);
    await q(`UPDATE "Pedido" SET fecha_entrega = NOW() - interval '24 hours 1 minute' WHERE id_pedido=$1`, [pv]);
    const detv = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1`, [pv]))[0].id_detalle_pedido;
    r = await call("POST", "/api/devoluciones", { id_pedido: pv, id_cliente: maria, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: detv, cantidad: 1 }] }, tok.CC);
    check("pasadas 24 h -> 400 (plazo vencido)", r.status === 400 && /24 horas/.test(r.data.message), r);
    r = await call("GET", `/api/devoluciones/pedido/${pv}/devolvible`, undefined, tok.CC);
    check("devolvible: PLAZO_VENCIDO", r.data.permite_devolucion === false && r.data.motivo_no_permite === "PLAZO_VENCIDO", r.data);
    await q(`UPDATE "Pedido" SET fecha_entrega = NOW() - interval '23 hours 50 minutes' WHERE id_pedido=$1`, [pv]);
    // Dos solicitudes simultáneas dentro del plazo: solo una
    const [s1, s2] = await Promise.all([
      call("POST", "/api/devoluciones", { id_pedido: pv, id_cliente: maria, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: detv, cantidad: 1 }] }, tok.CC),
      call("POST", "/api/devoluciones", { id_pedido: pv, id_cliente: maria, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: detv, cantidad: 1 }] }, tok.AC),
    ]);
    check("dos solicitudes simultáneas: solo una se registra", [s1.status, s2.status].sort().join() === "201,400" && (await q(`SELECT count(*)::int n FROM "Devolucion" WHERE id_pedido=$1`, [pv]))[0].n === 1, [s1.status, s2.status]);
    // Tienda
    const reg = await call("POST", "/api/tienda/auth/registro", { nombre: "Lucía", apellido: "Web", email: "lucia@x.com", password: "Clave1234" });
    const tokL = reg.data.token;
    const pt = (await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, direccion_entrega: "Zona 10", detalles: [{ id_producto: 3, cantidad: 1 }] }, tokL)).data.pedido.id_pedido;
    await call("POST", `/api/tienda/pedidos/${pt}/pago`, {}, tokL);
    r = await call("GET", `/api/tienda/pedidos/${pt}`, undefined, tokL);
    check("tienda: antes de entregar no se permite", r.data.devolucion_permitida === false && r.data.devolucion_motivo === "NO_ENTREGADO", r.data);
    await call("PUT", `/api/pedidos/${pt}/estado`, { estado: "ENVIADO" }, tok.BC);
    await call("PUT", `/api/pedidos/${pt}/estado`, { estado: "ENTREGADO" }, tok.BC);
    r = await call("GET", `/api/tienda/pedidos/${pt}`, undefined, tokL);
    check("tienda: entregado -> permitido con fecha de vencimiento", r.data.devolucion_permitida === true && !!r.data.devolucion_vence, r.data);
    const dett = r.data.DetallePedidos[0].id_detalle_pedido;
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: pt, tipo: "CAMBIO_TALLA", motivo: "TALLA_INCORRECTA", detalles: [{ id_detalle_pedido: dett, cantidad: 1, id_producto_nuevo: 1 }] }, tokL);
    check("tienda: solicitud de cambio de talla", r.status === 201, r);
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: pt, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: dett, cantidad: 1 }] }, tokL);
    check("tienda: segunda solicitud -> 400", r.status === 400, r);
    r = await call("GET", `/api/tienda/pedidos/${pt}`, undefined, tokL);
    check("tienda: ya no se ofrece", r.data.devolucion_permitida === false && r.data.devolucion_motivo === "YA_SOLICITADO", r.data);
    r = await call("GET", `/api/tienda/pedidos/${pt}/devolvible`, undefined, tokL);
    check("tienda devolvible: mensaje para la clienta", r.data.permite_devolucion === false && /solo se permite una/.test(r.data.mensaje), r.data);

    console.log("\n== Reportes");
    const pp = (await call("POST", "/api/pedidos", { id_cliente: maria, detalles: [{ id_producto: 3, cantidad: 1 }] }, tok.CC)).data.pedido;
    await call("POST", "/api/pagos", { id_pedido: pp.id_pedido, metodo_pago: "EFECTIVO", monto: 50 }, tok.CC);
    r = await call("GET", "/api/reportes/resumen", undefined, tok.CC);
    check("CAJERO no ve reportes -> 403", r.status === 403, r);
    r = await call("GET", "/api/reportes/resumen", undefined, tok.AC);
    const ventasCentro = (await q(`SELECT COALESCE(SUM(total),0) s, count(*)::int n FROM "Pedido" WHERE id_sucursal=1 AND estado IN ('PROCESADO','ENVIADO','ENTREGADO')`))[0];
    check("ADMIN Centro: hoy, solo su sucursal, cuadra con la base", r.status === 200 && r.data.sucursal.nombre === "Centro" && r.data.kpis.ventas === Number(ventasCentro.s) && r.data.kpis.pedidos === ventasCentro.n && r.data.por_sucursal.length === 1, [r.data.kpis, ventasCentro]);
    check("ventas de hoy = ventas del periodo (hoy)", r.data.kpis.ventas_hoy === r.data.kpis.ventas, r.data.kpis);
    check("ticket promedio", r.data.kpis.ticket_promedio === Math.round((Number(ventasCentro.s) / ventasCentro.n) * 100) / 100, r.data.kpis);
    check("prendas vendidas y por tipo", r.data.por_prenda.length >= 1 && r.data.por_prenda[0].unidades >= 1 && r.data.por_tipo[0].tipo === "Blusas", [r.data.por_prenda, r.data.por_tipo]);
    check("métodos de pago, origen y vendedor", r.data.por_metodo.some((m) => m.metodo === "EFECTIVO") && r.data.por_origen.length === 2 && r.data.por_vendedor.length >= 1, [r.data.por_metodo, r.data.por_origen]);
    check("por cobrar descuenta lo ya cobrado (120 - 50 = 70)", r.data.kpis.pendientes_cobro.pedidos === 1 && r.data.kpis.pendientes_cobro.monto === 70, r.data.kpis.pendientes_cobro);
    check("devoluciones y cambios del periodo", r.data.kpis.devoluciones.devoluciones === 2 && r.data.kpis.devoluciones.cambios === 1, r.data.kpis.devoluciones);
    r = await call("GET", "/api/reportes/resumen?id_sucursal=2", undefined, tok.AC);
    check("ADMIN Centro pidiendo Norte sigue viendo Centro", r.data.sucursal.nombre === "Centro", r.data.sucursal);
    r = await call("GET", "/api/reportes/resumen", undefined, tok.D);
    check("DISTRITAL: todas las sucursales (por sucursal)", r.data.sucursal === null && r.data.por_sucursal.length === 2, r.data.por_sucursal);
    r = await call("GET", "/api/reportes/resumen?id_sucursal=2", undefined, tok.D);
    check("DISTRITAL filtra por Norte", r.data.sucursal.nombre === "Norte" && r.data.kpis.pedidos === 1, r.data.kpis);
    r = await call("GET", "/api/reportes/resumen?desde=2020-01-01&hasta=2026-12-31", undefined, tok.D);
    check("periodo mayor a un año -> 400", r.status === 400, r);
    r = await call("GET", "/api/reportes/resumen?desde=2026-02-10&hasta=2026-02-01", undefined, tok.D);
    check("desde posterior a hasta -> 400", r.status === 400, r);
    r = await call("GET", "/api/reportes/resumen?desde=10-02-2026", undefined, tok.D);
    check("fecha mal escrita -> 400", r.status === 400, r);
    // Día de Guatemala: una venta a las 23:30 GT del día 5 (05:30 UTC del 6) cuenta en el 5.
    await q(`UPDATE "Pedido" SET fecha_pedido='2026-03-06T05:30:00Z' WHERE id_pedido=$1`, [pN]);
    r = await call("GET", "/api/reportes/resumen?desde=2026-03-05&hasta=2026-03-05&id_sucursal=2", undefined, tok.D);
    const r6 = await call("GET", "/api/reportes/resumen?desde=2026-03-06&hasta=2026-03-06&id_sucursal=2", undefined, tok.D);
    check("los días del reporte son días de Guatemala", r.data.kpis.pedidos === 1 && r6.data.kpis.pedidos === 0 && r.data.por_dia[0].dia === "2026-03-05", [r.data.kpis, r6.data.kpis, r.data.por_dia]);
    r = await call("GET", "/api/reportes/stock-critico", undefined, tok.AN);
    check("stock crítico de ADMIN Norte solo de Norte", r.status === 200 && r.data.every((s) => s.sucursal === "Norte"), r.data);

    console.log("\n== Migración de fechas de entrega");
    await q(`UPDATE "Pedido" SET fecha_entrega = NULL WHERE id_pedido=$1`, [p1]);
    // Base "antigua": sin DISTRITAL (la cuenta principal era ADMIN sin sucursal) y clientes sin sucursal.
    await q(`UPDATE "Empleado" SET puesto='ADMIN' WHERE upper(puesto)='DISTRITAL'`);
    await q(`UPDATE "Cliente" SET id_sucursal = NULL WHERE id_cliente=$1`, [nora]);
    srv.kill(); await sleep(1500);
    srv = arrancar("server-alcance-2.log");
    const relleno = await esperar(async () => (await q(`SELECT fecha_entrega FROM "Pedido" WHERE id_pedido=$1`, [p1]))[0].fecha_entrega !== null);
    check("al arrancar se completa fecha_entrega desde la auditoría", relleno);
    const prom = await esperar(async () => (await q(`SELECT puesto FROM "Empleado" WHERE email='dist@t.com'`))[0].puesto === "DISTRITAL");
    const otros = (await q(`SELECT count(*)::int n FROM "Empleado" WHERE puesto='DISTRITAL'`))[0].n;
    check("sin ningún DISTRITAL, el ADMIN sin sucursal se promueve (solo él)", prom && otros === 1, otros);
    check("la promoción queda auditada", (await q(`SELECT count(*)::int n FROM auditoria WHERE accion='EMPLEADO_PROMOVIDO_DISTRITAL'`))[0].n === 1);
    check("clientes sin sucursal recuperan la de quien los registró", (await q(`SELECT id_sucursal FROM "Cliente" WHERE id_cliente=$1`, [nora]))[0].id_sucursal === 2);
  } catch (e) {
    console.error(e); fails.push("excepción: " + e.message);
  } finally {
    if (srv) srv.kill();
    await pg.end();
    console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
    process.exit(fails.length ? 1 : 0);
  }
})();
