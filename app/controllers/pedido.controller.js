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

      if (loteActual.cantidad >= cantidadSolicitada) {
        loteActual.cantidad -= cantidadSolicitada;
        await loteActual.save({ transaction: t }); 
        cantidadSolicitada = 0; 
      } else {
        cantidadSolicitada -= loteActual.cantidad; 
        loteActual.cantidad = 0; 
        await loteActual.save({ transaction: t });
      }
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
