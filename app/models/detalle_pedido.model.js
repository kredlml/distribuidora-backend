module.exports = (sequelize, Sequelize) => {
  // Recalcula el total del Pedido sumando el subtotal de todos sus detalles
  const actualizarTotalPedido = async (detalle, options) => {
    const Pedido = sequelize.models.Pedido;
    const totalActual = await DetallePedido.sum('subtotal', {
      where: { id_pedido: detalle.id_pedido },
      transaction: options.transaction
    });

    await Pedido.update(
      { total: totalActual || 0 },
      { where: { id_pedido: detalle.id_pedido }, transaction: options.transaction }
    );
  };

  // El subtotal nunca se confía al cliente: siempre es cantidad × precio_unitario.
  const calcularSubtotal = (detalle) => {
    if (detalle.cantidad != null && detalle.precio_unitario != null) {
      detalle.subtotal = Math.round(Number(detalle.cantidad) * Number(detalle.precio_unitario) * 100) / 100;
    }
  };

  // En un update con "fields" (p.ej. detalle.update({ cantidad })) Sequelize solo escribe
  // esas columnas; se agrega subtotal para que el valor recalculado sí se guarde.
  const recalcularSubtotalEnUpdate = (detalle, options) => {
    calcularSubtotal(detalle);
    if (Array.isArray(options.fields) && !options.fields.includes('subtotal')) {
      options.fields.push('subtotal');
    }
  };

  const DetallePedido = sequelize.define("DetallePedido", {
    id_detalle_pedido: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
    cantidad: { type: Sequelize.INTEGER, allowNull: false, validate: { min: 1 } },
    precio_unitario: { type: Sequelize.DECIMAL(10, 2), allowNull: false, validate: { min: 0 } },
    subtotal: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    id_pedido: { type: Sequelize.INTEGER, allowNull: false },
    id_producto: { type: Sequelize.INTEGER, allowNull: false }
  }, {
    tableName: 'DetallePedido',
    timestamps: false,
    hooks: {
      beforeValidate: calcularSubtotal,
      beforeUpdate: recalcularSubtotalEnUpdate,
      afterCreate: actualizarTotalPedido,
      afterDestroy: actualizarTotalPedido,
      afterUpdate: async (detalle, options) => {
        await actualizarTotalPedido(detalle, options);
        // Si la línea se movió a otro pedido, el pedido anterior también cambia de total.
        const pedidoAnterior = detalle.previous('id_pedido');
        if (pedidoAnterior && pedidoAnterior !== detalle.id_pedido) {
          await actualizarTotalPedido({ id_pedido: pedidoAnterior }, options);
        }
      },
      // Inserción masiva: subtotal por línea y un solo recálculo por pedido afectado.
      beforeBulkCreate: (detalles) => detalles.forEach(calcularSubtotal),
      afterBulkCreate: async (detalles, options) => {
        const pedidos = [...new Set(detalles.map(d => d.id_pedido))];
        for (const id_pedido of pedidos) {
          await actualizarTotalPedido({ id_pedido }, options);
        }
      },
      // destroy/update con "where" no ejecutan los hooks por registro salvo con
      // individualHooks; se fuerza para que el total nunca quede desactualizado.
      beforeBulkDestroy: (options) => { options.individualHooks = true; },
      beforeBulkUpdate: (options) => { options.individualHooks = true; }
    }
  });

  return DetallePedido;
};
