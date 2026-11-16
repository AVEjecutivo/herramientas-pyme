/**
 * ui.js — utilidades de interfaz comunes a las herramientas de AVE.
 * La lógica de negocio vive en ave-herramientas.js; esto solo lee archivos,
 * dibuja tablas y descarga resultados. Nada sale del navegador.
 */
import { ETIQUETAS } from "./ave-herramientas.js";

/* Lo reemplaza scripts/build-herramientas.mjs con el AGENDA_URL de la portada
   (negocio/comercial/sitio/landing.html), para que haya una sola fuente. */
export const AGENDA_URL = "https://calendar.google.com/appointments/schedules/AcZssZ19mIU9CWK-z3432Oo3X_-0xPAVo6lqH83LbntRgABgQF33WmlwHP9sr8-0-4ovr-nrAQrOpn4T";
export const CORREO = "contacto@miavejecutivo.com";

/* Bibliotecas externas, con versión fija. Se cargan solo cuando se necesitan. */
export const CDN = {
  xlsx: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  pdfjsWorker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  tesseract: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"
};

/* Intermediario de IA gratuita (workers/ia-respaldo). Vacío = desactivado:
   lo que no se lea con reglas queda marcado para revisión manual. */
export const IA_URL = "";

const cargados = {};
export function cargarScript(url) {
  if (!cargados[url]) {
    cargados[url] = new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = url; s.async = true;
      s.onload = ok; s.onerror = () => mal(new Error("No se pudo cargar " + url));
      document.head.appendChild(s);
    });
  }
  return cargados[url];
}

export async function cargarXLSX() { await cargarScript(CDN.xlsx); return window.XLSX; }

export const $ = (sel, raiz) => (raiz || document).querySelector(sel);
export const fmt = n => (n === "" || n == null || isNaN(n)) ? "" : Math.round(Number(n)).toLocaleString("es-CL");
export const fmtCLP = n => "$" + fmt(n);
export const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/** Registro mínimo de uso (descargas e invitaciones), sin cookies ni terceros. */
export function registrar(evento, detalle) {
  (window.aveEventos = window.aveEventos || []).push({ evento, detalle, t: Date.now() });
}

// ── Lectura de archivos ────────────────────────────────────────

/** Texto de un archivo: prueba UTF-8 y, si aparecen caracteres inválidos, Windows-1252 (SII clásico). */
export async function leerTexto(archivo) {
  const buf = await archivo.arrayBuffer();
  let t = new TextDecoder("utf-8").decode(buf);
  if (t.includes("\uFFFD")) t = new TextDecoder("windows-1252").decode(buf);
  return t.replace(/^﻿/, "");
}

/** CSV de la primera hoja de un Excel (separado por punto y coma). */
export async function excelATexto(archivo) {
  const XLSX = await cargarXLSX();
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array", cellDates: false });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(hoja, { FS: ";", rawNumbers: true, blankrows: false });
}

/** Texto tabular de un CSV, TXT o Excel. */
export async function leerTabular(archivo) {
  return /\.(xlsx|xls|ods)$/i.test(archivo.name) ? excelATexto(archivo) : leerTexto(archivo);
}

/** Descarga un archivo de muestra (ficticio) y lo entrega como File. */
export async function archivoMuestra(ruta) {
  const r = await fetch(ruta);
  if (!r.ok) throw new Error("No se encontró la muestra " + ruta);
  return new File([await r.blob()], ruta.split("/").pop());
}

/**
 * Conecta una zona de carga (label.zona con un input file adentro).
 * @param {HTMLElement} zona
 * @param {(archivos: File[]) => void} alCargar
 */
export function zonaCarga(zona, alCargar) {
  const input = zona.querySelector("input[type=file]");
  input.addEventListener("change", () => { if (input.files.length) alCargar([...input.files]); input.value = ""; });
  ["dragenter", "dragover"].forEach(e => zona.addEventListener(e, ev => { ev.preventDefault(); zona.classList.add("sobre"); }));
  ["dragleave", "drop"].forEach(e => zona.addEventListener(e, ev => { ev.preventDefault(); zona.classList.remove("sobre"); }));
  zona.addEventListener("drop", ev => { const fs = [...(ev.dataTransfer.files || [])]; if (fs.length) alCargar(fs); });
}

// ── Tablas ─────────────────────────────────────────────────────

const etiqueta = (c, extra) => (extra && extra[c]) || ETIQUETAS[c] || c.replace(/_/g, " ").replace(/^./, x => x.toUpperCase());

/**
 * Dibuja una tabla. Las columnas numéricas se alinean a la derecha con
 * separador de miles.
 * @param {HTMLElement} cont
 * @param {object[]} filas
 * @param {string[]} columnas
 * @param {{etiquetas?:object, numericas?:string[], claseFila?:(f)=>string, limite?:number}} [op]
 */
export function mostrarTabla(cont, filas, columnas, op) {
  op = op || {};
  const num = new Set(op.numericas || columnas.filter(c => filas.some(f => typeof f[c] === "number")));
  const limite = op.limite || 500;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let h = '<div class="tabla"><table><thead><tr>' + columnas.map(c => `<th>${esc(etiqueta(c, op.etiquetas))}</th>`).join("") + "</tr></thead><tbody>";
  for (const f of filas.slice(0, limite)) {
    const cls = op.claseFila ? op.claseFila(f) : "";
    h += `<tr${cls ? ` class="${cls}"` : ""}>` + columnas.map(c => num.has(c) && typeof f[c] === "number" ? `<td class="n">${fmt(f[c])}</td>` : `<td>${esc(f[c])}</td>`).join("") + "</tr>";
  }
  h += "</tbody></table></div>";
  if (filas.length > limite) h += `<p class="estado">Se muestran ${limite} de ${filas.length} filas. La descarga incluye todas.</p>`;
  cont.innerHTML = h;
}

