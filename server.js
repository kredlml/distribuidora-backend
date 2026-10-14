const dotenv = require("dotenv");
const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
dotenv.config({ path: envFile });

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const app = express();

// Orígenes permitidos para el frontend. Se pueden definir varios separados por coma en
// la variable de entorno CORS_ORIGIN; si no existe se conserva el valor original.
var corsOptions = {
  origin: (process.env.CORS_ORIGIN || "http://localhost:8081").split(",").map(o => o.trim())
};
app.use(cors(corsOptions));

/*
app.post(
  "/api/pago/webhook",
  express.raw({ type: "application/json" }),
  require("./app/controllers/pago.controller.js").webhook
);
*/

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const db = require("./app/models");
db.sequelize.sync({ alter: true });


app.get("/", (req, res) => {
  res.json({
    message: "UMG Proyecto Final - API REST Control de Inventarios",
    ambiente: process.env.NODE_ENV || "development"
  });
});

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
require("./app/routes/webhook.routes")(app);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT} [Ambiente: ${process.env.NODE_ENV || "development"}].`);
});