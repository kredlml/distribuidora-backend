const dotenv = require("dotenv");
const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
dotenv.config({ path: envFile });

// Monitoreo: Sentry (solo si hay SENTRY_DSN) se inicia antes que Express.
const monitoreo = require("./app/utils/monitoreo");
monitoreo.iniciarSentry();

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const app = express();
// Detrás del proxy de Render (un salto) req.ip debe ser la IP real del cliente, no la del proxy:
// la usa el límite de intentos de login/registro.
app.set("trust proxy", 1);

// Id por petición (cabecera X-Request-Id) y registro de toda respuesta 5xx en ErrorServidor.
app.use(monitoreo.idDePeticion);
app.use(monitoreo.registrarRespuestas5xx);

// Orígenes permitidos: panel de empleados (frontend/, puerto 8081) y tienda en línea
// (tienda/, puerto 8082). Se pueden definir varios separados por coma en CORS_ORIGIN.
var corsOptions = {
  origin: (process.env.CORS_ORIGIN || "http://localhost:8081,http://localhost:8082").split(",").map(o => o.trim()),
  exposedHeaders: ["X-Request-Id"]
};
app.use(cors(corsOptions));

// El webhook de Stripe va ANTES de bodyParser.json: la firma se valida sobre el body crudo
// (express.raw en webhook.routes); si el JSON ya fue parseado, la validación siempre falla.
require("./app/routes/webhook.routes")(app);

// inflate:false: no se aceptan cuerpos comprimidos (ningún cliente los envía y body-parser < 2.4.0
// tiene una denegación de servicio con ellos, GHSA-27r3-jxmh-p828).
app.use(bodyParser.json({ inflate: false }));
app.use(bodyParser.urlencoded({ extended: true, inflate: false }));

const db = require("./app/models");
// El esquema se maneja con migraciones (app/migraciones, npm run migrar); el servidor aplica las
// pendientes antes de escuchar (ver el final de este archivo).
const { prepararBase, vigilarEsquema } = require("./app/utils/migrador");


app.get("/", (req, res) => {
  res.json({
    message: "UMG Proyecto Final - API REST Control de Inventarios",
    ambiente: process.env.NODE_ENV || "development"
  });
});

require("./app/routes/salud.routes")(app);
require("./app/routes/sucursal.routes")(app);
require("./app/routes/cliente.routes")(app);
require("./app/routes/proveedor.routes")(app);
require("./app/routes/categoria.routes")(app);
require("./app/routes/empleado.routes")(app);
require("./app/routes/producto.routes")(app);
require("./app/routes/inventario.routes")(app);
require("./app/routes/pedido.routes")(app);
require("./app/routes/detalle_pedido.routes")(app);
require("./app/routes/pago.routes")(app);
require("./app/routes/reporte.routes")(app);
require("./app/routes/auth.routes")(app);
require("./app/routes/devolucion.routes")(app);
require("./app/routes/auditoria.routes")(app);
require("./app/routes/tienda.routes")(app);
require("./app/routes/imagen.routes")(app);
require("./app/routes/reembolso.routes")(app);
require("./app/routes/cupon.routes")(app);

// Rutas /api que no existen y errores no controlados: respuesta JSON (nunca la pila al cliente).
app.use("/api", monitoreo.noEncontrado);
app.use(monitoreo.manejadorDeErrores);
monitoreo.vigilarProceso();

const PORT = process.env.PORT || 8080;
prepararBase(db)
  .then(() => {
    vigilarEsquema(db);
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en el puerto ${PORT} [Ambiente: ${process.env.NODE_ENV || "development"}].`);
    });
    // Tareas periódicas: pedidos pendientes de pago que vencen y reembolsos a tarjeta pendientes.
    require("./app/utils/vencimientos").iniciarVencimientos();
  })
  .catch((error) => {
    // Sin base al día no se atiende: mejor no arrancar que trabajar con un esquema a medias.
    console.error(`[migración] No se pudo preparar la base de datos: ${error.message}`);
    process.exit(1);
  });
