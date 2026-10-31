// E2E de los comprobantes de entrada (CE) y salida (CS) de mercadería: ingreso de proveedor con
// varias prendas, ingreso directo, ventas (al concretarse el pago, una sola vez), bajas por ajuste,
// devoluciones reintegradas y cambios; numeración correlativa sin huecos (también con ingresos
// simultáneos y operaciones que se revierten), alcance por sucursal, filtros y solo lectura.
const B = require("path").resolve(__dirname, "..", "..");
const SALIDAS = require("path").join(B, "tests", "salidas");
require("fs").mkdirSync(SALIDAS, { recursive: true });
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { Client } = require(B + "/node_modules/pg");

const PORT = 18066;
const ENV = {
  NODE_ENV: "development", PORT: String(PORT), DB_HOST: "localhost", DB_USER: "tester", DB_PASSWORD: "x", DB_NAME: "distrib_test",
  DB_DIALECT: "postgres", DB_SSL: "false", DB_PORT: "54329", JWT_SECRET: "secret_test", STRIPE_WEBHOOK_SECRET: "whsec_x",
  STRIPE_SECRET_KEY: "sk_test_clave_de_prueba_universidad", CORREO_MODO: "archivo", CORREO_CARPETA: path.join(SALIDAS, "correos-comprobantes"),
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
const stock = async (p, s, estado = "DISPONIBLE") => Number((await q(`SELECT COALESCE(SUM(cantidad),0) n FROM "Inventario" WHERE id_producto=$1 AND id_sucursal=$2 AND estado=$3`, [p, s, estado]))[0].n);
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala" }).format(new Date());
const numeros = async (tipo) => (await q(`SELECT numero FROM "Comprobante" WHERE tipo=$1 ORDER BY numero`, [tipo])).map((x) => x.numero);
const consecutivos = (ns) => ns.every((n, i) => n === i + 1);

(async () => {
  if (await ocupado(PORT)) { console.error("ABORTADO: puerto ocupado"); process.exit(1); }
  await pg.connect();
  await pg.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const out = fs.openSync(path.join(SALIDAS, "comprobantes-servidor.log"), "w");
  const srv = spawn(process.execPath, ["server.js"], { cwd: B, env: { ...process.env, ...ENV }, stdio: ["ignore", out, out] });
  try {
    let listo = false;
    for (let i = 0; i < 160 && !listo; i++) { await sleep(500); try { listo = (await fetch(`http://localhost:${PORT}/`)).ok; } catch {} }
    check("servidor arriba", listo);
    check("migración: tablas Comprobante, DetalleComprobante y ContadorComprobante con sus índices únicos",
      (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('Comprobante','DetalleComprobante','ContadorComprobante')`))[0].n === 3
      && (await q(`SELECT count(*)::int n FROM pg_indexes WHERE indexname IN ('comprobante_tipo_numero_unico','comprobante_venta_unica','comprobante_devolucion_unica')`))[0].n === 3);

    // ---- Seed: Blusa M (1), Blusa L (2, variante), Falda (3); Centro (1) y Norte (2).
    await q(`INSERT INTO "Sucursal"(nombre,direccion,ciudad,activo) VALUES ('Centro','6a Av 1-1','Guatemala',true),('Norte','Calz. Norte','Mixco',true)`);
    await q(`INSERT INTO "Categoria"(nombre) VALUES ('Blusas')`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,color,id_categoria) VALUES ('Blusa',100,1,true,'M','Rosa',1)`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,color,id_categoria,id_producto_padre) VALUES ('Blusa',100,1,true,'L','Rosa',1,1)`);
    await q(`INSERT INTO "Producto"(nombre,precio_unitario,stock_minimo,activo,talla,id_categoria) VALUES ('Falda',150,1,true,'U',1)`);
    const tok = {};
    await call("POST", "/api/auth/registro", { nombre: "Dina", apellido: "Distrital", email: "dist@t.com", password: "Clave1234" });
    tok.D = (await call("POST", "/api/auth/login", { email: "dist@t.com", password: "Clave1234" })).data.token;
    for (const [k, puesto, suc] of [["A1", "ADMIN", 1], ["C1", "CAJERO", 1], ["B1", "BODEGUERO", 1], ["B2", "BODEGUERO", 2], ["C2", "CAJERO", 2]]) {
      await call("POST", "/api/auth/registro", { nombre: k, apellido: "T", puesto, email: `${k}@t.com`, password: "Clave1234", id_sucursal: suc }, tok.D);
      tok[k] = (await call("POST", "/api/auth/login", { email: `${k}@t.com`, password: "Clave1234" })).data.token;
    }
    check("tokens de distrital, gerente, caja y bodega", Object.values(tok).every(Boolean) && Object.keys(tok).length === 6);
    const prov = (await call("POST", "/api/proveedores", { nombre_empresa: "Textiles Maya", nombre_contacto: "Luis", telefono: "22223333" }, tok.B1)).data;
    const provInactivo = (await call("POST", "/api/proveedores", { nombre_empresa: "Telas Viejas" }, tok.B1)).data;
    await call("PUT", `/api/proveedores/${provInactivo.id_proveedor}`, { activo: false }, tok.B1);

    console.log("\n== Ingreso de proveedor con varias prendas");
    const ingreso = (body, t = tok.B1) => call("POST", "/api/inventario/ingresos", body, t);
    const base = { id_sucursal: 1, id_proveedor: prov.id_proveedor, documento_proveedor: "FAC-A-1001" };
    let r = await ingreso({ ...base, observacion: "Pedido de temporada", lineas: [
      { id_producto: 1, cantidad: 40, lote: "L-ROSA-M", costo_unitario: 45.5 },
      { id_producto: 2, cantidad: 30, costo_unitario: 45.5 },
      { id_producto: 3, cantidad: 25, costo_unitario: "70" },
      { id_producto: 1, cantidad: 2, estado: "DEFECTUOSA", lote: "L-ROSA-M" },
    ] });
    const ce1 = r.data.comprobante;
    check("201 con el comprobante CE-000001 completo", r.status === 201 && ce1 && ce1.folio === "CE-000001" && ce1.tipo === "ENTRADA" && ce1.concepto === "INGRESO_PROVEEDOR" && /CE-000001/.test(r.data.message), r.data);
    check("lleva proveedor, documento, sucursal, responsable y observación", ce1.Proveedor.nombre_empresa === "Textiles Maya" && ce1.documento_proveedor === "FAC-A-1001" && ce1.Sucursal.nombre === "Centro" && ce1.Empleado.nombre === "B1" && ce1.motivo === "Pedido de temporada", ce1);
    check("4 líneas con descripción copiada, estado y lote", ce1.lineas.length === 4 && ce1.lineas[0].descripcion === "Blusa M Rosa" && ce1.lineas[0].lote === "L-ROSA-M" && ce1.lineas[3].estado_inventario === "DEFECTUOSA", ce1.lineas);
    check("totales: 97 unidades y valor 45.5*70 + 70*25 = 4935", ce1.total_unidades === 97 && Number(ce1.valor_total) === 4935 && Number(ce1.lineas[0].subtotal) === 1820 && ce1.lineas[3].valor_unitario === null, [ce1.total_unidades, ce1.valor_total]);
    check("el stock entra: 40 blusas M disponibles, 2 defectuosas, 30 L, 25 faldas", await stock(1, 1) === 40 && await stock(1, 1, "DEFECTUOSA") === 2 && await stock(2, 1) === 30 && await stock(3, 1) === 25);
    const movs = await q(`SELECT tipo_movimiento, cantidad, observacion, id_empleado FROM "MovimientoInventario" WHERE tipo_movimiento='INGRESO' ORDER BY id_movimiento`);
    check("un movimiento INGRESO por línea, con el folio y el proveedor (trazabilidad)", movs.length === 4 && movs.every((m) => /CE-000001 de Textiles Maya \(documento FAC-A-1001\)/.test(m.observacion) && m.id_empleado), movs);
    const aud = await q(`SELECT accion, detalles FROM auditoria WHERE accion='INVENTARIO_INGRESADO'`);
    check("auditoría del ingreso", aud.length === 1 && /CE-000001: ingreso de 97 u\. en 4 línea/.test(aud[0].detalles), aud);

    console.log("\n== Validaciones del ingreso (nada se guarda)");
    const antes = { ce: (await numeros("ENTRADA")).length, inv: (await q(`SELECT count(*)::int n FROM "Inventario"`))[0].n };
    const casos = [
      [{ ...base, lineas: [] }, 400, "sin líneas"],
      [{ ...base, lineas: Array.from({ length: 101 }, () => ({ id_producto: 1, cantidad: 1 })) }, 400, "más de 100 líneas"],
      [{ ...base, lineas: [{ id_producto: 1, cantidad: 0 }] }, 400, "cantidad 0"],
      [{ ...base, lineas: [{ id_producto: 1, cantidad: 2.5 }] }, 400, "cantidad decimal"],
      [{ ...base, lineas: [{ id_producto: 1, cantidad: 100001 }] }, 400, "cantidad enorme"],
      [{ ...base, lineas: [{ id_producto: 1, cantidad: 1, costo_unitario: -1 }] }, 400, "costo negativo"],
      [{ ...base, lineas: [{ id_producto: 1, cantidad: 1, costo_unitario: 1.005 }] }, 400, "costo con 3 decimales"],
      [{ ...base, lineas: [{ id_producto: 1, cantidad: 1, costo_unitario: true }] }, 400, "costo booleano"],
      [{ ...base, lineas: [{ id_producto: 1, cantidad: 1, estado: "VENDIDA" }] }, 400, "estado inválido"],
      [{ ...base, lineas: [{ id_producto: 999, cantidad: 1 }] }, 400, "prenda inexistente"],
      [{ ...base, lineas: [{ id_producto: 1, cantidad: 1 }, { id_producto: 998, cantidad: 1 }, { id_producto: 999, cantidad: 1 }] }, 400, "varias prendas inexistentes"],
      [{ ...base, id_proveedor: 999, lineas: [{ id_producto: 1, cantidad: 1 }] }, 400, "proveedor inexistente"],
      [{ ...base, id_proveedor: provInactivo.id_proveedor, lineas: [{ id_producto: 1, cantidad: 1 }] }, 400, "proveedor inactivo"],
      [{ id_sucursal: 1, documento_proveedor: "X-1", lineas: [{ id_producto: 1, cantidad: 1 }] }, 400, "documento sin proveedor"],
      [{ ...base, documento_proveedor: "x".repeat(61), lineas: [{ id_producto: 1, cantidad: 1 }] }, 400, "documento de más de 60"],
      [{ ...base, id_sucursal: 99, lineas: [{ id_producto: 1, cantidad: 1 }] }, 403, "sucursal ajena para el bodeguero"],
      [{ ...base, id_sucursal: 2, lineas: [{ id_producto: 1, cantidad: 1 }] }, 403, "otra sucursal"],
      [{ ...base, lineas: "no" }, 400, "líneas que no son lista"],
    ];
    for (const [body, estado, n] of casos) {
      r = await ingreso(body);
      check(`${n} -> ${estado}`, r.status === estado && r.data.message, r);
    }
    r = await ingreso({ ...base, lineas: [{ id_producto: 1, cantidad: 1 }] }, tok.C1);
    check("un cajero no ingresa mercadería -> 403", r.status === 403, r);
    r = await ingreso({ ...base, id_sucursal: 99, lineas: [{ id_producto: 1, cantidad: 1 }] }, tok.D);
    check("el distrital con una sucursal inexistente -> 400", r.status === 400 && /sucursal 99 no existe/.test(r.data.message), r);
    check("ningún intento fallido gastó número ni dejó inventario", (await numeros("ENTRADA")).length === antes.ce && (await q(`SELECT count(*)::int n FROM "Inventario"`))[0].n === antes.inv);

    console.log("\n== Ingreso directo (sin proveedor) y el ingreso de una prenda de siempre");
    r = await ingreso({ id_sucursal: 2, lineas: [{ id_producto: 1, cantidad: 20 }, { id_producto: 2, cantidad: 10 }] }, tok.B2);
    check("Norte: ingreso directo CE-000002 (sin proveedor ni valor)", r.status === 201 && r.data.comprobante.folio === "CE-000002" && r.data.comprobante.concepto === "INGRESO_DIRECTO" && r.data.comprobante.Proveedor === null && r.data.comprobante.valor_total === null, r.data);
    r = await call("POST", "/api/inventario", { id_producto: 3, id_sucursal: 1, cantidad: 5, lote: "VIEJO" }, tok.B1);
    check("POST /api/inventario (una prenda) sigue respondiendo la fila y además su comprobante CE-000003", r.status === 201 && r.data.id_inventario && r.data.cantidad === 5 && r.data.comprobante && r.data.comprobante.folio === "CE-000003", r.data);
    r = await call("POST", "/api/inventario", { id_producto: 3, id_sucursal: 1, cantidad: -5 }, tok.B1);
    check("…y sigue rechazando cantidades negativas", r.status === 400 && /ajuste/.test(r.data.message), r);
    for (const [body, n] of [
      [{ ...base, lineas: [{ id_producto: 1, cantidad: 100000, costo_unitario: 1000000 }] }, "una línea de 100000 × Q1000000"],
      [{ ...base, lineas: Array.from({ length: 100 }, () => ({ id_producto: 1, cantidad: 100, costo_unitario: 1000000 })) }, "100 líneas que suman Q10000 millones"],
    ]) {
      r = await ingreso(body);
      check(`valor que no cabe en el comprobante (${n}) -> 400 claro, sin error de la base`, r.status === 400 && /demasiado grande/.test(r.data.message), r);
    }
    r = await call("POST", "/api/inventario", { id_producto: 3, id_sucursal: 1, cantidad: 100000, costo_unitario: 1000000 }, tok.B1);
    check("…también en el ingreso de una prenda", r.status === 400 && /demasiado grande/.test(r.data.message), r);
    const loteLargo = "LOTE-" + "x".repeat(75);
    r = await call("POST", "/api/inventario", { id_producto: 3, id_sucursal: 1, cantidad: 1, lote: loteLargo }, tok.B1);
    const loteCe = (await q(`SELECT d.lote FROM "DetalleComprobante" d WHERE d.id_comprobante=$1`, [r.data.comprobante && r.data.comprobante.id_comprobante]))[0];
    check("un lote de 80 caracteres queda igual en el inventario y en el comprobante", r.status === 201 && r.data.lote === loteLargo && loteCe && loteCe.lote === loteLargo, [r.data.lote, loteCe]);

    console.log("\n== Ingresos simultáneos: números únicos y consecutivos");
    const simultaneos = await Promise.all(Array.from({ length: 8 }, (_, i) => ingreso({ id_sucursal: 1, lineas: [{ id_producto: 3, cantidad: i + 1 }] })));
    check("los 8 responden 201", simultaneos.every((x) => x.status === 201), simultaneos.map((x) => x.status));
    check("CE-000001 a CE-000012 sin huecos ni repetidos", consecutivos(await numeros("ENTRADA")) && (await numeros("ENTRADA")).length === 12, await numeros("ENTRADA"));

    console.log("\n== Ventas: la salida se emite al concretarse el pago, una sola vez");
    const maria = (await call("POST", "/api/clientes", { nombre: "María", apellido: "Mostrador", email: "maria@x.com" }, tok.C1)).data;
    const venta = async (detalles, extra = {}) => (await call("POST", "/api/pedidos", { id_cliente: maria.id_cliente, id_sucursal: 1, detalles, ...extra }, tok.C1)).data.pedido;
    const pagar = (id, monto) => call("POST", "/api/pagos", { id_pedido: id, metodo_pago: "EFECTIVO", monto }, tok.C1);
    const csDe = async (id) => q(`SELECT * FROM "Comprobante" WHERE id_pedido=$1 AND concepto='VENTA'`, [id]);
    const p1 = await venta([{ id_producto: 1, cantidad: 3 }, { id_producto: 3, cantidad: 1 }]);
    check("venta creada (PENDIENTE): el stock se aparta pero todavía no hay comprobante", p1 && (await csDe(p1.id_pedido)).length === 0 && await stock(1, 1) === 37);
    await pagar(p1.id_pedido, 200);
    check("pago parcial: aún sin comprobante", (await csDe(p1.id_pedido)).length === 0);
    r = await pagar(p1.id_pedido, 250);
    let cs = await csDe(p1.id_pedido);
    check("pago completo -> PROCESADO y comprobante de salida CS-000001", r.data.estado_pedido === "PROCESADO" && cs.length === 1 && cs[0].numero === 1 && cs[0].tipo === "SALIDA" && cs[0].total_unidades === 4 && Number(cs[0].valor_total) === 450, [r.data, cs]);
    const lineasCs = await q(`SELECT descripcion, cantidad, valor_unitario, subtotal FROM "DetalleComprobante" WHERE id_comprobante=$1 ORDER BY id_detalle_comprobante`, [cs[0].id_comprobante]);
    check("líneas de la venta con precio de venta", lineasCs.length === 2 && lineasCs[0].descripcion === "Blusa M Rosa" && Number(lineasCs[0].subtotal) === 300 && Number(lineasCs[1].valor_unitario) === 150, lineasCs);
    check("lo emitió la cajera que cobró", cs[0].id_empleado === (await q(`SELECT id_empleado FROM "Empleado" WHERE lower(email)='c1@t.com'`))[0].id_empleado);
    for (const estado of ["ENVIADO", "ENTREGADO"]) await call("PUT", `/api/pedidos/${p1.id_pedido}/estado`, { estado }, tok.D);
    check("enviar y entregar no emiten otro comprobante", (await csDe(p1.id_pedido)).length === 1);

    const p2 = await venta([{ id_producto: 3, cantidad: 2 }]);
    await call("PUT", `/api/pedidos/${p2.id_pedido}/estado`, { estado: "CANCELADO" }, tok.C1);
    check("venta cancelada sin pagar: ningún comprobante (el stock nunca salió)", (await csDe(p2.id_pedido)).length === 0 && (await q(`SELECT estado FROM "Pedido" WHERE id_pedido=$1`, [p2.id_pedido]))[0].estado === "CANCELADO");

    // Pagado por fuera del flujo automático: se pasa a PROCESADO a mano.
    const p3 = await venta([{ id_producto: 2, cantidad: 1 }]);
    await q(`INSERT INTO "Pago"(id_pedido, monto, metodo_pago, estado_pago, fecha_pago) VALUES ($1, 100, 'EFECTIVO', 'COMPLETADO', now())`, [p3.id_pedido]);
    r = await call("PUT", `/api/pedidos/${p3.id_pedido}/estado`, { estado: "PROCESADO" }, tok.C1);
    check("PROCESADO a mano también emite su comprobante de salida (CS-000002)", r.status === 200 && (await csDe(p3.id_pedido)).length === 1 && (await csDe(p3.id_pedido))[0].numero === 2, r);

    await call("POST", "/api/cupones", { codigo: "GRATIS", tipo: "PORCENTAJE", valor: 100 }, tok.D);
    const p4 = await venta([{ id_producto: 3, cantidad: 1 }], { cupon: "GRATIS" });
    check("venta cubierta por un cupón (total 0): PROCESADO al crearse y con su CS-000003", p4.estado === "PROCESADO" && (await csDe(p4.id_pedido)).length === 1 && (await csDe(p4.id_pedido))[0].numero === 3, p4);
    const cs4 = (await csDe(p4.id_pedido))[0];
    check("…su valor es lo cobrado por la mercadería: 150 − 150 de descuento = 0", Number(cs4.descuento) === 150 && Number(cs4.valor_total) === 0 && /descuento de cupón de Q150\.00/.test(cs4.motivo), cs4);
    let dup = null;
    try { await q(`INSERT INTO "Comprobante"(tipo,numero,concepto,id_sucursal,id_pedido,total_unidades,fecha) VALUES ('SALIDA',999,'VENTA',1,$1,1,now())`, [p4.id_pedido]); } catch (e) { dup = e.message; }
    check("la base impide un segundo comprobante de venta para el mismo pedido", /comprobante_venta_unica/.test(dup || ""), dup);

    console.log("\n== Baja por ajuste");
    const filaM = (await q(`SELECT id_inventario, cantidad FROM "Inventario" WHERE id_producto=1 AND id_sucursal=1 AND estado='DISPONIBLE' ORDER BY id_inventario LIMIT 1`))[0];
    const filaDef = (await q(`SELECT id_inventario, cantidad FROM "Inventario" WHERE id_producto=1 AND id_sucursal=1 AND estado='DEFECTUOSA'`))[0];
    r = await call("POST", "/api/inventario/ajustes", { id_sucursal: 1, motivo: "DESCARTE", observacion: "Costuras abiertas", ajustes: [
      { id_inventario: filaM.id_inventario, cantidad_actual: filaM.cantidad, cantidad_nueva: filaM.cantidad - 1 },
      { id_inventario: filaDef.id_inventario, cantidad_actual: filaDef.cantidad, cantidad_nueva: 0 },
    ] }, tok.B1);
    check("ajuste 200 con su comprobante CS-000004 en la respuesta", r.status === 200 && r.data.comprobante && r.data.comprobante.folio === "CS-000004" && /CS-000004/.test(r.data.message), r.data);
    const baja = (await call("GET", `/api/comprobantes/${r.data.comprobante.id_comprobante}`, undefined, tok.B1)).data;
    check("la baja lleva concepto, motivo y una línea por fila (con su estado y lote)", baja.concepto === "BAJA" && /Descarte de prenda dañada o defectuosa\. Costuras abiertas/.test(baja.motivo) && baja.lineas.length === 2 && baja.total_unidades === 3 && baja.lineas.some((l) => l.estado_inventario === "DEFECTUOSA" && l.cantidad === 2 && l.lote === "L-ROSA-M"), baja);
    r = await call("POST", "/api/inventario/ajustes", { id_sucursal: 1, motivo: "PERDIDA", ajustes: [{ id_inventario: filaM.id_inventario, cantidad_actual: 999, cantidad_nueva: 0 }] }, tok.B1);
    check("un ajuste rechazado (409: el stock cambió) no gasta número", r.status === 409 && consecutivos(await numeros("SALIDA")) && (await numeros("SALIDA")).length === 4, [r.status, await numeros("SALIDA")]);

    console.log("\n== Devolución reintegrada y cambio de talla");
    const dev = async (id_pedido, tipo, detalles) => (await call("POST", "/api/devoluciones", { id_pedido, id_cliente: maria.id_cliente, tipo, motivo: "OTRO", detalles }, tok.C1));
    const linea = async (idPedido, idProducto) => (await q(`SELECT id_detalle_pedido FROM "DetallePedido" WHERE id_pedido=$1 AND id_producto=$2`, [idPedido, idProducto]))[0].id_detalle_pedido;
    async function hastaAceptada(idDev, resultados) {
      await call("PUT", `/api/devoluciones/${idDev}/aprobar`, {}, tok.D);
      await call("PUT", `/api/devoluciones/${idDev}/recibir`, {}, tok.B1);
      const dets = await q(`SELECT id_detalle_devolucion FROM "DetalleDevolucion" WHERE id_devolucion=$1 ORDER BY id_detalle_devolucion`, [idDev]);
      return (await call("PUT", `/api/devoluciones/${idDev}/revisar`, { aceptar: true, detalles: dets.map((d, i) => ({ id_detalle_devolucion: d.id_detalle_devolucion, resultado_revision: resultados[i] })) }, tok.B1)).status === 200;
    }
    r = await dev(p1.id_pedido, "DEVOLUCION", [{ id_detalle_pedido: await linea(p1.id_pedido, 1), cantidad: 2 }, { id_detalle_pedido: await linea(p1.id_pedido, 3), cantidad: 1 }]);
    const devId = r.data.devolucion && r.data.devolucion.id_devolucion;
    check("devolución solicitada y aceptada (una prenda dañada)", r.status === 201 && await hastaAceptada(devId, ["BUEN_ESTADO", "DANADO"]), r);
    const stockAntes = await stock(1, 1);
    r = await call("PUT", `/api/devoluciones/${devId}/reintegrar`, undefined, tok.B1);
    let deDev = (await call("GET", `/api/comprobantes?id_devolucion=${devId}`, undefined, tok.B1)).data;
    check("reintegrar emite el comprobante de entrada CE-000013 por la devolución", r.status === 200 && deDev.length === 1 && deDev[0].folio === "CE-000013" && deDev[0].concepto === "DEVOLUCION" && deDev[0].id_pedido === p1.id_pedido, [r.status, deDev]);
    const ceDev = (await call("GET", `/api/comprobantes/${deDev[0].id_comprobante}`, undefined, tok.B1)).data;
    check("…con cada prenda en el estado de su inspección", ceDev.lineas.length === 2 && ceDev.lineas.find((l) => l.id_producto === 1).estado_inventario === "DISPONIBLE" && ceDev.lineas.find((l) => l.id_producto === 3).estado_inventario === "DANADA" && ceDev.Devolucion.id_devolucion === devId && ceDev.Pedido.Cliente.nombre === "María", ceDev);
    check("el stock coincide con el comprobante", await stock(1, 1) === stockAntes + 2 && await stock(3, 1, "DANADA") === 1);
    r = await call("PUT", `/api/devoluciones/${devId}/reintegrar`, undefined, tok.B1);
    check("reintegrar otra vez -> 400 y no emite otro comprobante", r.status === 400 && (await q(`SELECT count(*)::int n FROM "Comprobante" WHERE id_devolucion=$1`, [devId]))[0].n === 1);

    const p5 = await venta([{ id_producto: 1, cantidad: 1 }]);
    await pagar(p5.id_pedido, 100);
    for (const estado of ["ENVIADO", "ENTREGADO"]) await call("PUT", `/api/pedidos/${p5.id_pedido}/estado`, { estado }, tok.D);
    r = await dev(p5.id_pedido, "CAMBIO_TALLA", [{ id_detalle_pedido: await linea(p5.id_pedido, 1), cantidad: 1, id_producto_nuevo: 2 }]);
    const camId = r.data.devolucion && r.data.devolucion.id_devolucion;
    check("cambio de talla M -> L aceptado", r.status === 201 && await hastaAceptada(camId, ["BUEN_ESTADO"]), r);
    const stockL = await stock(2, 1);
    r = await call("PUT", `/api/devoluciones/${camId}/cambiar`, undefined, tok.B1);
    deDev = (await call("GET", `/api/comprobantes?id_devolucion=${camId}`, undefined, tok.D)).data;
    const ceCam = deDev.find((c) => c.tipo === "ENTRADA"), csCam = deDev.find((c) => c.tipo === "SALIDA");
    check("el cambio emite dos comprobantes: entrada CE-000014 y salida CS-000006", r.status === 200 && deDev.length === 2 && ceCam.folio === "CE-000014" && csCam.folio === "CS-000006" && ceCam.concepto === "CAMBIO" && csCam.concepto === "CAMBIO", [r.status, deDev]);
    const csCamD = (await call("GET", `/api/comprobantes/${csCam.id_comprobante}`, undefined, tok.D)).data;
    const ceCamD = (await call("GET", `/api/comprobantes/${ceCam.id_comprobante}`, undefined, tok.D)).data;
    check("entra la talla M que devuelve la clienta y sale la L que se le entrega", ceCamD.lineas[0].id_producto === 1 && csCamD.lineas[0].id_producto === 2 && csCamD.lineas[0].descripcion === "Blusa L Rosa" && await stock(2, 1) === stockL - 1, [ceCamD.lineas, csCamD.lineas]);
    check("numeración de salidas sin huecos (CS-000001 a CS-000006)", consecutivos(await numeros("SALIDA")) && (await numeros("SALIDA")).length === 6, await numeros("SALIDA"));

    console.log("\n== Consulta: alcance por sucursal, filtros y búsqueda");
    r = await call("GET", "/api/comprobantes", undefined, tok.D);
    check("el distrital ve los 20 comprobantes, del más reciente al más antiguo", r.status === 200 && r.data.length === 20 && r.data[0].id_comprobante > r.data[19].id_comprobante && r.data.every((c) => /^C[ES]-\d{6}$/.test(c.folio)), r.data.length);
    r = await call("GET", "/api/comprobantes", undefined, tok.B2);
    check("la bodega de Norte solo ve el de Norte", r.status === 200 && r.data.length === 1 && r.data[0].folio === "CE-000002", r.data.map((c) => c.folio));
    r = await call("GET", "/api/comprobantes?id_sucursal=1", undefined, tok.B2);
    check("pedir otra sucursal -> 403", r.status === 403, r);
    r = await call("GET", `/api/comprobantes/${ce1.id_comprobante}`, undefined, tok.C2);
    check("ver un comprobante de otra sucursal -> 404", r.status === 404, r);
    r = await call("GET", `/api/comprobantes/${ce1.id_comprobante}`, undefined, tok.C1);
    check("la cajera de Centro sí lo ve", r.status === 200 && r.data.folio === "CE-000001", r);
    r = await call("GET", "/api/comprobantes?tipo=SALIDA&concepto=VENTA", undefined, tok.D);
    check("filtro tipo y concepto (4 ventas pagadas)", r.data.length === 4 && r.data.every((c) => c.concepto === "VENTA"), r.data.length);
    for (const [busqueda, folio] of [["ce-1", "CE-000001"], ["CS-000004", "CS-000004"], ["CE 000013", "CE-000013"], ["textiles", "CE-000001"], ["FAC-A", "CE-000001"]]) {
      r = await call("GET", `/api/comprobantes?q=${encodeURIComponent(busqueda)}`, undefined, tok.D);
      check(`buscar "${busqueda}" encuentra ${folio}`, r.status === 200 && r.data.length >= 1 && r.data[0].folio === folio && (busqueda.startsWith("c") || busqueda.startsWith("C") ? r.data.length === 1 : true), r.data.map((c) => c.folio));
    }
    r = await call("GET", `/api/comprobantes?q=${p1.id_pedido}`, undefined, tok.D);
    check("buscar un número encuentra el folio con ese número y los del pedido", r.data.some((c) => c.id_pedido === p1.id_pedido) && r.data.some((c) => c.numero === p1.id_pedido), r.data.map((c) => c.folio));
    r = await call("GET", `/api/comprobantes?desde=${hoy()}&hasta=${hoy()}&pagina=1&por_pagina=5`, undefined, tok.D);
    check("hoy, paginado: 5 de 20 en 4 páginas", r.status === 200 && r.data.datos.length === 5 && r.data.total === 20 && r.data.paginas === 4, { ...r.data, datos: undefined });
    r = await call("GET", "/api/comprobantes?desde=2020-01-01&hasta=2020-01-31", undefined, tok.D);
    check("un periodo sin movimientos: lista vacía", r.status === 200 && r.data.length === 0);
    for (const [u, n] of [["tipo=OTRO", "tipo inválido"], ["concepto=REGALO", "concepto inválido"], ["desde=2026-02-30", "fecha que no existe"], ["desde=2026-05-02&hasta=2026-05-01", "desde > hasta"], ["id_pedido=abc", "id_pedido no numérico"], ["pagina=0", "página 0"]]) {
      r = await call("GET", `/api/comprobantes?${u}`, undefined, tok.D);
      check(`${n} -> 400`, r.status === 400, r);
    }
    r = await call("GET", "/api/comprobantes/abc", undefined, tok.D);
    check("id no numérico -> 400", r.status === 400);
    r = await call("GET", "/api/comprobantes");
    check("sin sesión -> 403/401", r.status === 403 || r.status === 401, r.status);

    console.log("\n== Documentos permanentes");
    for (const [m, u] of [["PUT", `/api/comprobantes/${ce1.id_comprobante}`], ["DELETE", `/api/comprobantes/${ce1.id_comprobante}`], ["POST", "/api/comprobantes"]]) {
      r = await call(m, u, {}, tok.D);
      check(`${m} ${u.replace(/\d+$/, ":id")} no existe -> 404`, r.status === 404, r.status);
    }
    await q(`UPDATE "Producto" SET nombre='Blusa Renombrada' WHERE id_producto=1`);
    r = await call("GET", `/api/comprobantes/${ce1.id_comprobante}`, undefined, tok.D);
    check("renombrar la prenda no cambia el comprobante emitido", r.data.lineas[0].descripcion === "Blusa M Rosa");
    r = await call("DELETE", `/api/proveedores/${prov.id_proveedor}`, undefined, tok.A1);
    check("no se puede eliminar un proveedor con comprobantes -> 409", r.status === 409 && /comprobantes/.test(r.data.message), r);
    r = await call("DELETE", `/api/proveedores/${provInactivo.id_proveedor}`, undefined, tok.A1);
    check("uno sin comprobantes sí", r.status === 200, r);
    r = await call("DELETE", "/api/productos/3", undefined, tok.D);
    check("no se puede eliminar una prenda que aparece en comprobantes -> 409", r.status === 409 && /comprobantes/.test(r.data.message), r);

    console.log("\n== Ventas anteriores a los comprobantes (migración 0006 sobre una base con ventas)");
    srv.kill();
    await sleep(800);
    const { spawnSync } = require("child_process");
    const migrar = (accion) => spawnSync(process.execPath, [path.join(B, "scripts", "migrar.js"), accion], { cwd: B, env: { ...process.env, ...ENV }, encoding: "utf8" });
    let m = migrar("deshacer");
    check("deshacer 0006 quita las tablas de comprobantes", m.status === 0 && (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name='Comprobante'`))[0].n === 0, m.stdout + m.stderr);
    m = migrar("aplicar");
    const ventas = await q(`SELECT c.numero, c.id_pedido, c.fecha, c.motivo, c.valor_total FROM "Comprobante" c WHERE c.concepto='VENTA' ORDER BY c.numero`);
    const pagadas = await q(`SELECT id_pedido FROM "Pedido" WHERE estado IN ('PROCESADO','ENVIADO','ENTREGADO') ORDER BY id_pedido`);
    check("al aplicarla, cada venta pagada recibe su comprobante de salida", m.status === 0 && ventas.length === pagadas.length && pagadas.every((p) => ventas.some((v) => v.id_pedido === p.id_pedido)), [m.stdout + m.stderr, ventas, pagadas]);
    check("…numerados del CS-000001 en adelante en orden cronológico, con la fecha de la venta", consecutivos(ventas.map((v) => v.numero)) && ventas.every((v, i) => i === 0 || new Date(v.fecha) >= new Date(ventas[i - 1].fecha)) && ventas.every((v) => /anterior a los comprobantes/.test(v.motivo)), ventas);
    check("…y no se emiten para los pedidos pendientes o cancelados", !ventas.some((v) => v.id_pedido === p2.id_pedido));
    m = migrar("estado");
    check("migrar:estado no reporta nada faltante", m.status === 0 && /Pendientes \(0\)/.test(m.stdout) && !/Comprobante\./.test(m.stdout), m.stdout);
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
