const db = require("../models");
const { registrarAuditoria } = require("../utils/auditoria");
const { normalizarCodigo, CODIGO_RE } = require("../utils/cupones");

// Promociones (cupones de descuento). Solo el DISTRITAL los crea y modifica.
// La fecha debe existir de verdad (2026-02-30 no): ida y vuelta por Date en UTC.
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const MAX_MONTO = 99999999.99, MAX_INT = 2147483647;

// Lee y valida los datos del cupón. En una edición solo se validan los campos enviados.
function leerDatos(b, { esAlta, actual }) {
  const d = {};
  if (esAlta || b.codigo !== undefined) {
    const codigo = normalizarCodigo(b.codigo);
    if (!CODIGO_RE.test(codigo)) return { error: "El código debe tener de 3 a 30 letras, números, guion o guion bajo (sin espacios)." };
    d.codigo = codigo;
  }
  if (b.descripcion !== undefined) {
    const s = b.descripcion === null ? "" : String(b.descripcion).trim();
    if (s.length > 150) return { error: "La descripción no puede superar los 150 caracteres." };
    d.descripcion = s || null;
  }
  if (esAlta || b.tipo !== undefined) {
    if (!["PORCENTAJE", "MONTO"].includes(b.tipo)) return { error: "El tipo debe ser PORCENTAJE o MONTO." };
    d.tipo = b.tipo;
  }
  if (esAlta || b.valor !== undefined) {
    const v = Number(b.valor);
    const tipo = d.tipo || (actual && actual.tipo);
    if (!Number.isFinite(v) || v <= 0 || v > MAX_MONTO) return { error: "El valor del descuento debe ser mayor que 0 (y razonable)." };
    if (tipo === "PORCENTAJE" && v > 100) return { error: "Un porcentaje no puede ser mayor que 100." };
    if (Math.round(v * 100) / 100 !== v) return { error: "El valor admite como máximo 2 decimales." };
    d.valor = v;
  } else if (d.tipo === "PORCENTAJE" && actual && Number(actual.valor) > 100) {
    return { error: "Un porcentaje no puede ser mayor que 100." };
  }
  if (b.minimo_compra !== undefined) {
    const m = Number(b.minimo_compra || 0);
    if (!Number.isFinite(m) || m < 0 || m > MAX_MONTO || Math.round(m * 100) / 100 !== m) return { error: "La compra mínima debe ser un monto válido (0 o más, con 2 decimales como máximo)." };
    d.minimo_compra = m;
  }
  for (const campo of ["desde", "hasta"]) {
    if (b[campo] === undefined) continue;
    if (b[campo] === null || b[campo] === "") { d[campo] = null; continue; }
    if (!esFecha(b[campo])) return { error: `La fecha "${campo}" debe tener el formato AAAA-MM-DD.` };
    d[campo] = b[campo];
  }
  const desde = d.desde !== undefined ? d.desde : actual && actual.desde;
  const hasta = d.hasta !== undefined ? d.hasta : actual && actual.hasta;
  if (desde && hasta && desde > hasta) return { error: "La fecha inicial no puede ser posterior a la final." };
  if (b.usos_maximos !== undefined) {
    if (b.usos_maximos === null || b.usos_maximos === "") d.usos_maximos = null;
    else {
      const n = Number(b.usos_maximos);
      if (!Number.isInteger(n) || n < 1 || n > MAX_INT) return { error: "Los usos máximos deben ser un entero desde 1 (o vacío para ilimitado)." };
      if (actual && n < actual.usos) return { error: `Ya se usó ${actual.usos} vez/veces: los usos máximos no pueden ser menos.` };
      d.usos_maximos = n;
    }
  }
  if (b.id_sucursal !== undefined) {
    if (b.id_sucursal === null || b.id_sucursal === "") d.id_sucursal = null;
    else {
      const n = Number(b.id_sucursal);
      if (!Number.isInteger(n) || n < 1 || n > MAX_INT) return { error: "Sucursal inválida." };
      d.id_sucursal = n;
    }
  }
  if (b.activo !== undefined) {
    if (typeof b.activo !== "boolean") return { error: "activo debe ser true o false." };
    d.activo = b.activo;
  }
  return { datos: d };
}

const conSucursal = { include: [{ model: db.sucursal, attributes: ["id_sucursal", "nombre"] }] };

