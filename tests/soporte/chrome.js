// Ruta del navegador Chrome/Edge para las pruebas de interfaz (CHROME_PATH o la instalación habitual).
const fs = require("fs");

const CANDIDATOS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

module.exports = function rutaChrome() {
  const r = CANDIDATOS.find((c) => fs.existsSync(c));
  if (!r) throw new Error("No encontré Chrome ni Edge. Indica la ruta con la variable CHROME_PATH.");
  return r;
};
