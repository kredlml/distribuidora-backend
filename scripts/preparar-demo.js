// Deja el sistema listo para la demostración. Trabaja SOLO a través de la API (respeta todas las
// reglas del sistema), NO borra nada y se puede correr varias veces: lo que ya existe no se repite.
//
//   npm run demo:preparar -- --api https://distribuidora-api-r6rw.onrender.com
//   npm run demo:despertar            (solo despierta los servicios de Render antes de presentar)
//
// Pide el correo y la contraseña de una cuenta DISTRITAL (o usa DEMO_EMAIL / DEMO_PASSWORD).
// Crea, si no existen:
//   - cuentas de demostración: un ADMIN, un CAJERO y un BODEGUERO de la sucursal principal, y una
//     clienta de la tienda en línea (todas con la contraseña DEMO_CLAVE, por defecto Demo2026!);
//   - catálogo mínimo de ropa para dama si hay menos de 3 prendas;
//   - stock: cada prenda activa con al menos DEMO_STOCK unidades disponibles en cada sucursal;
//   - cupones DEMO10 (10 %) y BIENVENIDA50 (Q50 desde Q300);
//   - ventas del día en varias sucursales (pagadas y en distintos estados) para que los reportes
//     tengan datos, y un pedido ENTREGADO de la clienta demo (para mostrar una devolución).
const readline = require("readline");

const args = process.argv.slice(2);
const opcion = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const API = (opcion("api", process.env.DEMO_API || "http://localhost:8080")).replace(/\/+$/, "");
const CLAVE = process.env.DEMO_CLAVE || "Demo2026!";
const STOCK_MIN = Math.max(1, Number(process.env.DEMO_STOCK) || 15);
const VENTAS = Math.max(0, Number(opcion("ventas", 8)));
const DOMINIO = "demo.distribuidora.gt";
const CUENTAS = {
  admin: { nombre: "Andrea", apellido: "Demo Admin", email: `admin@${DOMINIO}`, puesto: "ADMIN" },
  cajero: { nombre: "Camila", apellido: "Demo Caja", email: `caja@${DOMINIO}`, puesto: "CAJERO" },
  bodeguero: { nombre: "Bruno", apellido: "Demo Bodega", email: `bodega@${DOMINIO}`, puesto: "BODEGUERO" },
};
const CLIENTA = { nombre: "Valeria", apellido: "Demo", email: `clienta@${DOMINIO}`, direccion: "12 calle 1-25, zona 10, Ciudad de Guatemala", telefono: "55551234" };
const CLIENTAS_MOSTRADOR = [
  { nombre: "Lucía", apellido: "Hernández", email: `lucia@${DOMINIO}`, telefono: "55550001" },
  { nombre: "Mariana", apellido: "López", email: `mariana@${DOMINIO}`, telefono: "55550002" },
  { nombre: "Sofía", apellido: "García", email: `sofia@${DOMINIO}`, telefono: "55550003" },
];
const CATALOGO = [
  { tipo: "Blusas", nombre: "Blusa de lino", descripcion: "Blusa fresca de lino, corte holgado.", precio: 189, variantes: [["S", "Blanco"], ["M", "Blanco"], ["L", "Blanco"], ["M", "Rosa"]] },
  { tipo: "Vestidos", nombre: "Vestido midi floral", descripcion: "Vestido midi con estampado floral.", precio: 349, variantes: [["S", "Azul"], ["M", "Azul"], ["L", "Azul"]] },
  { tipo: "Pantalones", nombre: "Pantalón palazzo", descripcion: "Pantalón de tiro alto y pierna amplia.", precio: 259, variantes: [["S", "Negro"], ["M", "Negro"], ["L", "Beige"]] },
];

const log = (s) => console.log(s);
const ok = (s) => console.log(`  ✓ ${s}`);
const ya = (s) => console.log(`  · ${s} (ya existía)`);

async function api(metodo, ruta, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let r;
  for (let intento = 0; intento < 3; intento++) {
    try { r = await fetch(API + ruta, { method: metodo, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) }); break; }
    catch (e) { if (intento === 2) throw new Error(`No se pudo conectar con ${API} (${e.message}).`); await new Promise((ok) => setTimeout(ok, 3000)); }
  }
  const texto = await r.text();
  let datos; try { datos = JSON.parse(texto); } catch { datos = texto; }
  return { status: r.status, datos };
}
async function exigir(metodo, ruta, opciones, que) {
  const r = await api(metodo, ruta, opciones);
  if (r.status >= 400) throw new Error(`${que}: ${r.status} ${typeof r.datos === "object" ? r.datos.message : r.datos}`);
  return r.datos;
}

