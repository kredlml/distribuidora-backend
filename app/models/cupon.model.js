module.exports = (sequelize, Sequelize) => {
  // Cupón de descuento (promociones). Lo crea el DISTRITAL; la clienta lo escribe al comprar en la
  // tienda y caja en una venta de mostrador. Se guarda en MAYÚSCULAS.
  const Cupon = sequelize.define("Cupon", {
    id_cupon: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    codigo: { type: Sequelize.STRING(30), allowNull: false, unique: true },
    descripcion: { type: Sequelize.STRING(150), allowNull: true },
    // PORCENTAJE: valor = % (1–100); MONTO: valor = quetzales de descuento.
    tipo: { type: Sequelize.ENUM('PORCENTAJE', 'MONTO'), allowNull: false },
    valor: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    // Compra mínima (suma de prendas) para que aplique.
    minimo_compra: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    // Vigencia por días de Guatemala, ambos incluidos (null = sin límite).
    desde: { type: Sequelize.DATEONLY, allowNull: true },
    hasta: { type: Sequelize.DATEONLY, allowNull: true },
    // Usos permitidos en total (null = ilimitado) y usos ya hechos (pedidos no cancelados).
    usos_maximos: { type: Sequelize.INTEGER, allowNull: true },
    usos: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
    // Solo para una sucursal (null = todas).
    id_sucursal: { type: Sequelize.INTEGER, allowNull: true },
    activo: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    fecha_creacion: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.NOW }
  }, {
    tableName: 'Cupon',
    timestamps: false
  });
  return Cupon;
};