// GET /api/cupones
exports.findAll = async (req, res) => {
  try {
    const cupones = await db.cupon.findAll({ ...conSucursal, order: [["activo", "DESC"], ["id_cupon", "DESC"]] });
    // Descuento total entregado por cupón (pedidos que no se cancelaron).
    const [totales] = await db.sequelize.query(`SELECT id_cupon, COUNT(*)::int AS pedidos, COALESCE(SUM(descuento),0) AS descuento FROM "Pedido" WHERE id_cupon IS NOT NULL AND estado <> 'CANCELADO' GROUP BY id_cupon`);
    const porCupon = Object.fromEntries(totales.map((t) => [t.id_cupon, t]));
    res.send(cupones.map((c) => ({ ...c.toJSON(), pedidos: (porCupon[c.id_cupon] || {}).pedidos || 0, descuento_total: Number((porCupon[c.id_cupon] || {}).descuento || 0) })));
  } catch (error) {
    res.status(500).send({ message: "Error al recuperar los cupones." });
  }
};

// POST /api/cupones
exports.create = async (req, res) => {
  try {
    const { datos, error } = leerDatos(req.body || {}, { esAlta: true });
    if (error) return res.status(400).send({ message: error });
    if (datos.id_sucursal && !(await db.sucursal.findByPk(datos.id_sucursal))) return res.status(400).send({ message: "La sucursal no existe." });
    const cupon = await db.sequelize.transaction(async (t) => {
      const c = await db.cupon.create(datos, { transaction: t });
      await registrarAuditoria({ id_empleado: req.empleadoId, accion: "CUPON_CREADO", tabla_afectada: "Cupon", registro_afectado_id: c.id_cupon,
        detalles: `Cupón ${c.codigo}: ${c.tipo === "PORCENTAJE" ? `${Number(c.valor)}%` : `Q${Number(c.valor).toFixed(2)}`} de descuento.` }, t);
      return c;
    });
    res.status(201).send(cupon);
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") return res.status(400).send({ message: "Ya existe un cupón con ese código." });
    res.status(500).send({ message: "Error al crear el cupón." });
  }
};

// PUT /api/cupones/:id — el código y el tipo no cambian si el cupón ya se usó.
exports.update = async (req, res) => {
  try {
    const resultado = await db.sequelize.transaction(async (t) => {
      const c = await db.cupon.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!c) return { status: 404, message: `No se encontró el cupón con id=${req.params.id}.` };
      const { datos, error } = leerDatos(req.body || {}, { esAlta: false, actual: c });
      if (error) return { status: 400, message: error };
      if (c.usos > 0 && ((datos.codigo && datos.codigo !== c.codigo) || (datos.tipo && datos.tipo !== c.tipo))) {
        return { status: 400, message: "El cupón ya se usó: no se puede cambiar su código ni su tipo (crea uno nuevo)." };
      }
      if (datos.id_sucursal && !(await db.sucursal.findByPk(datos.id_sucursal, { transaction: t }))) return { status: 400, message: "La sucursal no existe." };
      if (!Object.keys(datos).length) return { status: 400, message: "No se enviaron cambios." };
      await c.update(datos, { transaction: t });
      await registrarAuditoria({ id_empleado: req.empleadoId, accion: "CUPON_ACTUALIZADO", tabla_afectada: "Cupon", registro_afectado_id: c.id_cupon,
        detalles: `Cupón ${c.codigo} actualizado: ${Object.keys(datos).join(", ")}.`.slice(0, 255) }, t);
      return { status: 200, c };
    });
    if (resultado.status !== 200) return res.status(resultado.status).send({ message: resultado.message });
    res.send(resultado.c);
  } catch (error) {
    if (error.name === "SequelizeUniqueConstraintError") return res.status(400).send({ message: "Ya existe un cupón con ese código." });
    res.status(500).send({ message: "Error al actualizar el cupón." });
  }
};

// DELETE /api/cupones/:id — solo si nunca se usó (si no, se desactiva).
exports.delete = async (req, res) => {
  try {
    const resultado = await db.sequelize.transaction(async (t) => {
      const c = await db.cupon.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!c) return { status: 404, message: `No se encontró el cupón con id=${req.params.id}.` };
      // Los pedidos cancelados no cuentan (la llave foránea los deja sin cupón al eliminarlo).
      const enPedidos = await db.pedido.count({ where: { id_cupon: c.id_cupon, estado: { [db.Sequelize.Op.ne]: "CANCELADO" } }, transaction: t });
      if (enPedidos > 0) return { status: 400, message: "Este cupón ya se usó en pedidos: desactívalo en lugar de eliminarlo." };
      await c.destroy({ transaction: t });
      await registrarAuditoria({ id_empleado: req.empleadoId, accion: "CUPON_ELIMINADO", tabla_afectada: "Cupon", registro_afectado_id: c.id_cupon, detalles: `Cupón ${c.codigo} eliminado.` }, t);
      return { status: 200 };
    });
    if (resultado.status !== 200) return res.status(resultado.status).send({ message: resultado.message });
    res.send({ message: "Cupón eliminado." });
  } catch (error) {
    res.status(500).send({ message: "Error al eliminar el cupón." });
  }
};