function preguntar(texto, oculto = false) {
  return new Promise((resolver) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) rl._writeToOutput = (s) => { if (s.includes(texto)) rl.output.write(s); else rl.output.write("*"); };
    rl.question(texto, (r) => { rl.close(); if (oculto) process.stdout.write("\n"); resolver(r.trim()); });
  });
}

async function despertar() {
  const urls = [`${API}/api/salud`, opcion("panel", "https://distribuidora-panel.onrender.com"), opcion("tienda", "https://distribuidora-tienda.onrender.com")];
  log("Despertando los servicios (la primera respuesta del plan gratis puede tardar ~50 s)…");
  for (const u of urls) {
    const t0 = Date.now();
    try { const r = await fetch(u, { signal: AbortSignal.timeout(120000) }); ok(`${u} → ${r.status} en ${((Date.now() - t0) / 1000).toFixed(1)} s`); }
    catch (e) { log(`  ✗ ${u} → ${e.message}`); }
  }
}

(async () => {
  if (args.includes("--despertar")) return despertar();
  log(`API: ${API}`);
  const salud = await api("GET", "/api/salud");
  if (salud.status !== 200) throw new Error(`La API no respondió bien en /api/salud (${salud.status}).`);
  ok("API en línea y con base de datos");

  const email = process.env.DEMO_EMAIL || await preguntar("Correo de una cuenta DISTRITAL: ");
  const password = process.env.DEMO_PASSWORD || await preguntar("Contraseña: ", true);
  const login = await api("POST", "/api/auth/login", { body: { email, password } });
  if (login.status !== 200 || !login.datos.token) throw new Error(`No se pudo iniciar sesión: ${login.datos && login.datos.message}`);
  if (String(login.datos.puesto).toUpperCase() !== "DISTRITAL") throw new Error("La cuenta debe ser DISTRITAL (gerente distrital): solo ella puede preparar todas las sucursales.");
  const T = login.datos.token;
  ok(`Sesión de ${login.datos.nombre} (DISTRITAL)`);

  // ---- Sucursales
  log("\nSucursales");
  let sucursales = (await exigir("GET", "/api/sucursales", { token: T }, "Listar sucursales")).filter((s) => s.activo !== false);
  if (!sucursales.length) {
    for (const [nombre, ciudad] of [["Centro", "Guatemala"], ["Miraflores", "Guatemala"], ["Xela", "Quetzaltenango"]]) {
      await exigir("POST", "/api/sucursales", { token: T, body: { nombre, ciudad, direccion: `Sucursal ${nombre}`, telefono: "22220000", activo: true } }, `Crear sucursal ${nombre}`);
      ok(`Sucursal ${nombre} creada`);
    }
    sucursales = (await exigir("GET", "/api/sucursales", { token: T }, "Listar sucursales")).filter((s) => s.activo !== false);
  }
  sucursales.sort((a, b) => a.id_sucursal - b.id_sucursal);
  const principal = sucursales[0];
  ok(`${sucursales.length} sucursal(es) activa(s); principal para la demo: ${principal.nombre}`);

  // ---- Catálogo mínimo
  log("\nCatálogo");
  let productos = (await exigir("GET", "/api/productos", {}, "Listar prendas")).filter((p) => p.activo !== false);
  if (productos.length < 3) {
    const categorias = await exigir("GET", "/api/categorias", {}, "Listar tipos de prenda");
    for (const prenda of CATALOGO) {
      let cat = categorias.find((c) => c.nombre.toLowerCase() === prenda.tipo.toLowerCase());
      if (!cat) cat = await exigir("POST", "/api/categorias", { token: T, body: { nombre: prenda.tipo } }, `Crear tipo ${prenda.tipo}`);
      if (productos.some((p) => p.nombre === prenda.nombre)) { ya(prenda.nombre); continue; }
      let padre = null;
      for (const [talla, color] of prenda.variantes) {
        const p = await exigir("POST", "/api/productos", { token: T, body: { nombre: prenda.nombre, descripcion: prenda.descripcion, talla, color, precio_unitario: prenda.precio, id_categoria: cat.id_categoria, stock_minimo: 3, id_producto_padre: padre } }, `Crear ${prenda.nombre}`);
        padre = padre || p.id_producto;
      }
      ok(`${prenda.nombre} (${prenda.variantes.length} variantes)`);
    }
    productos = (await exigir("GET", "/api/productos", {}, "Listar prendas")).filter((p) => p.activo !== false);
  } else ya(`${productos.length} prendas activas en el catálogo`);

  // ---- Stock
  log("\nStock");
  const stock = await exigir("GET", "/api/inventario/stock", { token: T }, "Consultar stock");
  const disp = (p, s) => Number((stock.find((x) => x.id_producto === p && x.id_sucursal === s) || {}).stock_total || 0);
  let ingresos = 0;
  for (const s of sucursales) for (const p of productos) {
    const falta = STOCK_MIN - disp(p.id_producto, s.id_sucursal);
    if (falta > 0) { await exigir("POST", "/api/inventario", { token: T, body: { id_producto: p.id_producto, id_sucursal: s.id_sucursal, cantidad: falta, lote: "DEMO" } }, "Ingresar stock"); ingresos++; }
  }
  ingresos ? ok(`${ingresos} ingreso(s) de stock: cada prenda tiene al menos ${STOCK_MIN} unidades en cada sucursal`) : ya(`stock de al menos ${STOCK_MIN} por prenda y sucursal`);

  // ---- Cuentas de empleados de la demo
  log("\nCuentas de empleados de la demo");
  const empleados = await exigir("GET", "/api/empleados", { token: T }, "Listar empleados");
  for (const c of Object.values(CUENTAS)) {
    if (empleados.some((e) => String(e.email).toLowerCase() === c.email)) { ya(`${c.puesto} ${c.email}`); continue; }
    await exigir("POST", "/api/auth/registro", { token: T, body: { ...c, password: CLAVE, id_sucursal: principal.id_sucursal } }, `Crear ${c.puesto}`);
    ok(`${c.puesto} ${c.email} (sucursal ${principal.nombre})`);
  }

  // ---- Clienta de la tienda y clientas de mostrador
  log("\nClientas");
  let tokClienta = null;
  const reg = await api("POST", "/api/tienda/auth/registro", { body: { ...CLIENTA, password: CLAVE } });
  if (reg.status === 201) { tokClienta = reg.datos.token; ok(`Clienta de la tienda ${CLIENTA.email}`); }
  else {
    const l = await api("POST", "/api/tienda/auth/login", { body: { email: CLIENTA.email, password: CLAVE } });
    if (l.status === 200) { tokClienta = l.datos.token; ya(`clienta de la tienda ${CLIENTA.email}`); }
    else log(`  ! La clienta ${CLIENTA.email} existe con otra contraseña; se omite su pedido de ejemplo.`);
  }
  const buscar = async (correo) => (await exigir("GET", `/api/clientes?email=${encodeURIComponent(correo)}`, { token: T }, "Buscar clienta"))[0] || null;
  const fichaClienta = await buscar(CLIENTA.email);
  const mostrador = [];
  for (let i = 0; i < CLIENTAS_MOSTRADOR.length; i++) {
    const c = CLIENTAS_MOSTRADOR[i];
    let ficha = await buscar(c.email);
    if (!ficha) { ficha = await exigir("POST", "/api/clientes", { token: T, body: { ...c, id_sucursal: sucursales[i % sucursales.length].id_sucursal } }, `Registrar ${c.nombre}`); ok(`Clienta de mostrador ${c.nombre} ${c.apellido}`); }
    else ya(`clienta de mostrador ${c.nombre} ${c.apellido}`);
    mostrador.push(ficha);
  }

  // ---- Cupones
  log("\nCupones");
  const cupones = await exigir("GET", "/api/cupones", { token: T }, "Listar cupones");
  for (const c of [
    { codigo: "DEMO10", descripcion: "10 % en toda la tienda", tipo: "PORCENTAJE", valor: 10 },
    { codigo: "BIENVENIDA50", descripcion: "Q50 de descuento en compras desde Q300", tipo: "MONTO", valor: 50, minimo_compra: 300 },
  ]) {
    if (cupones.some((x) => x.codigo === c.codigo)) { ya(`cupón ${c.codigo}`); continue; }
    await exigir("POST", "/api/cupones", { token: T, body: c }, `Crear cupón ${c.codigo}`);
    ok(`Cupón ${c.codigo}: ${c.descripcion}`);
  }

  // ---- Ventas de ejemplo para los reportes (solo si las clientas demo aún no tienen pedidos)
  log("\nVentas de ejemplo");
  const yaHay = (await exigir("GET", `/api/pedidos?id_cliente=${mostrador[0].id_cliente}`, { token: T }, "Revisar pedidos")).length > 0;
  if (yaHay && !args.includes("--forzar")) ya("ventas de ejemplo (usa --forzar para agregar más)");
  else {
    const metodos = ["EFECTIVO", "TARJETA", "EFECTIVO", "TARJETA"];
    const estados = ["PROCESADO", "ENVIADO", "ENTREGADO", "ENTREGADO"];
    for (let i = 0; i < VENTAS; i++) {
      const suc = sucursales[i % sucursales.length];
      const prendas = productos.slice((i * 2) % productos.length).concat(productos).slice(0, 1 + (i % 3));
      const p = (await exigir("POST", "/api/pedidos", { token: T, body: { id_cliente: mostrador[i % mostrador.length].id_cliente, id_sucursal: suc.id_sucursal, cupon: i % 4 === 1 ? "DEMO10" : undefined, detalles: prendas.map((x, k) => ({ id_producto: x.id_producto, cantidad: 1 + ((i + k) % 2) })) } }, "Crear venta")).pedido;
      if (Number(p.total) > 0) await exigir("POST", "/api/pagos", { token: T, body: { id_pedido: p.id_pedido, metodo_pago: metodos[i % 4], monto: Number(p.total), referencia: metodos[i % 4] === "TARJETA" ? `AUT-${1000 + i}` : undefined } }, "Cobrar venta");
      const destino = estados[i % estados.length];
      for (const e of ["ENVIADO", "ENTREGADO"]) {
        if (destino === "PROCESADO" || (destino === "ENVIADO" && e === "ENTREGADO")) break;
        await exigir("PUT", `/api/pedidos/${p.id_pedido}/estado`, { token: T, body: { estado: e } }, "Avanzar estado");
      }
      ok(`Venta #${p.id_pedido} en ${suc.nombre}: Q${Number(p.total).toFixed(2)}, ${destino.toLowerCase()}`);
    }
  }

  // ---- Pedido entregado de la clienta demo (para mostrar una devolución sin esperar)
  log("\nPedido entregado de la clienta demo");
  if (fichaClienta && tokClienta) {
    // Solo sirve uno entregado hace menos de 20 h (el plazo de cambios es de 24 h y se usa en la demo).
    const suyos = (await exigir("GET", `/api/pedidos?id_cliente=${fichaClienta.id_cliente}&estado=ENTREGADO`, { token: T }, "Revisar pedidos de la clienta"))
      .filter((p) => p.fecha_entrega && Date.now() - new Date(p.fecha_entrega).getTime() < 20 * 3600 * 1000);
    if (suyos.length && !args.includes("--forzar")) ya(`pedido entregado #${suyos[0].id_pedido} (todavía dentro del plazo de cambios de 24 h)`);
    else {
      const p = (await exigir("POST", "/api/pedidos", { token: T, body: { id_cliente: fichaClienta.id_cliente, id_sucursal: principal.id_sucursal, detalles: [{ id_producto: productos[0].id_producto, cantidad: 2 }] } }, "Crear pedido de la clienta")).pedido;
      await exigir("POST", "/api/pagos", { token: T, body: { id_pedido: p.id_pedido, metodo_pago: "EFECTIVO", monto: Number(p.total) } }, "Cobrar pedido de la clienta");
      for (const e of ["ENVIADO", "ENTREGADO"]) await exigir("PUT", `/api/pedidos/${p.id_pedido}/estado`, { token: T, body: { estado: e } }, "Entregar pedido");
      ok(`Pedido #${p.id_pedido} entregado a ${CLIENTA.nombre}: puede pedir un cambio o devolución durante 24 h`);
    }
  } else log("  · se omite (no hay sesión de la clienta demo)");

  log(`\nListo. Cuentas de la demo (contraseña de todas: ${process.env.DEMO_CLAVE ? "la de DEMO_CLAVE" : CLAVE}):`);
  for (const c of Object.values(CUENTAS)) log(`  ${c.puesto.padEnd(10)} ${c.email}  (sucursal ${principal.nombre})`);
  log(`  CLIENTA    ${CLIENTA.email}  (tienda en línea)`);
  log("  Cupones: DEMO10 (10 %), BIENVENIDA50 (Q50 desde Q300) · Tarjeta de prueba de Stripe: 4242 4242 4242 4242");
})().catch((e) => { console.error(`\nError: ${e.message}`); process.exitCode = 1; });
