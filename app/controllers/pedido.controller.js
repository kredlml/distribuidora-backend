const db = require("../models");
const Pedido = db.pedido;
const Inventario = db.inventario; 
const DetallePedido = db.detalle_pedido;
const Cliente = db.cliente;
const Sucursal = db.sucursal;
const Producto = db.producto;
const Pago = db.pago; 

exports.create = async (req, res) => {
 
  const t = await db.sequelize.transaction();

  try {
    
    if (!req.body.id_cliente || !req.body.id_sucursal || !req.body.id_producto || !req.body.cantidad) {
      throw new Error("Faltan datos obligatorios para procesar la venta.");
    }

    
    const nuevoPedido = {
      estado: req.body.estado || 'PENDIENTE',
      total: req.body.total || 0, 
      id_cliente: req.body.id_cliente,
      id_sucursal: req.body.id_sucursal,
      id_empleado: req.body.id_empleado 
    };

    
    const pedidoCreado = await Pedido.create(nuevoPedido, { transaction: t });

    
    let cantidadSolicitada = req.body.cantidad;
    const lotesDisponibles = await Inventario.findAll({
      where: { 
        id_producto: req.body.id_producto,
        id_sucursal: req.body.id_sucursal,
        estado: 'DISPONIBLE',
        cantidad: { [db.Sequelize.Op.gt]: 0 }
      },
      order: [['fecha_caducidad', 'ASC']],
      transaction: t
    });

    const stockTotal = lotesDisponibles.reduce((sum, lote) => sum + lote.cantidad, 0);
    if (stockTotal < cantidadSolicitada) {
      throw new Error(`Stock insuficiente. Solo hay ${stockTotal} unidades disponibles.`);
    }

    for (let i = 0; i < lotesDisponibles.length; i++) {
      let loteActual = lotesDisponibles[i];

      if (cantidadSolicitada === 0) break; 

      let descontadoDeEsteLote = 0;
      if (loteActual.cantidad >= cantidadSolicitada) {
        descontadoDeEsteLote = cantidadSolicitada;
        loteActual.cantidad -= cantidadSolicitada;
        await loteActual.save({ transaction: t }); 
        cantidadSolicitada = 0; 
      } else {
        descontadoDeEsteLote = loteActual.cantidad;
        cantidadSolicitada -= loteActual.cantidad; 
        loteActual.cantidad = 0; 
        await loteActual.save({ transaction: t });
      }

      // Trazabilidad: registra la salida por venta de este lote específico.
      await db.movimiento_inventario.create({
        id_inventario: loteActual.id_inventario,
        id_producto: req.body.id_producto,
        id_pedido: pedidoCreado.id_pedido,
        id_empleado: req.body.id_empleado || null,
        tipo_movimiento: 'VENTA',
        cantidad: descontadoDeEsteLote,
        estado_anterior: 'DISPONIBLE',
        estado_nuevo: loteActual.cantidad === 0 ? 'AGOTADO' : 'DISPONIBLE',
        observacion: `Venta asociada al pedido #${pedidoCreado.id_pedido}.`
      }, { transaction: t });
    }

   
    await DetallePedido.create({
      cantidad: req.body.cantidad,
      precio_unitario: req.body.precio_unitario || 0, // Idealmente lo traes de la BD del producto
      subtotal: (req.body.cantidad * (req.body.precio_unitario || 0)),
      id_pedido: pedidoCreado.id_pedido, // Lo conectamos al pedido que creaste arriba
      id_producto: req.body.id_producto
    }, { transaction: t });

    
    await t.commit();
    res.status(201).send({ 
      message: "Venta procesada exitosamente con motor FIFO.",
      pedido: pedidoCreado
    });

  } catch (error) {
    
    await t.rollback();
    res.status(400).send({ message: error.message });
  }
};


exports.findAll = async (req, res) => {
  try {
    const data = await Pedido.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los pedidos." });
  }
};

exports.findOne = async (req, res) => {
  try {
    const id = req.params.id;

    const pedido = await Pedido.findByPk(id, {
      include: [
        { 
          model: Cliente, 
          attributes: ['nombre', 'apellido', 'email', 'telefono'] 
        },
        { 
          model: Sucursal, 
          attributes: ['nombre', 'ciudad'] 
        },
        { 
          model: db.detalle_pedido, // Usamos la variable exacta de tu index.js
          include: [{ 
            model: Producto, 
            attributes: ['nombre', 'talla', 'precio_unitario'] 
          }]
        },
        { 
          model: Pago, 
          attributes: ['monto', 'metodo_pago', 'estado_pago', 'fecha_pago'] 
        }
      ]
    });

    if (pedido) {
      res.status(200).send(pedido);
    } else {
      res.status(404).send({ message: `No se encontró el Pedido con id=${id}.` });
    }
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el Pedido: " + error.message });
  }
};

// PUT /api/pedidos/:id/estado — permite avanzar el estado del pedido (p.ej. a ENTREGADO),
// precondición para poder solicitar devoluciones/cambios sobre ese pedido.
const ESTADOS_PEDIDO_VALIDOS = ['PENDIENTE', 'PROCESADO', 'ENVIADO', 'ENTREGADO', 'CANCELADO'];

exports.actualizarEstado = async (req, res) => {
  try {
    const id = req.params.id;
    const { estado } = req.body;

    if (!estado || !ESTADOS_PEDIDO_VALIDOS.includes(estado)) {
      return res.status(400).send({
        message: `El estado debe ser uno de: ${ESTADOS_PEDIDO_VALIDOS.join(', ')}.`
      });
    }

    const pedido = await Pedido.findByPk(id);
    if (!pedido) {
      return res.status(404).send({ message: `No se encontró el Pedido con id=${id}.` });
    }
    if (pedido.estado === 'CANCELADO') {
      return res.status(400).send({ message: "No se puede modificar un pedido ya cancelado." });
    }

    const estadoAnterior = pedido.estado;
    pedido.estado = estado;
    await pedido.save();

    res.status(200).send({
      message: `Pedido actualizado de ${estadoAnterior} a ${estado}.`,
      pedido
    });
  } catch (error) {
    res.status(500).send({ message: "Error al actualizar el estado del pedido: " + error.message });
  }
};

// GET /api/pedidos/:id/historial — todos los movimientos de inventario ligados
// al pedido, incluyendo los originados por devoluciones/cambios asociados a él.
exports.historial = async (req, res) => {
  try {
    const id = req.params.id;
    const pedido = await Pedido.findByPk(id);
    if (!pedido) {
      return res.status(404).send({ message: `No se encontró el Pedido con id=${id}.` });
    }

    const devolucionesDelPedido = await db.devolucion.findAll({
      where: { id_pedido: id },
      attributes: ['id_devolucion']
    });
    const idsDevoluciones = devolucionesDelPedido.map(d => d.id_devolucion);

    const movimientos = await db.movimiento_inventario.findAll({
      where: {
        [db.Sequelize.Op.or]: [
          { id_pedido: id },
          { id_devolucion: { [db.Sequelize.Op.in]: idsDevoluciones } }
        ]
      },
      order: [['id_movimiento', 'ASC']]
    });

    res.status(200).send({ pedido, movimientos });
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el historial del pedido: " + error.message });
  }
};
