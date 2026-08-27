// Cargar dotenv al inicio según el entorno (desarrollo o producción)
const dotenv = require("dotenv");
const envFile = process.env.NODE_ENV === "production" ? ".env.production" : ".env.development";
dotenv.config({ path: envFile });

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const app = express();

var corsOptions = {
  origin: "http://localhost:8081"
};
app.use(cors(corsOptions));

// 🚨 PASO CRÍTICO: EL WEBHOOK DE STRIPE ANTES DEL BODY-PARSER 🚨
// Lo dejamos comentado solo por hoy hasta que armes el nuevo controlador de pagos
/*
app.post(
  "/api/pago/webhook",
  express.raw({ type: "application/json" }),
  require("./app/controllers/pago.controller.js").webhook
);
*/

// Parsear cuerpo de peticiones (Lo normal para el resto de la app)
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Conexión y sincronización de base de datos en Neon
const db = require("./app/models");
db.sequelize.sync();

// Ruta de prueba inicial (Actualizada para el nuevo proyecto)
app.get("/", (req, res) => {
  res.json({
    message: "UMG Proyecto Final - API REST Control de Inventarios",
    ambiente: process.env.NODE_ENV || "development"
  });
});

// 🚀 Espacio para las NUEVAS rutas del Problema 4 (Las iremos descomentando)
// require("./app/routes/sucursal.routes")(app);
// require("./app/routes/proveedor.routes")(app);
// require("./app/routes/producto.routes")(app);
// require("./app/routes/inventario.routes")(app);
// require("./app/routes/pedido.routes")(app);
// require("./app/routes/pago.routes")(app); 

// Escuchar peticiones en el puerto asignado
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT} [Ambiente: ${process.env.NODE_ENV || "development"}].`);
});