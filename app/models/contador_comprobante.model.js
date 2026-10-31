// Último número emitido por tipo de comprobante. Se incrementa dentro de la transacción que emite
// el comprobante: la fila queda bloqueada hasta el commit, así los números son correlativos y sin
// huecos (una secuencia de Postgres deja huecos cuando una transacción se revierte).
module.exports = (sequelize, Sequelize) => {
  const ContadorComprobante = sequelize.define("ContadorComprobante", {
    tipo: { type: Sequelize.STRING(10), primaryKey: true },
    ultimo: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'ContadorComprobante',
    timestamps: false
  });
  return ContadorComprobante;
};
