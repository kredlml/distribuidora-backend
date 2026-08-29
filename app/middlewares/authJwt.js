const jwt = require("jsonwebtoken");

exports.verificarToken = (req, res, next) => {
  
  let tokenHeader = req.headers["authorization"];

  if (!tokenHeader) {
    return res.status(403).send({ message: "¡No se proporcionó un token de seguridad!" });
  }

  
  const token = tokenHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "¡Token no autorizado o expirado!" });
    }
   
    req.empleadoId = decoded.id;
    next(); 
  });
};