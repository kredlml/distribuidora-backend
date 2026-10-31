// Copia del cupón en el pedido (tipo, valor y compra mínima al momento de usarlo): editar un cupón
// ya no cambia el total de pedidos existentes. Rellena la copia de los pedidos que ya tenían cupón.
const { asegurarColumna } = require("../utils/esquema");

exports.up = async ({ sequelize, Sequelize }) => {
  await asegurarColumna(sequelize, "Pedido", "cupon_tipo", { type: Sequelize.STRING(12), allowNull: true });
  await asegurarColumna(sequelize, "Pedido", "cupon_valor", { type: Sequelize.DECIMAL(10, 2), allowNull: true });
  await asegurarColumna(sequelize, "Pedido", "cupon_minimo", { type: Sequelize.DECIMAL(10, 2), allowNull: true });
  await sequelize.query(`UPDATE "Pedido" p SET cupon_tipo = c.tipo::text, cupon_valor = c.valor, cupon_minimo = c.minimo_compra
    FROM "Cupon" c WHERE c.id_cupon = p.id_cupon AND p.cupon_tipo IS NULL`);
};

exports.down = async ({ sequelize }) => {
  await sequelize.query(`ALTER TABLE "Pedido" DROP COLUMN IF EXISTS cupon_tipo, DROP COLUMN IF EXISTS cupon_valor, DROP COLUMN IF EXISTS cupon_minimo`);
};
