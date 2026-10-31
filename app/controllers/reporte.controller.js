const db = require("../models");
const sequelize = db.sequelize; // Usaremos la instancia directa para lanzar SQL puro
const { sucursalDe } = require("../utils/alcance");
const { IVA_PORCENTAJE } = require("../utils/precios");

// Zona horaria del negocio: los "días" de los reportes son días de Guatemala, no del servidor.
const ZONA = process.env.ZONA_HORARIA_NOMBRE || "America/Guatemala";
// Estados que cuentan como venta: el pedido ya se pagó (PENDIENTE y CANCELADO no son ventas).
const ESTADOS_VENTA = "('PROCESADO','ENVIADO','ENTREGADO')";
// Lo vendido por una línea después del descuento del cupón (prorrateado entre las líneas del pedido).
const LINEA_NETA = `d.subtotal * (1 - p.descuento / NULLIF((SELECT SUM(d2.subtotal) FROM "DetallePedido" d2 WHERE d2.id_pedido = p.id_pedido), 0))`;
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const num = (v) => Math.round(Number(v || 0) * 100) / 100;

// Filtro SQL de sucursal: el DISTRITAL elige (o todas); los demás, la suya.
function filtroSucursal(req) {
  const propia = sucursalDe(req);
  if (propia !== null) return { id: propia, sql: `AND p.id_sucursal = ${Number(propia)}` };
  const pedida = Number(req.query.id_sucursal);
  if (Number.isInteger(pedida) && pedida > 0) return { id: pedida, sql: `AND p.id_sucursal = ${pedida}` };
  return { id: null, sql: "" };
}

// 1. Reporte de Ventas (JOIN de Pedidos, Clientes y Sucursales)
exports.historialVentas = async (req, res) => {
  try {
    const { sql } = filtroSucursal(req);
    const query = `
      SELECT
        p.id_pedido,
        p.fecha_pedido,
        s.nombre AS sucursal,
        c.nombre AS nombre_cliente,
        c.apellido AS apellido_cliente,
        p.total,
        p.estado
      FROM "Pedido" p
      INNER JOIN "Sucursal" s ON p.id_sucursal = s.id_sucursal
      INNER JOIN "Cliente" c ON p.id_cliente = c.id_cliente
      WHERE 1=1 ${sql}
      ORDER BY p.id_pedido DESC;
    `;

    // Ejecutamos la consulta
    const [resultados] = await sequelize.query(query);
    res.status(200).send(resultados);

  } catch (error) {
    res.status(500).send({ message: error.message || "Error al generar el reporte de ventas." });
  }
};

// 2. Reporte de Alertas: Productos con stock bajo
exports.stockCritico = async (req, res) => {
  try {
    const { sql } = filtroSucursal(req);
    const query = `
      SELECT
        prod.nombre AS producto,
        prod.talla,
        prod.color,
        s.nombre AS sucursal,
        SUM(inv.cantidad) AS stock_actual,
        prod.stock_minimo
      FROM "Inventario" inv
      INNER JOIN "Producto" prod ON inv.id_producto = prod.id_producto
      INNER JOIN "Sucursal" s ON inv.id_sucursal = s.id_sucursal
      WHERE inv.estado = 'DISPONIBLE' ${sql.replace("p.id_sucursal", "inv.id_sucursal")}
      GROUP BY prod.id_producto, prod.nombre, prod.talla, prod.color, s.id_sucursal, s.nombre, prod.stock_minimo
      HAVING SUM(inv.cantidad) <= prod.stock_minimo;
    `;

    const [resultados] = await sequelize.query(query);
    res.status(200).send(resultados);

  } catch (error) {
    res.status(500).send({ message: error.message || "Error al generar el reporte de stock." });
  }
};

