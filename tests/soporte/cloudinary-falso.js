// Cloudinary falso para pruebas: verifica las firmas igual que el real (SHA-1 de los parámetros
// ordenados + secreto), responde secure_url y registra subidas y borrados.
const http = require("http");
const crypto = require("crypto");

function crear({ cloud, apiKey, secret }) {
  const estado = { subidas: [], borradas: [], rechazos: [] };
  const firmar = (p) => crypto.createHash("sha1").update(Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("&") + secret).digest("hex");
  let n = 0;
  const server = http.createServer((req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const trozos = [];
    req.on("data", (c) => trozos.push(c));
    req.on("end", () => {
      const cuerpo = Buffer.concat(trozos);
      const enviar = (code, obj) => { res.writeHead(code, { ...cors, "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (req.url === `/v1_1/${cloud}/image/upload`) {
        const texto = cuerpo.toString("latin1");
        const campo = (nombre) => { const m = texto.match(new RegExp(`name="${nombre}"\\r\\n\\r\\n([^\\r]*)\\r\\n`)); return m ? m[1] : undefined; };
        const p = { allowed_formats: campo("allowed_formats"), folder: campo("folder"), timestamp: campo("timestamp") };
        const tieneArchivo = /name="file"; filename="/.test(texto);
        if (campo("api_key") !== apiKey || campo("signature") !== firmar(p) || !tieneArchivo) {
          estado.rechazos.push("upload");
          return enviar(401, { error: { message: "Invalid Signature" } });
        }
        const id = `${p.folder}/foto${++n}`;
        estado.subidas.push(id);
        return enviar(200, { public_id: id, secure_url: `https://res.cloudinary.com/${cloud}/image/upload/v17000000${n}/${id}.jpg` });
      }
      if (req.url === `/v1_1/${cloud}/image/destroy`) {
        const f = Object.fromEntries(new URLSearchParams(cuerpo.toString()));
        if (f.api_key !== apiKey || f.signature !== firmar({ public_id: f.public_id, timestamp: f.timestamp })) {
          estado.rechazos.push("destroy");
          return enviar(401, { error: { message: "Invalid Signature" } });
        }
        estado.borradas.push(f.public_id);
        return enviar(200, { result: "ok" });
      }
      enviar(404, { error: { message: "no simulado" } });
    });
  });
  return { server, estado };
}
module.exports = { crear };
