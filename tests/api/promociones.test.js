// E2E del punto 8: costo de envío (con envío gratis y retiro en sucursal), cupones de descuento
// (validaciones, vigencia, usos, sucursal, concurrencia, liberación al cancelar), desglose de IVA,
// reembolsos que prorratean el descuento y no devuelven el envío, y reportes con descuentos/envíos/IVA.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18079;
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", DB_PORT: "54329", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad", CORREO_MODO: "archivo", CORREO_CARPETA: path.join(SALIDAS, "correos-promociones"),
  ENVIO_COSTO: "25", ENVIO_GRATIS_DESDE: "300", IVA_PORCENTAJE: "12",
};
const fails = []; let passes = 0;
const check = (n, c, i) => { if (c) { passes++; console.log("  ok  " + n); } else { fails.push(n); console.log("  FAIL " + n + (i !== undefined ? "  -> " + JSON.stringify(i).slice(0, 700) : "")); } };
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
const dia = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date(Date.now() + offset * 86400000));
const n2 = (x) => Math.round(Number(x) * 100) / 100;
const usos = async (codigo) => (await q(`SELECT usos FROM "Cupon" WHERE codigo=$1`, [codigo]))[0].usos;

(async () => {
  if (await ocupado(PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const out = fs.openSync(path.join(SALIDAS, "promociones-servidor.log"), "w");
  const srv = spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });
  try {
    let listo = false;
    for (let i = 0; i < 160 && !listo; i++) { await sleep(500); try { listo = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} }
    check("servidor arriba", listo);
    check("migración: tabla Cupon y columnas costo_envio, descuento, id_cupon en Pedido",
      (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='Pedido' AND column_name IN ('costo_envio','descuento','id_cupon')`))[0].n === 3
      && (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name='Cupon'`))[0].n === 1);
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','x','GT',true),('Norte','y','Mixco',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Blusas')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Blusa',100,1,true,'M',1),('Falda',200,1,true,'U',1)`);
    await q(`INSERT INTO "Inventario"(cantidad,id_producto,id_sucursal,lote,estado) VALUES (200,1,1,'A','DISPONIBLE'),(200,2,1,'B','DISPONIBLE'),(50,1,2,'C','DISPONIBLE')`);
    await call("POST", "/api/auth/registro", { nombre: "Dina", apellido: "D", email: "dist@t.com", password: "Clave1234" });
    const tok = { D: (await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" })).data.token };
    for (const [k, puesto] of [["A1", "ADMIN"], ["C1", "CAJERO"], ["B1", "BODEGUERO"]]) {
      await call("POST", "/api/auth/registro", { nombre: k, apellido: "T", puesto, email: `${k}@t.com`, password: "Clave1234", id_sucursal: 1 }, tok.D);
      tok[k] = (await call("POST", "/api/auth/login", { email: `${k}@t.com`, password: "Clave1234" })).data.token;
    }
    const clientas = [];
    for (let i = 0; i < 6; i++) clientas.push((await call("POST", "/api/tienda/auth/registro", { nombre: `Cl${i}`, apellido: "X", email: `cl${i}@x.com`, password: "12345678", direccion: "Zona 10" })).data.token);
    const maria = (await call("POST", "/api/clientes", { nombre: "María", apellido: "M", email: "maria@x.com" }, tok.C1)).data;

    console.log("\n== Cupones (DISTRITAL)");
    let r = await call("POST", "/api/cupones", { codigo: "X1", tipo: "PORCENTAJE", valor: 10 }, tok.A1);
    check("ADMIN de sucursal no administra cupones -> 403", r.status === 403, r);
    const nuevo = (b) => call("POST", "/api/cupones", b, tok.D);
    for (const [b, n] of [[{ codigo: "a b", tipo: "MONTO", valor: 5 }, "código con espacio"], [{ codigo: "CERO", tipo: "MONTO", valor: 0 }, "valor 0"],
      [{ codigo: "MUCHO", tipo: "PORCENTAJE", valor: 150 }, "porcentaje > 100"], [{ codigo: "FECHAS", tipo: "MONTO", valor: 5, desde: dia(5), hasta: dia(1) }, "desde > hasta"],
      [{ codigo: "TIPO", tipo: "REGALO", valor: 5 }, "tipo inválido"], [{ codigo: "DEC", tipo: "MONTO", valor: 5.555 }, "más de 2 decimales"], [{ codigo: "FEB30", tipo: "MONTO", valor: 5, hasta: "2026-02-30" }, "fecha que no existe"],
      [{ codigo: "ENORME", tipo: "MONTO", valor: 1e12 }, "monto fuera de rango"], [{ codigo: "USOS", tipo: "MONTO", valor: 5, usos_maximos: 1e11 }, "usos fuera de rango"]]) {
      r = await nuevo(b);
      check(`cupón inválido (${n}) -> 400`, r.status === 400, r);
    }
    r = await nuevo({ codigo: "verano10", descripcion: "10% desde Q150", tipo: "PORCENTAJE", valor: 10, minimo_compra: 150 });
    check("crear cupón (el código se guarda en mayúsculas)", r.status === 201 && r.data.codigo === "VERANO10", r);
    const idVerano = r.data.id_cupon;
    r = await nuevo({ codigo: "Verano10", tipo: "MONTO", valor: 5 });
    check("código repetido (sin distinguir mayúsculas) -> 400", r.status === 400, r);
    await nuevo({ codigo: "FIJO50", tipo: "MONTO", valor: 50, usos_maximos: 1 });
    await nuevo({ codigo: "NORTE20", tipo: "PORCENTAJE", valor: 20, id_sucursal: 2 });
    await nuevo({ codigo: "VENCIDO", tipo: "MONTO", valor: 10, hasta: dia(-1) });
    await nuevo({ codigo: "FUTURO", tipo: "MONTO", valor: 10, desde: dia(2) });
    await nuevo({ codigo: "APAGADO", tipo: "MONTO", valor: 10, activo: false });
    await nuevo({ codigo: "UNICO", tipo: "MONTO", valor: 30, usos_maximos: 1 });
    await nuevo({ codigo: "TODO", tipo: "PORCENTAJE", valor: 100 });
    r = await call("GET", "/api/cupones", undefined, tok.D);
    check("listar cupones", r.status === 200 && r.data.length === 8 && "descuento_total" in r.data[0], r.data.length);

    console.log("\n== Cotización en la tienda");
    const cotizar = (b, t = clientas[0]) => call("POST", "/api/tienda/cotizar", { id_sucursal: 1, ...b }, t);
    r = await cotizar({ detalles: [{ id_producto: 1, cantidad: 1 }] });
    check("1 blusa a domicilio: 100 + envío 25 = 125 con IVA desglosado", r.status === 200 && r.data.subtotal === 100 && r.data.costo_envio === 25 && r.data.descuento === 0 && r.data.total === 125 && r.data.iva === n2(125 - 125 / 1.12) && r.data.base_imponible === n2(125 / 1.12), r.data);
    r = await cotizar({ detalles: [{ id_producto: 2, cantidad: 2 }] });
    check("desde Q300 el envío es gratis", r.data.subtotal === 400 && r.data.costo_envio === 0 && r.data.total === 400, r.data);
    r = await cotizar({ detalles: [{ id_producto: 1, cantidad: 1 }], retiro_en_sucursal: true });
    check("retiro en sucursal: sin envío", r.data.costo_envio === 0 && r.data.total === 100, r.data);
    r = await cotizar({ detalles: [{ id_producto: 1, cantidad: 1 }], cupon: "verano10" });
    check("cupón por debajo de la compra mínima: avisa y no descuenta", r.status === 200 && r.data.descuento === 0 && /compra mínima/.test(r.data.cupon_error) && r.data.total === 125, r.data);
    r = await cotizar({ detalles: [{ id_producto: 1, cantidad: 2 }], cupon: "VERANO10" });
    check("cupón 10% sobre 200: descuento 20 + envío 25 = 205", r.data.descuento === 20 && r.data.costo_envio === 25 && r.data.total === 205 && r.data.cupon.codigo === "VERANO10" && !r.data.cupon_error, r.data);
    r = await cotizar({ detalles: [{ id_producto: 2, cantidad: 2 }], cupon: "VERANO10" });
    check("el envío gratis se calcula después del descuento (400-40=360 ≥ 300)", r.data.descuento === 40 && r.data.costo_envio === 0 && r.data.total === 360, r.data);
    r = await cotizar({ detalles: [{ id_producto: 1, cantidad: 3 }], cupon: "VERANO10" });
    check("…y si el descuento baja de 300, sí cobra envío (300-30=270)", r.data.descuento === 30 && r.data.costo_envio === 25 && r.data.total === 295, r.data);
    // Mismo mensaje para todos (no revela qué códigos existen); solo la compra mínima se explica.
    for (const [c, motivo] of [["NOEXISTE", /no es válido/], ["VENCIDO", /no es válido/], ["FUTURO", /no es válido/], ["APAGADO", /no es válido/], ["NORTE20", /no es válido/]]) {
      r = await cotizar({ detalles: [{ id_producto: 1, cantidad: 2 }], cupon: c });
      check(`cupón ${c}: no aplica (${motivo})`, r.status === 200 && r.data.descuento === 0 && motivo.test(r.data.cupon_error || ""), r.data);
    }
    r = await cotizar({ detalles: [{ id_producto: 1, cantidad: 1 }], cupon: "TODO" });
    check("100% de descuento: solo paga el envío", r.data.descuento === 100 && r.data.total === 25, r.data);
    r = await cotizar({ detalles: [{ id_producto: 99, cantidad: 1 }] });
    check("prenda inexistente -> 400", r.status === 400, r);

    console.log("\n== Pedidos con cupón y envío");
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, cupon: "verano10", detalles: [{ id_producto: 1, cantidad: 2 }] }, clientas[0]);
    const P1 = r.data.pedido;
    check("pedido de la tienda: total 205, descuento 20, envío 25, cupón asociado", r.status === 201 && n2(P1.total) === 205 && n2(P1.descuento) === 20 && n2(P1.costo_envio) === 25 && P1.id_cupon === idVerano, r.data);
    check("el cupón suma un uso", await usos("VERANO10") === 1);
    r = await call("GET", `/api/tienda/pedidos/${P1.id_pedido}`, undefined, clientas[0]);
    check("el detalle de la tienda trae el desglose (subtotal, descuento, envío, IVA) y el cupón", r.data.desglose && r.data.desglose.subtotal === 200 && r.data.desglose.descuento === 20 && r.data.desglose.costo_envio === 25 && r.data.desglose.total === 205 && r.data.desglose.iva === n2(205 - 205 / 1.12) && r.data.Cupon && r.data.Cupon.codigo === "VERANO10", r.data.desglose);
    r = await call("GET", `/api/pedidos/${P1.id_pedido}`, undefined, tok.C1);
    check("el panel también trae el desglose", r.data.desglose && r.data.desglose.descuento === 20, r.data.desglose);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, cupon: "VERANO10", retiro_en_sucursal: true, detalles: [{ id_producto: 1, cantidad: 2 }] }, clientas[1]);
    check("retiro en sucursal: sin dirección y sin envío (total 180)", r.status === 201 && r.data.pedido.direccion_entrega === null && n2(r.data.pedido.costo_envio) === 0 && n2(r.data.pedido.total) === 180, r.data);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, cupon: "VENCIDO", detalles: [{ id_producto: 1, cantidad: 2 }] }, clientas[2]);
    check("crear con un cupón que no aplica -> 400 (no se crea el pedido)", r.status === 400 && /no es válido/.test(r.data.message), r);
    const FJ = (await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, cupon: "FIJO50", detalles: [{ id_producto: 2, cantidad: 1 }] }, clientas[2])).data.pedido;
    check("cupón de monto fijo: 200 - 50 + 25 = 175", n2(FJ.total) === 175 && await usos("FIJO50") === 1, FJ);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, cupon: "FIJO50", detalles: [{ id_producto: 2, cantidad: 1 }] }, clientas[3]);
    check("cupón agotado (1 uso) -> 400", r.status === 400 && /no es válido/.test(r.data.message), r);
    r = await call("POST", `/api/tienda/pedidos/${FJ.id_pedido}/cancelar`, undefined, clientas[2]);
    check("al cancelar el pedido el uso del cupón se libera", r.status === 200 && await usos("FIJO50") === 0, r);
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, cupon: "FIJO50", detalles: [{ id_producto: 2, cantidad: 1 }] }, clientas[3]);
    check("…y otra clienta ya puede usarlo", r.status === 201 && await usos("FIJO50") === 1, r);
    const [u1, u2] = await Promise.all([
      call("POST", "/api/tienda/pedidos", { id_sucursal: 1, cupon: "UNICO", detalles: [{ id_producto: 1, cantidad: 1 }] }, clientas[4]),
      call("POST", "/api/tienda/pedidos", { id_sucursal: 1, cupon: "UNICO", detalles: [{ id_producto: 1, cantidad: 1 }] }, clientas[5]),
    ]);
    check("dos compras a la vez con un cupón de 1 uso: solo una lo obtiene", [u1.status, u2.status].sort().join() === "201,400" && await usos("UNICO") === 1, [u1.status, u2.status]);

    console.log("\n== Mostrador");
    r = await call("POST", "/api/pedidos/cotizar", { id_sucursal: 1, cupon: "VERANO10", detalles: [{ id_producto: 1, cantidad: 2 }] }, tok.C1);
    check("cotizar en mostrador: sin envío (200 - 20 = 180)", r.status === 200 && r.data.costo_envio === 0 && r.data.total === 180, r.data);
    r = await call("POST", "/api/pedidos/cotizar", { id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.B1);
    check("cotizar en mostrador es de caja (BODEGUERO -> 403)", r.status === 403, r);
    r = await call("POST", "/api/pedidos", { id_cliente: maria.id_cliente, id_sucursal: 1, cupon: "VERANO10", detalles: [{ id_producto: 1, cantidad: 2 }] }, tok.C1);
    const M = r.data.pedido;
    check("venta de mostrador con cupón: 180, sin envío", r.status === 201 && n2(M.total) === 180 && n2(M.costo_envio) === 0 && n2(M.descuento) === 20, r.data);
    r = await call("POST", "/api/detalles", { id_pedido: M.id_pedido, id_producto: 2, cantidad: 1 }, tok.C1);
    let m = (await q(`SELECT total::float, descuento::float FROM "Pedido" WHERE id_pedido=$1`, [M.id_pedido]))[0];
    check("agregar una línea recalcula el descuento del cupón (10% de 400 = 40 → 360)", r.status === 201 && m.descuento === 40 && m.total === 360, [r.status, m]);
    const lineaFalda = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1 AND id_producto=2`, [M.id_pedido]))[0].id_detalle_pedido;
    const lineaBlusa = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1 AND id_producto=1`, [M.id_pedido]))[0].id_detalle_pedido;
    await call("DELETE", `/api/detalles/${lineaFalda}`, undefined, tok.C1);
    await call("DELETE", `/api/detalles/${lineaBlusa}`, undefined, tok.C1);
    await call("POST", "/api/detalles", { id_pedido: M.id_pedido, id_producto: 1, cantidad: 1 }, tok.C1);
    m = (await q(`SELECT total::float, descuento::float FROM "Pedido" WHERE id_pedido=$1`, [M.id_pedido]))[0];
    check("si baja de la compra mínima, el cupón deja de descontar (100, sin descuento)", m.descuento === 0 && m.total === 100, m);
    await call("POST", "/api/detalles", { id_pedido: M.id_pedido, id_producto: 1, cantidad: 1 }, tok.C1);
    r = await call("POST", "/api/pagos", { id_pedido: M.id_pedido, metodo_pago: "EFECTIVO", monto: 180 }, tok.C1);
    check("se cobra el total con descuento (180) y pasa a PROCESADO", r.status === 201 && r.data.estado_pedido === "PROCESADO", r.data);

    console.log("\n== Reembolso con descuento y envío");
    for (const e of ["ENVIADO", "ENTREGADO"]) await call("PUT", `/api/pedidos/${M.id_pedido}/estado`, { estado: e }, tok.D);
    const lineaM = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1`, [M.id_pedido]))[0].id_detalle_pedido;
    r = await call("POST", "/api/devoluciones", { id_pedido: M.id_pedido, id_cliente: maria.id_cliente, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: lineaM, cantidad: 1 }] }, tok.C1);
    const idDev = r.data.devolucion.id_devolucion;
    await call("PUT", `/api/devoluciones/${idDev}/aprobar`, {}, tok.D);
    await call("PUT", `/api/devoluciones/${idDev}/recibir`, {}, tok.B1);
    const dd = (await q(`SELECT id_detalle_devolucion FROM "DetalleDevolucion" WHERE id_devolucion=$1`, [idDev]))[0].id_detalle_devolucion;
    await call("PUT", `/api/devoluciones/${idDev}/revisar`, { aceptar: true, detalles: [{ id_detalle_devolucion: dd, resultado_revision: "BUEN_ESTADO" }] }, tok.B1);
    r = await call("PUT", `/api/devoluciones/${idDev}/reintegrar`, undefined, tok.B1);
    check("devolver 1 de 2 blusas con 10% de descuento: se devuelven 90 (lo que pagó por ella)", r.status === 200 && r.data.reembolsos.length === 1 && Number(r.data.reembolsos[0].monto) === 90, r.data);
    // Pedido de la tienda con envío: se paga, se entrega y se devuelve todo. El envío no se devuelve.
    r = await call("POST", `/api/tienda/pedidos/${P1.id_pedido}/pago`, undefined, clientas[0]);
    for (const e of ["ENVIADO", "ENTREGADO"]) await call("PUT", `/api/pedidos/${P1.id_pedido}/estado`, { estado: e }, tok.D);
    const lineaP1 = (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1`, [P1.id_pedido]))[0].id_detalle_pedido;
    r = await call("POST", "/api/tienda/devoluciones", { id_pedido: P1.id_pedido, tipo: "DEVOLUCION", motivo: "OTRO", detalles: [{ id_detalle_pedido: lineaP1, cantidad: 2 }] }, clientas[0]);
    const idDev2 = r.data.devolucion.id_devolucion;
    await call("PUT", `/api/devoluciones/${idDev2}/aprobar`, {}, tok.D);
    await call("PUT", `/api/devoluciones/${idDev2}/recibir`, {}, tok.B1);
    const dd2 = (await q(`SELECT id_detalle_devolucion FROM "DetalleDevolucion" WHERE id_devolucion=$1`, [idDev2]))[0].id_detalle_devolucion;
    await call("PUT", `/api/devoluciones/${idDev2}/revisar`, { aceptar: true, detalles: [{ id_detalle_devolucion: dd2, resultado_revision: "BUEN_ESTADO" }] }, tok.B1);
    r = await call("PUT", `/api/devoluciones/${idDev2}/reintegrar`, undefined, tok.B1);
    check("devolución total de un pedido con envío: se devuelve lo de las prendas (180), no el envío (25)", r.status === 200 && Number(r.data.reembolsos[0].monto) === 180, r.data);

    console.log("\n== Reportes");
    r = await call("GET", `/api/reportes/resumen?desde=${dia(-1)}&hasta=${dia(1)}`, undefined, tok.D);
    const k = r.data.kpis || {};
    const ventas = (await q(`SELECT COALESCE(SUM(total),0)::float v, COALESCE(SUM(descuento),0)::float d, COALESCE(SUM(costo_envio),0)::float e FROM "Pedido" WHERE estado IN ('PROCESADO','ENVIADO','ENTREGADO')`))[0];
    check("KPIs: descuentos, envíos e IVA de las ventas", r.status === 200 && k.descuentos === ventas.d && k.envios === ventas.e && k.iva === n2(ventas.v - ventas.v / 1.12), [k, ventas]);
    check("KPIs: reembolsos entregados y ventas netas", k.reembolsos && typeof k.reembolsos.monto === "number" && k.ventas_netas === n2(k.ventas - k.reembolsos.monto), k);
    check("ventas por cupón", Array.isArray(r.data.por_cupon) && r.data.por_cupon.some((c) => c.codigo === "VERANO10" && c.pedidos >= 1 && c.descuento > 0), r.data.por_cupon);

    console.log("\n== Casos de la revisión");
    // Cupón que cubre toda la compra: total 0 → queda pagado al instante (no se queda trabado).
    r = await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, cupon: "TODO", retiro_en_sucursal: true, detalles: [{ id_producto: 1, cantidad: 1 }] }, clientas[1]);
    check("cupón del 100% con retiro: total 0 y el pedido queda PROCESADO", r.status === 201 && n2(r.data.pedido.total) === 0 && r.data.pedido.estado === "PROCESADO", r.data);
    r = await call("POST", "/api/pedidos", { id_cliente: maria.id_cliente, id_sucursal: 1, cupon: "TODO", detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.C1);
    check("…y en mostrador también", r.status === 201 && r.data.pedido.estado === "PROCESADO", r.data);
    // El envío se recalcula si caja agrega o quita prendas en un pedido de la tienda a domicilio.
    const E = (await call("POST", "/api/tienda/pedidos", { id_sucursal: 1, detalles: [{ id_producto: 1, cantidad: 2 }] }, clientas[2])).data.pedido;
    check("pedido a domicilio de 200: envío 25 (total 225)", n2(E.total) === 225 && n2(E.costo_envio) === 25, E);
    r = await call("POST", "/api/detalles", { id_pedido: E.id_pedido, id_producto: 2, cantidad: 1 }, tok.C1);
    let e = (await q(`SELECT total::float, costo_envio::float FROM "Pedido" WHERE id_pedido=$1`, [E.id_pedido]))[0];
    check("caja agrega una falda: 400 ≥ 300, el envío pasa a gratis", r.status === 201 && e.costo_envio === 0 && e.total === 400, e);
    const lineasE = await q(`SELECT id_detalle_pedido, id_producto FROM "DetallePedido" WHERE id_pedido=$1 ORDER BY id_producto`, [E.id_pedido]);
    await call("DELETE", `/api/detalles/${lineasE[1].id_detalle_pedido}`, undefined, tok.C1);
    e = (await q(`SELECT total::float, costo_envio::float FROM "Pedido" WHERE id_pedido=$1`, [E.id_pedido]))[0];
    check("la quita: vuelve a cobrar envío (225)", e.costo_envio === 25 && e.total === 225, e);
    await call("DELETE", `/api/detalles/${lineasE[0].id_detalle_pedido}`, undefined, tok.C1);
    e = (await q(`SELECT total::float, costo_envio::float, estado FROM "Pedido" WHERE id_pedido=$1`, [E.id_pedido]))[0];
    check("sin prendas no se cobra envío (total 0) y sigue PENDIENTE (no se da por pagado)", e.costo_envio === 0 && e.total === 0 && e.estado === "PENDIENTE", e);
    // Editar un cupón no cambia el precio de pedidos ya creados.
    const M2 = (await call("POST", "/api/pedidos", { id_cliente: maria.id_cliente, id_sucursal: 1, cupon: "VERANO10", detalles: [{ id_producto: 1, cantidad: 2 }] }, tok.C1)).data.pedido;
    await call("PUT", `/api/cupones/${idVerano}`, { valor: 50 }, tok.D);
    await call("POST", "/api/detalles", { id_pedido: M2.id_pedido, id_producto: 1, cantidad: 1 }, tok.C1);
    const m2 = (await q(`SELECT total::float, descuento::float FROM "Pedido" WHERE id_pedido=$1`, [M2.id_pedido]))[0];
    check("editar el cupón (10% → 50%) no cambia un pedido ya creado: sigue con 10% (300 − 30)", m2.descuento === 30 && m2.total === 270, m2);
    await call("PUT", `/api/cupones/${idVerano}`, { valor: 10 }, tok.D);
    // Un cupón usado solo en pedidos cancelados sí se puede eliminar.
    await nuevo({ codigo: "CANCELADO1", tipo: "MONTO", valor: 5 });
    const PC = (await call("POST", "/api/pedidos", { id_cliente: maria.id_cliente, id_sucursal: 1, cupon: "CANCELADO1", detalles: [{ id_producto: 1, cantidad: 1 }] }, tok.C1)).data.pedido;
    await call("PUT", `/api/pedidos/${PC.id_pedido}/estado`, { estado: "CANCELADO" }, tok.C1);
    const idCanc = (await q(`SELECT id_cupon FROM "Cupon" WHERE codigo='CANCELADO1'`))[0].id_cupon;
    r = await call("DELETE", `/api/cupones/${idCanc}`, undefined, tok.D);
    check("cupón usado solo en un pedido cancelado: se puede eliminar", r.status === 200, r);
    // Las ventas por prenda descuentan el cupón: suman lo mismo que las ventas sin los envíos.
    r = await call("GET", `/api/reportes/resumen?desde=${dia(-1)}&hasta=${dia(1)}`, undefined, tok.D);
    const sumaPrendas = r.data.por_prenda.reduce((s, x) => s + x.ventas, 0);
    check("ventas por prenda = ventas − envíos (descuentos prorrateados)", Math.abs(sumaPrendas - (r.data.kpis.ventas - r.data.kpis.envios)) < 0.05, [sumaPrendas, r.data.kpis.ventas, r.data.kpis.envios]);

    console.log("\n== Editar y eliminar cupones");
    r = await call("PUT", `/api/cupones/${idVerano}`, { codigo: "OTRO" }, tok.D);
    check("un cupón usado no cambia de código -> 400", r.status === 400, r);
    r = await call("PUT", `/api/cupones/${idVerano}`, { valor: 15, activo: false }, tok.D);
    check("sí se puede cambiar el valor o desactivarlo", r.status === 200 && Number(r.data.valor) === 15 && r.data.activo === false, r.data);
    r = await call("DELETE", `/api/cupones/${idVerano}`, undefined, tok.D);
    check("un cupón usado no se elimina (se desactiva) -> 400", r.status === 400, r);
    const idApagado = (await q(`SELECT id_cupon FROM "Cupon" WHERE codigo='APAGADO'`))[0].id_cupon;
    r = await call("DELETE", `/api/cupones/${idApagado}`, undefined, tok.D);
    check("un cupón sin usar se elimina", r.status === 200, r);
    r = await call("PUT", `/api/cupones/${idApagado}`, { valor: 1 }, tok.D);
    check("cupón inexistente -> 404", r.status === 404, r);
  } catch (e) {
    fails.push("excepción: " + e.message);
    console.log("EXCEPCIÓN", e);
  } finally {
    srv.kill();
    await pg.end().catch(() => {});
  }
  console.log(`\nRESULTADO: ${passes} ok, ${fails.length} fallos`);
  if (fails.length) { console.log(fails.map((f) => " - " + f).join("\n")); process.exitCode = 1; }
})();
