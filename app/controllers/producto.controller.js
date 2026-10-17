const db = require("../models");
const Producto = db.producto;
const { registrarAuditoria } = require("../utils/auditoria");

exports.create = async (req, res) => {
  try {
    // Validar campos obligatorios (incluyendo la llave foránea de categoría)
    if (!req.body.nombre || !req.body.precio_unitario || !req.body.id_categoria) {
      return res.status(400).send({ message: "El nombre, precio unitario y id_categoria son obligatorios." });
    }
    
    // Variante: id_producto_padre opcional. El padre debe existir y ser un producto base
    // (no otra variante), porque los grupos de variantes tienen un solo nivel.
    let id_producto_padre = null;
    const padreRecibido = req.body.id_producto_padre;
    if (padreRecibido !== undefined && padreRecibido !== null && padreRecibido !== '') {
      if (!Number.isInteger(Number(padreRecibido)) || Number(padreRecibido) <= 0) {
        return res.status(400).send({ message: "id_producto_padre debe ser un número de producto válido." });
      }
      const padre = await Producto.findByPk(padreRecibido);
      if (!padre) {
        return res.status(400).send({ message: "El producto padre indicado no existe." });
      }
      if (padre.id_producto_padre) {
        return res.status(400).send({ message: "El producto padre debe ser un producto base: no puede ser a su vez una variante." });
      }
      id_producto_padre = padre.id_producto;
    }

    const nuevoProducto = {
      nombre: req.body.nombre,
      descripcion: req.body.descripcion,
      talla: req.body.talla,
      color: req.body.color,
      precio_unitario: req.body.precio_unitario,
      id_categoria: req.body.id_categoria,
      stock_minimo: req.body.stock_minimo,
      activo: req.body.activo !== undefined ? req.body.activo : true,
      id_producto_padre: id_producto_padre
    };

    const data = await Producto.create(nuevoProducto);
    res.status(201).send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al crear el Producto." });
  }
};

exports.findAll = async (req, res) => {
  try {
    const data = await Producto.findAll();
    res.send(data);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al recuperar los productos." });
  }
};

// GET /api/productos/:id/historial — trazabilidad completa de una prenda/producto:
// ventas, devoluciones solicitadas/recibidas, revisiones y reintegraciones/cambios.
exports.historial = async (req, res) => {
  try {
    const id = req.params.id;

    const producto = await Producto.findByPk(id);
    if (!producto) {
      return res.status(404).send({ message: `No se encontró el Producto con id=${id}.` });
    }

    const movimientos = await db.movimiento_inventario.findAll({
      where: { id_producto: id },
      include: [
        { model: db.empleado, attributes: ['id_empleado', 'nombre', 'apellido'] }
      ],
      order: [['id_movimiento', 'ASC']]
    });

    res.status(200).send({ producto, movimientos });
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar el historial del producto: " + error.message });
  }
};

