// Costo de envío, cupones de descuento e IVA desglosado:
//  - tabla Cupon;
//  - Pedido.costo_envio, Pedido.descuento (lo que descontó el cupón) y Pedido.id_cupon.
// Idempotente (en una base nueva la línea base ya las crea a partir de los modelos).
const { asegurarModelo, asegurarColumna } = require("../utils/esquema");

exports.up = async ({ sequelize, db, Sequelize }) => {
  await asegurarModelo(sequelize, db.cupon);
  await asegurarColumna(sequelize, "Pedido", "costo_envio", { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 });
  await asegurarColumna(sequelize, "Pedido", "descuento", { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 });
  await asegurarColumna(sequelize, "Pedido", "id_cupon", { type: Sequelize.INTEGER, allowNull: true, references: { model: "Cupon", key: "id_cupon" }, onUpdate: "CASCADE", onDelete: "SET NULL" });
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS cupon_codigo_lower_unico ON "Cupon" (lower(codigo))`);
};

exports.down = async ({ sequelize }) => {
  await sequelize.query(`ALTER TABLE "Pedido" DROP COLUMN IF EXISTS id_cupon, DROP COLUMN IF EXISTS descuento, DROP COLUMN IF EXISTS costo_envio`);
  await sequelize.query(`DROP TABLE IF EXISTS "Cupon"`);
  await sequelize.query(`DROP TYPE IF EXISTS "enum_Cupon_tipo"`);
};
