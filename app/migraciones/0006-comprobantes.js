// Comprobantes de entrada y salida de mercadería:
//  - tablas Comprobante, DetalleComprobante y ContadorComprobante;
//  - el número es único por tipo (CE-000001, CS-000001);
//  - a lo sumo un comprobante de venta por pedido y uno de cada tipo por devolución: así una
//    reintentada o dos confirmaciones simultáneas del mismo pago no duplican el documento;
//  - MovimientoInventario.tipo_movimiento admite 'INGRESO'.
//  - las ventas ya pagadas reciben su comprobante de salida (ver el final de up).
// Idempotente (en una base nueva la línea base ya crea las tablas a partir de los modelos).
const { asegurarModelo, asegurarValoresEnum } = require("../utils/esquema");

exports.up = async ({ sequelize, db }) => {
  await asegurarModelo(sequelize, db.contador_comprobante);
  await asegurarModelo(sequelize, db.comprobante);
  await asegurarModelo(sequelize, db.detalle_comprobante);
  await asegurarValoresEnum(sequelize, "MovimientoInventario", "tipo_movimiento", ["INGRESO"]);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS comprobante_tipo_numero_unico ON "Comprobante" (tipo, numero)`);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS comprobante_venta_unica ON "Comprobante" (id_pedido) WHERE concepto = 'VENTA'`);
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS comprobante_devolucion_unica ON "Comprobante" (id_devolucion, tipo) WHERE id_devolucion IS NOT NULL`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS comprobante_sucursal_fecha ON "Comprobante" (id_sucursal, fecha DESC)`);
  await sequelize.query(`CREATE INDEX IF NOT EXISTS detalle_comprobante_comprobante ON "DetalleComprobante" (id_comprobante)`);

  // Ventas ya pagadas antes de los comprobantes: se emite su comprobante de salida con la fecha en
  // que se concretaron (el último pago completado; si no hay, la del pedido), en orden cronológico,
  // para que el historial de salidas quede completo. Las que ya lo tienen no se repiten.
  const { emitirSalidaDeVenta } = require("../utils/comprobantes");
  const anteriores = await sequelize.query(
    `SELECT p.*, COALESCE((SELECT max(pg.fecha_pago) FROM "Pago" pg WHERE pg.id_pedido = p.id_pedido AND pg.estado_pago = 'COMPLETADO'), p.fecha_pedido) AS fecha_venta
     FROM "Pedido" p
     WHERE p.estado IN ('PROCESADO', 'ENVIADO', 'ENTREGADO')
       AND EXISTS (SELECT 1 FROM "DetallePedido" d WHERE d.id_pedido = p.id_pedido)
       AND NOT EXISTS (SELECT 1 FROM "Comprobante" c WHERE c.id_pedido = p.id_pedido AND c.concepto = 'VENTA')
     ORDER BY fecha_venta, p.id_pedido`,
    { type: sequelize.QueryTypes.SELECT }
  );
  for (const p of anteriores) {
    await sequelize.transaction((t) => emitirSalidaDeVenta(p, p.id_empleado, t, {
      fecha: p.fecha_venta,
      motivo: `Venta del pedido #${p.id_pedido} (anterior a los comprobantes; emitido al implementarlos con la fecha de la venta).`
    }));
  }
  if (anteriores.length) console.log(`[migración] 0006: comprobantes de salida emitidos para ${anteriores.length} venta(s) anterior(es).`);
};

// El valor 'INGRESO' del ENUM de movimientos no se puede quitar en Postgres; queda sin uso.
exports.down = async ({ sequelize }) => {
  await sequelize.query(`DROP TABLE IF EXISTS "DetalleComprobante"`);
  await sequelize.query(`DROP TABLE IF EXISTS "Comprobante"`);
  await sequelize.query(`DROP TABLE IF EXISTS "ContadorComprobante"`);
  await sequelize.query(`DROP TYPE IF EXISTS "enum_Comprobante_tipo"`);
  await sequelize.query(`DROP TYPE IF EXISTS "enum_Comprobante_concepto"`);
};