// PUT /api/productos/:id — edita una prenda. Solo se modifican los campos enviados.
// Cada cambio real queda en auditoría (campo: antes → después).
exports.update = async (req, res) => {
  try {
    const producto = await Producto.findByPk(req.params.id);
    if (!producto) {
      return res.status(404).send({ message: `No se encontró el producto con id=${req.params.id}.` });
    }
    const b = req.body || {}, cambios = {};
    const mal = (message) => res.status(400).send({ message });

    if (b.nombre !== undefined) {
      if (!String(b.nombre).trim()) return mal("El nombre no puede quedar vacío.");
      cambios.nombre = String(b.nombre).trim();
    }
    if (b.precio_unitario !== undefined) {
      const n = Number(b.precio_unitario);
      if (b.precio_unitario === "" || !(n > 0)) return mal("El precio unitario debe ser un número mayor que 0.");
      cambios.precio_unitario = n;
    }
    if (b.stock_minimo !== undefined) {
      const n = Number(b.stock_minimo);
      if (b.stock_minimo === "" || !Number.isInteger(n) || n < 0) return mal("El stock mínimo debe ser un entero mayor o igual a 0.");
      cambios.stock_minimo = n;
    }
    if (b.id_categoria !== undefined) {
      const cat = await db.categoria.findByPk(b.id_categoria);
      if (!cat) return mal("La categoría indicada no existe.");
      cambios.id_categoria = cat.id_categoria;
    }
    for (const k of ["descripcion", "talla", "color"]) {
      if (b[k] !== undefined) cambios[k] = b[k] === null || String(b[k]).trim() === "" ? null : String(b[k]).trim();
    }
    if (b.activo !== undefined) {
      if (typeof b.activo !== "boolean") return mal("El campo activo debe ser verdadero o falso.");
      cambios.activo = b.activo;
    }
    if (b.id_producto_padre !== undefined) {
      if (b.id_producto_padre === null || b.id_producto_padre === "") {
        cambios.id_producto_padre = null; // deja de ser variante
      } else {
        const idp = Number(b.id_producto_padre);
        if (!Number.isInteger(idp) || idp <= 0) return mal("id_producto_padre debe ser un número de producto válido.");
        if (idp === producto.id_producto) return mal("Una prenda no puede ser variante de sí misma.");
        const padre = await Producto.findByPk(idp);
        if (!padre) return mal("El producto padre indicado no existe.");
        if (padre.id_producto_padre) return mal("El producto padre debe ser un producto base: no puede ser a su vez una variante.");
        if (await Producto.count({ where: { id_producto_padre: producto.id_producto } }) > 0) {
          return mal("Esta prenda ya tiene variantes: no puede convertirse en variante de otra.");
        }
        cambios.id_producto_padre = idp;
      }
    }
    if (Object.keys(cambios).length === 0) return mal("No se enviaron cambios.");

    const igual = (a, c) => (a == null && c == null) || String(a) === String(c) ||
      (a != null && c != null && a !== "" && c !== "" && !isNaN(a) && !isNaN(c) && Number(a) === Number(c));
    const diffs = Object.keys(cambios).filter((k) => !igual(producto[k], cambios[k]))
      .map((k) => `${k}: ${producto[k] ?? "vacío"} → ${cambios[k] ?? "vacío"}`);
    if (diffs.length === 0) return res.send(producto); // nada cambió: no se audita

    await db.sequelize.transaction(async (t) => {
      await producto.update(cambios, { transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'PRODUCTO_ACTUALIZADO', tabla_afectada: 'Producto',
        registro_afectado_id: producto.id_producto,
        detalles: `Producto #${producto.id_producto} actualizado. ${diffs.join("; ")}`.slice(0, 255)
      }, t);
    });
    res.send(producto);
  } catch (error) {
    res.status(500).send({ message: error.message || "Error al actualizar el Producto." });
  }
};

// DELETE /api/productos/:id — solo si la prenda nunca tuvo actividad. Si ya tiene historial
// se responde 409: lo correcto es desactivarla (PUT activo=false), no borrarla.
exports.delete = async (req, res) => {
  try {
    const id = req.params.id;
    const producto = await Producto.findByPk(id);
    if (!producto) {
      return res.status(404).send({ message: `No se encontró el producto con id=${id}.` });
    }
    const [hijos, pedidos, devs, devsNuevo, movs, inv] = await Promise.all([
      Producto.count({ where: { id_producto_padre: id } }),
      db.detalle_pedido.count({ where: { id_producto: id } }),
      db.detalle_devolucion.count({ where: { id_producto: id } }),
      db.detalle_devolucion.count({ where: { id_producto_nuevo: id } }),
      db.movimiento_inventario.count({ where: { id_producto: id } }),
      db.inventario.count({ where: { id_producto: id } })
    ]);
    const motivos = [];
    if (hijos) motivos.push(`tiene ${hijos} variante(s)`);
    if (pedidos) motivos.push(`aparece en ${pedidos} línea(s) de pedidos`);
    if (devs + devsNuevo) motivos.push("participa en devoluciones o cambios");
    if (movs) motivos.push(`tiene ${movs} movimiento(s) de inventario`);
    if (inv) motivos.push("tiene registros de inventario");
    if (motivos.length) {
      return res.status(409).send({
        message: `No se puede eliminar la prenda #${id} porque ${motivos.join(", ")}. Desactívala desde Editar para que deje de ofrecerse sin perder el historial.`
      });
    }
    await db.sequelize.transaction(async (t) => {
      await producto.destroy({ transaction: t });
      await registrarAuditoria({
        id_empleado: req.empleadoId, accion: 'PRODUCTO_ELIMINADO', tabla_afectada: 'Producto',
        registro_afectado_id: Number(id), detalles: `Producto #${id} (${producto.nombre}) eliminado.`.slice(0, 255)
      }, t);
    });
    res.send({ message: `Prenda #${id} eliminada.` });
  } catch (error) {
    if (error.name === "SequelizeForeignKeyConstraintError") {
      return res.status(409).send({ message: "No se puede eliminar: la prenda ya tiene registros asociados. Desactívala desde Editar." });
    }
    res.status(500).send({ message: error.message || "Error al eliminar el Producto." });
  }
};