// ── Descargas ──────────────────────────────────────────────────

function descargarBlob(blob, nombre) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** CSV con punto y coma y BOM: se abre bien en Excel en español y en Google Sheets. */
export function descargarCSV(filas, columnas, nombre, op) {
  const sep = ";";
  const celda = v => { const s = v == null ? "" : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const enc = columnas.map(c => op && op.legible ? etiqueta(c, op.etiquetas) : c);
  const txt = "﻿" + [enc.join(sep)].concat(filas.map(f => columnas.map(c => celda(f[c])).join(sep))).join("\r\n");
  descargarBlob(new Blob([txt], { type: "text/csv;charset=utf-8" }), nombre);
  registrar("descarga", { formato: "csv", nombre });
}

/**
 * Excel listo para Copilot y Gemini: una sola fila de encabezados legibles,
 * sin celdas combinadas ni filas vacías, con filtro y anchos de columna.
 * @param {{nombre:string, filas:object[], columnas:string[], etiquetas?:object}[]} hojas
 * @param {string} nombreArchivo
 */
export async function descargarExcel(hojas, nombreArchivo) {
  const XLSX = await cargarXLSX();
  const libro = XLSX.utils.book_new();
  for (const h of hojas) {
    const aoa = [h.columnas.map(c => etiqueta(c, h.etiquetas))].concat(h.filas.map(f => h.columnas.map(c => f[c] == null ? "" : f[c])));
    const hoja = XLSX.utils.aoa_to_sheet(aoa);
    hoja["!cols"] = h.columnas.map((c, i) => ({ wch: Math.min(48, Math.max(10, ...aoa.slice(0, 200).map(r => String(r[i] == null ? "" : r[i]).length + 2))) }));
    if (aoa.length > 1) hoja["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: h.columnas.length - 1 } }) };
    marcarMiles(XLSX, hoja, aoa);
    XLSX.utils.book_append_sheet(libro, hoja, h.nombre.slice(0, 31));
  }
  XLSX.writeFile(libro, nombreArchivo, { compression: true });
  registrar("descarga", { formato: "xlsx", nombre: nombreArchivo });
}

export function marcarMiles(XLSX, hoja, aoa) {
  for (let r = 1; r < aoa.length; r++) for (let c = 0; c < aoa[r].length; c++) {
    const cel = hoja[XLSX.utils.encode_cell({ r, c })];
    if (cel && cel.t === "n" && Number.isInteger(cel.v) && Math.abs(cel.v) >= 1000) cel.z = "#,##0";
  }
}

/** Botones estándar de descarga (Excel y CSV). */
export function botonesDescarga(cont, obtener, base) {
  cont.innerHTML = `<button class="btn" data-x>Descargar Excel</button><button class="btn sec" data-c>Descargar CSV</button>`;
  cont.querySelector("[data-x]").onclick = () => { const d = obtener(); descargarExcel(d.hojas, base + ".xlsx"); };
  cont.querySelector("[data-c]").onclick = () => { const d = obtener(); const h = d.hojas[0]; descargarCSV(h.filas, h.columnas, base + ".csv"); };
}

// ── Invitación ─────────────────────────────────────────────────

export const TEXTO_PROGRAMA = "En AVE lo acompañamos a construir un ecosistema de datos que se alimenta solo y se mantiene consistente gracias a la IA. Los cálculos se hacen con fórmulas en tablas —exactos y sin costo— y la IA se usa únicamente en la parte interpretativa de los informes. Los primeros meses nosotros levantamos y ordenamos su información y generamos los informes, capacitando a su equipo en todo momento; luego construimos juntos, y al cabo de un año su equipo construye sus propias mejoras de forma autónoma.";

/**
 * Muestra la invitación junto al resultado (nunca antes).
 * @param {HTMLElement} cont
 * @param {string} pregunta  la frase de entrada, propia de cada herramienta
 */
export function invitacion(cont, pregunta) {
  cont.innerHTML = `<aside class="invitacion" aria-label="Programa AVE">
    <h2>${pregunta}</h2>
    <p>${TEXTO_PROGRAMA}</p>
    <a class="btn" data-agenda href="mailto:${CORREO}?subject=Diagn%C3%B3stico%20AVE">Agendar un diagnóstico</a>
    <small>El diagnóstico cuesta $30.000 y se paga al final, una vez entregado. No lo compromete a seguir.</small>
  </aside>`;
  conectarAgenda(cont);
}

export function conectarAgenda(raiz) {
  (raiz || document).querySelectorAll("[data-agenda]").forEach(a => {
    if (AGENDA_URL && AGENDA_URL.startsWith("http")) { a.href = AGENDA_URL; a.target = "_blank"; a.rel = "noopener"; }
    if (!a.dataset.conectado) { a.dataset.conectado = "1"; a.addEventListener("click", () => registrar("invitacion", { pagina: location.pathname })); }
  });
}

export function estado(el, texto, tipo) {
  el.className = tipo ? `aviso ${tipo}` : "estado";
  el.textContent = texto;
}