// 3. GET /api/reportes/resumen?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&id_sucursal=N]
// Tablero de ventas para gerentes: el ADMIN ve su sucursal; el DISTRITAL, todas o la que elija.
// Una venta es un pedido pagado (PROCESADO, ENVIADO o ENTREGADO) con fecha en el periodo.
exports.resumen = async (req, res) => {
  try {
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date()); // AAAA-MM-DD
    const desde = req.query.desde || hoy;
    const hasta = req.query.hasta || desde;
    if (!esFecha(desde) || !esFecha(hasta)) return res.status(400).send({ message: "Las fechas deben tener el formato AAAA-MM-DD." });
    if (desde > hasta) return res.status(400).send({ message: "La fecha inicial no puede ser posterior a la final." });
    if ((new Date(hasta) - new Date(desde)) / 86400000 > 366) return res.status(400).send({ message: "El periodo no puede superar un año." });

    const suc = filtroSucursal(req);
    const r = { desde, hasta, zona: ZONA };
    const q = (sql, extra = {}) => sequelize.query(sql, { replacements: { ...r, ...extra }, type: db.Sequelize.QueryTypes.SELECT });
    const diaPedido = `(p.fecha_pedido AT TIME ZONE :zona)::date`;
    const ventasPeriodo = `p.estado IN ${ESTADOS_VENTA} AND ${diaPedido} BETWEEN :desde AND :hasta ${suc.sql}`;

    const [kpi] = await q(`
      SELECT COUNT(*)::int AS pedidos, COALESCE(SUM(p.total),0) AS ventas,
        COALESCE(SUM(p.descuento),0) AS descuentos, COALESCE(SUM(p.costo_envio),0) AS envios,
        COALESCE((SELECT SUM(d.cantidad) FROM "DetallePedido" d JOIN "Pedido" p ON p.id_pedido = d.id_pedido WHERE ${ventasPeriodo}),0)::int AS unidades
      FROM "Pedido" p WHERE ${ventasPeriodo}`);
    const [deHoy] = await q(`
      SELECT COUNT(*)::int AS pedidos, COALESCE(SUM(p.total),0) AS ventas FROM "Pedido" p
      WHERE p.estado IN ${ESTADOS_VENTA} AND ${diaPedido} = :hoy ${suc.sql}`, { hoy });
    const [pendientes] = await q(`
      SELECT COUNT(*)::int AS pedidos,
        COALESCE(SUM(p.total - COALESCE((SELECT SUM(pg.monto) FROM "Pago" pg WHERE pg.id_pedido = p.id_pedido AND pg.estado_pago = 'COMPLETADO'), 0)), 0) AS monto
      FROM "Pedido" p WHERE p.estado = 'PENDIENTE' ${suc.sql}`);
    const [cancelados] = await q(`
      SELECT COUNT(*)::int AS pedidos FROM "Pedido" p
      WHERE p.estado = 'CANCELADO' AND ${diaPedido} BETWEEN :desde AND :hasta ${suc.sql}`);
    const devoluciones = await q(`
      SELECT dv.tipo, COUNT(*)::int AS n FROM "Devolucion" dv JOIN "Pedido" p ON p.id_pedido = dv.id_pedido
      WHERE (dv.fecha_solicitud AT TIME ZONE :zona)::date BETWEEN :desde AND :hasta ${suc.sql}
      GROUP BY dv.tipo`);

    const porSucursal = await q(`
      SELECT s.id_sucursal, s.nombre, COUNT(p.id_pedido)::int AS pedidos, COALESCE(SUM(p.total),0) AS ventas,
        COALESCE(SUM((SELECT SUM(d.cantidad) FROM "DetallePedido" d WHERE d.id_pedido = p.id_pedido)),0)::int AS unidades
      FROM "Sucursal" s LEFT JOIN "Pedido" p ON p.id_sucursal = s.id_sucursal AND ${ventasPeriodo}
      WHERE 1=1 ${suc.sql.replace("p.id_sucursal", "s.id_sucursal")}
      GROUP BY s.id_sucursal, s.nombre ORDER BY ventas DESC, s.nombre`);
    const porDia = await q(`
      SELECT to_char(${diaPedido}, 'YYYY-MM-DD') AS dia, COUNT(*)::int AS pedidos, COALESCE(SUM(p.total),0) AS ventas
      FROM "Pedido" p WHERE ${ventasPeriodo} GROUP BY 1 ORDER BY 1`);
    const porPrenda = await q(`
      SELECT pr.id_producto, pr.nombre, pr.talla, pr.color, c.nombre AS tipo,
        SUM(d.cantidad)::int AS unidades, COALESCE(SUM(${LINEA_NETA}),0) AS ventas
      FROM "DetallePedido" d JOIN "Pedido" p ON p.id_pedido = d.id_pedido
      JOIN "Producto" pr ON pr.id_producto = d.id_producto LEFT JOIN "Categoria" c ON c.id_categoria = pr.id_categoria
      WHERE ${ventasPeriodo}
      GROUP BY pr.id_producto, pr.nombre, pr.talla, pr.color, c.nombre ORDER BY unidades DESC, ventas DESC`);
    const porTipo = await q(`
      SELECT COALESCE(c.nombre, 'Sin tipo') AS tipo, SUM(d.cantidad)::int AS unidades, COALESCE(SUM(${LINEA_NETA}),0) AS ventas
      FROM "DetallePedido" d JOIN "Pedido" p ON p.id_pedido = d.id_pedido
      JOIN "Producto" pr ON pr.id_producto = d.id_producto LEFT JOIN "Categoria" c ON c.id_categoria = pr.id_categoria
      WHERE ${ventasPeriodo} GROUP BY 1 ORDER BY ventas DESC`);
    const porMetodo = await q(`
      SELECT pg.metodo_pago AS metodo, COUNT(*)::int AS pagos, COALESCE(SUM(pg.monto),0) AS monto
      FROM "Pago" pg JOIN "Pedido" p ON p.id_pedido = pg.id_pedido
      WHERE pg.estado_pago = 'COMPLETADO' AND (pg.fecha_pago AT TIME ZONE :zona)::date BETWEEN :desde AND :hasta ${suc.sql}
      GROUP BY 1 ORDER BY monto DESC`);
    const porOrigen = await q(`
      SELECT CASE WHEN p.id_empleado IS NULL THEN 'TIENDA' ELSE 'MOSTRADOR' END AS origen,
        COUNT(*)::int AS pedidos, COALESCE(SUM(p.total),0) AS ventas
      FROM "Pedido" p WHERE ${ventasPeriodo} GROUP BY 1 ORDER BY ventas DESC`);
    const porVendedor = await q(`
      SELECT e.id_empleado, e.nombre, e.apellido, s.nombre AS sucursal, COUNT(*)::int AS pedidos, COALESCE(SUM(p.total),0) AS ventas
      FROM "Pedido" p JOIN "Empleado" e ON e.id_empleado = p.id_empleado JOIN "Sucursal" s ON s.id_sucursal = p.id_sucursal
      WHERE ${ventasPeriodo} GROUP BY e.id_empleado, e.nombre, e.apellido, s.nombre ORDER BY ventas DESC`);
    const stockCritico = await q(`
      SELECT pr.id_producto, pr.nombre, pr.talla, pr.color, s.id_sucursal, s.nombre AS sucursal, SUM(inv.cantidad)::int AS stock, pr.stock_minimo
      FROM "Inventario" inv JOIN "Producto" pr ON pr.id_producto = inv.id_producto JOIN "Sucursal" s ON s.id_sucursal = inv.id_sucursal
      WHERE inv.estado = 'DISPONIBLE' AND pr.activo = true ${suc.sql.replace("p.id_sucursal", "inv.id_sucursal")}
      GROUP BY pr.id_producto, pr.nombre, pr.talla, pr.color, s.id_sucursal, s.nombre, pr.stock_minimo
      HAVING SUM(inv.cantidad) <= pr.stock_minimo ORDER BY stock ASC, pr.nombre`);

    // Dinero devuelto a clientas (reembolsos entregados en el periodo) y ventas por cupón.
    const [reembolsos] = await q(`
      SELECT COUNT(*)::int AS cantidad, COALESCE(SUM(r.monto),0) AS monto
      FROM "Reembolso" r JOIN "Pedido" p ON p.id_pedido = r.id_pedido
      WHERE r.estado = 'COMPLETADO' AND r.id_devolucion IS NOT NULL AND (r.fecha_completado AT TIME ZONE :zona)::date BETWEEN :desde AND :hasta ${suc.sql}`);
    const porCupon = await q(`
      SELECT cu.codigo, cu.descripcion, COUNT(*)::int AS pedidos, COALESCE(SUM(p.descuento),0) AS descuento, COALESCE(SUM(p.total),0) AS ventas
      FROM "Pedido" p JOIN "Cupon" cu ON cu.id_cupon = p.id_cupon
      WHERE ${ventasPeriodo} GROUP BY cu.codigo, cu.descripcion ORDER BY descuento DESC`);
    const iva = num(Number(kpi.ventas) - Number(kpi.ventas) / (1 + IVA_PORCENTAJE / 100));

    const sucursal = suc.id ? await db.sucursal.findByPk(suc.id, { attributes: ["id_sucursal", "nombre", "ciudad"] }) : null;
    const dev = Object.fromEntries(devoluciones.map((d) => [d.tipo, d.n]));
    const conDinero = (filas, campos) => filas.map((f) => ({ ...f, ...Object.fromEntries(campos.map((c) => [c, num(f[c])])) }));

    res.send({
      periodo: { desde, hasta, hoy },
      sucursal,
      generado: { fecha: new Date(), por: `${req.empleado.nombre} ${req.empleado.apellido || ""}`.trim(), puesto: req.empleado.puesto },
      kpis: {
        ventas: num(kpi.ventas), pedidos: kpi.pedidos, unidades: kpi.unidades,
        ticket_promedio: kpi.pedidos ? num(kpi.ventas / kpi.pedidos) : 0,
        ventas_hoy: num(deHoy.ventas), pedidos_hoy: deHoy.pedidos,
        pendientes_cobro: { pedidos: pendientes.pedidos, monto: num(pendientes.monto) },
        cancelados: cancelados.pedidos,
        devoluciones: { devoluciones: dev.DEVOLUCION || 0, cambios: (dev.CAMBIO_TALLA || 0) + (dev.CAMBIO_VARIANTE || 0) },
        // Los precios incluyen IVA: se desglosa del total vendido.
        descuentos: num(kpi.descuentos), envios: num(kpi.envios),
        iva, iva_porcentaje: IVA_PORCENTAJE, ventas_sin_iva: num(Number(kpi.ventas) - iva),
        reembolsos: { cantidad: reembolsos.cantidad, monto: num(reembolsos.monto) },
        ventas_netas: num(Number(kpi.ventas) - Number(reembolsos.monto))
      },
      por_cupon: conDinero(porCupon, ["descuento", "ventas"]),
      por_sucursal: conDinero(porSucursal, ["ventas"]),
      por_dia: conDinero(porDia, ["ventas"]),
      por_prenda: conDinero(porPrenda, ["ventas"]),
      por_tipo: conDinero(porTipo, ["ventas"]),
      por_metodo: conDinero(porMetodo, ["monto"]),
      por_origen: conDinero(porOrigen, ["ventas"]),
      por_vendedor: conDinero(porVendedor, ["ventas"]),
      stock_critico: stockCritico
    });
  } catch (error) {
    res.status(500).send({ message: "Error al generar el resumen de ventas." });
  }
};
