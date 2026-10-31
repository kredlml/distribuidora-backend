// Comprobantes de entrada y salida de mercadería (solo lectura: los emite el sistema al mover stock).
const db = require("../models");
const Op = db.Sequelize.Op;
const { whereSucursal, enAlcance } = require("../utils/alcance");
const { leerPaginacion, pagina, textoBusqueda } = require("../utils/paginacion");
const { esIdValido } = require("../middlewares/validarId");
const { folio } = require("../utils/comprobantes");
const { errorHttp } = require("../utils/facturacion");

const ZONA = process.env.ZONA_HORARIA_NOMBRE || "America/Guatemala";
const TIPOS = ["ENTRADA", "SALIDA"];
const CONCEPTOS = ["INGRESO_PROVEEDOR", "INGRESO_DIRECTO", "VENTA", "BAJA", "DEVOLUCION", "CAMBIO"];
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

const EMPLEADO = { model: db.empleado, attributes: ["id_empleado", "nombre", "apellido", "puesto"] };
const SUCURSAL = { model: db.sucursal, attributes: ["id_sucursal", "nombre", "direccion", "ciudad"] };
const PROVEEDOR = { model: db.proveedor, attributes: ["id_proveedor", "nombre_empresa", "nombre_contacto", "telefono", "email", "direccion"] };

const conFolio = (c) => { const x = c.toJSON(); x.folio = folio(x); return x; };

// Comprobante completo (líneas, sucursal, responsable, proveedor, pedido y devolución), o null.
async function cargarComprobante(id) {
  const c = await db.comprobante.findByPk(id, {
    include: [
      { model: db.detalle_comprobante, as: "lineas" },
      SUCURSAL, EMPLEADO, PROVEEDOR,
      { model: db.pedido, attributes: ["id_pedido", "estado", "fecha_pedido", "direccion_entrega"], include: [{ model: db.cliente, attributes: ["id_cliente", "nombre", "apellido"] }] },
      { model: db.devolucion, attributes: ["id_devolucion", "tipo", "estado"] }
    ],
    order: [[{ model: db.detalle_comprobante, as: "lineas" }, "id_detalle_comprobante", "ASC"]]
  });
  return c ? conFolio(c) : null;
}
exports.cargarComprobante = cargarComprobante;

// GET /api/comprobantes?tipo=&concepto=&id_sucursal=&desde=&hasta=&q=&id_pedido=&id_devolucion=[&pagina=N]
// Sin ?pagina responde el arreglo (como los demás listados); los más recientes primero.
exports.findAll = async (req, res) => {
  try {
    const qs = req.query;
    const where = {};
    if (qs.tipo) {
      if (!TIPOS.includes(qs.tipo)) throw errorHttp(400, `El tipo debe ser ${TIPOS.join(" o ")}.`);
      where.tipo = qs.tipo;
    }
    if (qs.concepto) {
      if (!CONCEPTOS.includes(qs.concepto)) throw errorHttp(400, `El concepto debe ser uno de: ${CONCEPTOS.join(", ")}.`);
      where.concepto = qs.concepto;
    }
    for (const campo of ["id_sucursal", "id_pedido", "id_devolucion"]) {
      if (qs[campo] === undefined || qs[campo] === "") continue;
      if (!esIdValido(qs[campo])) throw errorHttp(400, `${campo} debe ser un número válido.`);
      where[campo] = Number(qs[campo]);
    }
    const desde = qs.desde || null, hasta = qs.hasta || null;
    if ((desde && !esFecha(desde)) || (hasta && !esFecha(hasta))) throw errorHttp(400, "Las fechas deben tener el formato AAAA-MM-DD.");
    if (desde && hasta && desde > hasta) throw errorHttp(400, "La fecha inicial no puede ser posterior a la final.");
    const condiciones = [];
    // Días de Guatemala, no del servidor. Las fechas ya se validaron (AAAA-MM-DD).
    const dia = `("Comprobante"."fecha" AT TIME ZONE ${db.sequelize.escape(ZONA)})::date`;
    if (desde) condiciones.push(db.sequelize.literal(`${dia} >= '${desde}'`));
    if (hasta) condiciones.push(db.sequelize.literal(`${dia} <= '${hasta}'`));

    // Búsqueda: un folio (CE-000012, cs-12), un número (folio o pedido) o texto (proveedor,
    // documento del proveedor o motivo).
    const q = String(qs.q || "").trim();
    if (q) {
      const f = q.match(/^(CE|CS)\s*-?\s*0*(\d{1,9})$/i);
      const n = q.match(/^#?0*(\d{1,9})$/);
      if (f) { where.tipo = f[1].toUpperCase() === "CE" ? "ENTRADA" : "SALIDA"; where.numero = Number(f[2]); }
      else if (n) condiciones.push({ [Op.or]: [{ numero: Number(n[1]) }, { id_pedido: Number(n[1]) }] });
      else {
        const like = textoBusqueda(q);
        condiciones.push({ [Op.or]: [
          { documento_proveedor: { [Op.iLike]: like } },
          { motivo: { [Op.iLike]: like } },
          { "$Proveedor.nombre_empresa$": { [Op.iLike]: like } }
        ] });
      }
    }
    // Fuera del DISTRITAL, solo los comprobantes de la propia sucursal.
    if (where.id_sucursal !== undefined && !enAlcance(req, where.id_sucursal)) throw errorHttp(403, "Solo puedes ver los comprobantes de tu sucursal.");
    Object.assign(where, whereSucursal(req));
    if (condiciones.length) where[Op.and] = condiciones;

    const consulta = {
      where,
      include: [{ ...SUCURSAL, attributes: ["id_sucursal", "nombre"] }, EMPLEADO, { ...PROVEEDOR, attributes: ["id_proveedor", "nombre_empresa"] }],
      order: [["fecha", "DESC"], ["id_comprobante", "DESC"]]
    };
    const p = leerPaginacion(qs);
    if (!p) return res.send((await db.comprobante.findAll({ ...consulta, limit: 500 })).map(conFolio));
    const { rows, count } = await db.comprobante.findAndCountAll({ ...consulta, offset: p.offset, limit: p.limit, distinct: true });
    res.send(pagina(rows.map(conFolio), count, p));
  } catch (error) {
    if (!error.status) res.locals.mensajeError = error.message;
    res.status(error.status || 500).send({ message: error.status ? error.message : "Error al recuperar los comprobantes." });
  }
};

// GET /api/comprobantes/:id — el comprobante completo. De otra sucursal: 404 (para ese empleado no existe).
exports.findOne = async (req, res) => {
  try {
    const c = await cargarComprobante(req.params.id);
    if (!c || !enAlcance(req, c.id_sucursal)) return res.status(404).send({ message: `No se encontró el comprobante con id=${req.params.id}.` });
    res.send(c);
  } catch (error) {
    res.locals.mensajeError = error.message;
    res.status(500).send({ message: "Error al recuperar el comprobante." });
  }
};
