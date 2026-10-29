// Ajustes de esquema que sync({ alter: true }) no sabe hacer: índices únicos sin distinguir
// mayúsculas. Se ejecutan después de sync. Si la base ya tiene valores repetidos, el índice
// no se crea y el servidor sigue funcionando: se avisa en consola para corregirlos a mano.
const INDICES_UNICOS = [
  { nombre: "empleado_email_lower_unico", tabla: '"Empleado"', expresion: "lower(email)", que: "correos de empleados" },
  { nombre: "categoria_nombre_lower_unico", tabla: '"Categoria"', expresion: "lower(nombre)", que: "nombres de tipos de prenda" },
  { nombre: "cliente_email_lower_unico", tabla: '"Cliente"', expresion: "lower(email)", que: "correos de clientes" },
];

async function asegurarIndicesUnicos(db) {
  for (const i of INDICES_UNICOS) {
    try {
      await db.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${i.nombre} ON ${i.tabla} (${i.expresion})`);
    } catch (error) {
      console.warn(`[migración] No se pudo crear el índice único de ${i.que} (¿hay valores repetidos?): ${error.message}`);
    }
  }
  await completarFechasDeEntrega(db);
  await asegurarDistrital(db);
  await completarSucursalDeClientes(db);
}

// Bases creadas antes de existir el puesto DISTRITAL: si no hay ningún DISTRITAL activo con
// contraseña, se promueve a los ADMIN sin sucursal (los que ya trabajaban con todas); si no hay,
// al ADMIN activo más antiguo. Sin esto nadie podría editar el catálogo ni las sucursales.
async function asegurarDistrital(db) {
  try {
    const [[{ n }]] = await db.sequelize.query(`SELECT count(*)::int n FROM "Empleado" WHERE upper(trim(puesto)) = 'DISTRITAL' AND activo AND password IS NOT NULL`);
    if (n > 0) return;
    let [promovidos] = await db.sequelize.query(`
      UPDATE "Empleado" SET puesto = 'DISTRITAL', id_sucursal = NULL
      WHERE upper(trim(puesto)) = 'ADMIN' AND id_sucursal IS NULL AND activo AND password IS NOT NULL
      RETURNING id_empleado, email`);
    if (!promovidos.length) {
      [promovidos] = await db.sequelize.query(`
        UPDATE "Empleado" SET puesto = 'DISTRITAL', id_sucursal = NULL
        WHERE id_empleado = (SELECT id_empleado FROM "Empleado" WHERE upper(trim(puesto)) = 'ADMIN' AND activo AND password IS NOT NULL ORDER BY id_empleado LIMIT 1)
        RETURNING id_empleado, email`);
    }
    for (const e of promovidos) {
      await db.sequelize.query(`INSERT INTO auditoria (id_empleado, accion, tabla_afectada, registro_afectado_id, detalles, "createdAt", "updatedAt")
        VALUES (:id, 'EMPLEADO_PROMOVIDO_DISTRITAL', 'Empleado', :id, :detalles, NOW(), NOW())`,
        { replacements: { id: e.id_empleado, detalles: `Empleado #${e.id_empleado} (${e.email}) promovido a DISTRITAL al no existir ninguno.` } });
      console.log(`[migración] ${e.email} ahora es DISTRITAL (gerente distrital: todas las sucursales).`);
    }
  } catch (error) {
    console.warn(`[migración] No se pudo asegurar un DISTRITAL: ${error.message}`);
  }
}

// Clientes de mostrador registrados antes de existir Cliente.id_sucursal: se les asigna la
// sucursal del empleado que los registró (según la auditoría), para que su sucursal los siga viendo.
async function completarSucursalDeClientes(db) {
  try {
    await db.sequelize.query(`
      UPDATE "Cliente" c SET id_sucursal = e.id_sucursal
      FROM auditoria a JOIN "Empleado" e ON e.id_empleado = a.id_empleado
      WHERE a.accion = 'CLIENTE_REGISTRADO' AND a.tabla_afectada = 'Cliente' AND a.registro_afectado_id = c.id_cliente
        AND c.id_sucursal IS NULL AND e.id_sucursal IS NOT NULL`);
  } catch (error) {
    console.warn(`[migración] No se pudo completar la sucursal de los clientes: ${error.message}`);
  }
}

// Pedidos ENTREGADOS de antes de existir Pedido.fecha_entrega: se toma la fecha de la auditoría
// que registró el paso a ENTREGADO. Sin ese registro queda NULL (el plazo de cambios se da por vencido).
async function completarFechasDeEntrega(db) {
  try {
    await db.sequelize.query(`
      UPDATE "Pedido" p SET fecha_entrega = a.fecha
      FROM (SELECT registro_afectado_id AS id, MAX("createdAt") AS fecha FROM auditoria
            WHERE tabla_afectada = 'Pedido' AND accion = 'PEDIDO_ESTADO_ACTUALIZADO' AND detalles LIKE '%a ENTREGADO.%'
            GROUP BY registro_afectado_id) a
      WHERE p.id_pedido = a.id AND p.estado = 'ENTREGADO' AND p.fecha_entrega IS NULL`);
  } catch (error) {
    console.warn(`[migración] No se pudieron completar las fechas de entrega: ${error.message}`);
  }
}

module.exports = { asegurarIndicesUnicos };
