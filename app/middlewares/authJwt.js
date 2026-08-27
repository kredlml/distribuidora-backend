const jwt = require("jsonwebtoken");
const authConfig = require("../config/auth.config.js");

const verifyToken = (req, res, next) => {
  let token = req.headers["x-access-token"] || req.headers["authorization"];

  if (token && token.startsWith("Bearer ")) {
    token = token.slice(7);
  }

  if (!token) {
    return res.status(403).send({ message: "No se proporcionó ningún token." });
  }

  jwt.verify(token, authConfig.secret, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "No autorizado: token inválido o expirado." });
    }
    req.userId = decoded.id;
    next();
  });
};

const authJwt = { verifyToken };
module.exports = authJwt;