/**
 * ui.js — utilidades de interfaz comunes a las herramientas de AVE.
 * La lógica de negocio vive en ave-herramientas.js; esto solo lee archivos,
 * dibuja resultados y descarga tablas. Nada sale del navegador.
 */
import { ETIQUETAS } from "./ave-herramientas.js";
import { icono, herramienta, tarjeta } from "./catalogo.js";
import { datos, sesionGuardada } from "./sesion.js";

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
      s.onload = ok; s.onerror = () => { delete cargados[url]; mal(new Error("No se pudo cargar una biblioteca necesaria. Revise su conexión e intente de nuevo.")); };
      document.head.appendChild(s);
    });
  }
  return cargados[url];
}

export async function cargarXLSX() { await cargarScript(CDN.xlsx); return window.XLSX; }

export const $ = (sel, raiz) => (raiz || document).querySelector(sel);
export const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const fmt = n => (n === "" || n == null || isNaN(n)) ? "" : Math.round(Number(n)).toLocaleString("es-CL");
export const fmtCLP = n => (Number(n) < 0 ? "−$" : "$") + fmt(Math.abs(Number(n) || 0));
export const fmtPct = n => Number(n).toLocaleString("es-CL", { maximumFractionDigits: 1 }) + "%";
export const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
/** 2026-07-08 → 08-07-2026, como se escribe en Chile. */
export const fmtFecha = iso => /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? String(iso).split("-").reverse().join("-") : iso;
/** Monto abreviado para ejes y titulares cortos: $14,3 M · $850 mil. */
export function fmtCorto(n) {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toLocaleString("es-CL", { maximumFractionDigits: a >= 1e7 ? 0 : 1 })} M`;
  if (a >= 1e3) return `${s}$${Math.round(a / 1e3).toLocaleString("es-CL")} mil`;
  return `${s}$${Math.round(a)}`;
}
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-06" → "junio de 2026" */
export const nombreMes = m => { const [a, n] = String(m).split("-"); return `${MESES[Number(n) - 1]} de ${a}`; };
/** "Suma de 2 cuentas: BCI $X, Santander $Y" cuando las cartolas son de más de una cuenta; si no, "". Devuelve texto, no HTML. */
export function notaCuentas(cuentas) {
  if (!cuentas || cuentas.length < 2) return "";
  const repetido = b => cuentas.filter(c => c.banco === b).length > 1;
  return `Suma de ${cuentas.length} cuentas: ` + cuentas.map(c => `${c.banco}${repetido(c.banco) ? ` (${c.archivos.at(-1).replace(/\.\w+$/, "")})` : ""} ${fmtCLP(c.saldo)}`).join(", ");
}
export const plural = (n, uno, varios) => `${fmt(n)} ${n === 1 ? uno : varios}`;

/** Registro mínimo de uso (descargas e invitaciones), sin cookies ni terceros. */
export function registrar(evento, detalle) {
  (window.aveEventos = window.aveEventos || []).push({ evento, detalle, t: Date.now() });
}

// ── Lectura de archivos ────────────────────────────────────────

/** Texto de un archivo: prueba UTF-8 y, si aparecen caracteres inválidos, Windows-1252 (SII clásico). */
export async function leerTexto(archivo) {
  const buf = await archivo.arrayBuffer();
  let t = new TextDecoder("utf-8").decode(buf);
  if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf);
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

// ── Montos con separador de miles ──────────────────────────────

/**
 * Convierte los <input data-monto> en campos que muestran los miles mientras
 * se escribe ($2.450.000 se lee; 2450000 no). El valor se lee con num().
 */
export function activarMontos(raiz) {
  (raiz || document).querySelectorAll("input[data-monto]").forEach(i => {
    if (i.dataset.montoListo) return;
    i.dataset.montoListo = "1"; i.type = "text"; i.inputMode = "numeric"; i.autocomplete = "off";
    const pintar = () => { const neg = /^\s*-/.test(i.value); const d = i.value.replace(/\D/g, ""); i.value = d ? (neg ? "-" : "") + Number(d).toLocaleString("es-CL") : (neg ? "-" : ""); };
    i.addEventListener("input", pintar); pintar();
  });
}
/** Valor numérico de un campo (acepta puntos de miles y coma decimal). */
export function num(el) {
  const i = typeof el === "string" ? $(el) : el;
  if (!i) return 0;
  const v = String(i.value || "").trim();
  if (i.dataset.monto !== undefined) return Number(v.replace(/[^\d-]/g, "")) || 0;
  return Number(v.replace(",", ".")) || 0;
}
export function ponerMonto(el, n) { const i = typeof el === "string" ? $(el) : el; i.value = n === "" || n == null ? "" : String(Math.round(n)); i.dispatchEvent(new Event("input")); }

// ── Tablas ─────────────────────────────────────────────────────

const etiqueta = (c, extra) => (extra && extra[c]) || ETIQUETAS[c] || c.replace(/_/g, " ").replace(/^./, x => x.toUpperCase());

/**
 * Dibuja una tabla. Todo lo que viene en `filas`, `etiquetas` y `titulo` es
 * dato y se escapa con esc(); no acepta HTML. Las columnas numéricas se alinean a la derecha con
 * separador de miles; las fechas se muestran día-mes-año.
 * @param {HTMLElement} cont
 * @param {object[]} filas
 * @param {string[]} columnas
 * @param {{etiquetas?:object, numericas?:string[], claseFila?:(f)=>string, limite?:number,
 *          chips?:Object<string,(valor:any, fila:object)=>string>, titulo?:string}} [op]
 *   chips: por columna, devuelve el tono de la etiqueta ("ok", "alerta", "error" o "").
 */
export function mostrarTabla(cont, filas, columnas, op) {
  op = op || {};
  const numeric = new Set(op.numericas || columnas.filter(c => filas.some(f => typeof f[c] === "number")));
  const limite = op.limite || 500;
  let h = `<div class="tabla" tabindex="0" role="region" aria-label="${esc(op.titulo || "Tabla de resultados")}"><table><thead><tr>` + columnas.map(c => `<th${numeric.has(c) ? ' class="n"' : ""}>${esc(etiqueta(c, op.etiquetas))}</th>`).join("") + "</tr></thead><tbody>";
  for (const f of filas.slice(0, limite)) {
    const cls = op.claseFila ? op.claseFila(f) : "";
    h += `<tr${cls ? ` class="${cls}"` : ""}>` + columnas.map(c => {
      if (numeric.has(c) && typeof f[c] === "number") return `<td class="n">${fmt(f[c])}</td>`;
      if (op.chips && op.chips[c] && f[c] !== "" && f[c] != null) { const tono = op.chips[c](f[c], f); return `<td><span class="chip${tono ? " " + tono : ""}">${esc(f[c])}</span></td>`; }
      return `<td>${esc(fmtFecha(f[c]))}</td>`;
    }).join("") + "</tr>";
  }
  h += "</tbody></table></div>";
  if (filas.length > limite) h += `<p class="nota">Se muestran ${limite} de ${fmt(filas.length)} filas. La descarga incluye todas.</p>`;
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

/** Botones estándar de descarga (Excel y CSV). Si la descarga falla, lo dicen. */
export function botonesDescarga(cont, obtener, base) {
  cont.innerHTML = `<button class="btn" data-x>${icono("descarga")}Descargar Excel</button><button class="btn sec" data-c>Descargar CSV</button><span class="nota" data-e role="status"></span>`;
  const err = cont.querySelector("[data-e]");
  cont.querySelector("[data-x]").onclick = async ev => {
    const b = ev.currentTarget; b.disabled = true; err.textContent = "";
    try { const d = obtener(); await descargarExcel(d.hojas, base + ".xlsx"); }
    catch (e) { err.textContent = e.message + " Mientras tanto puede descargar el CSV."; }
    b.disabled = false;
  };
  cont.querySelector("[data-c]").onclick = () => { const d = obtener(); const h = d.hojas[0]; descargarCSV(h.filas, h.columnas, base + ".csv"); };
}

// ── Resultado: titular, cifras y avisos ────────────────────────

/**
 * La respuesta, en una frase. Es lo primero que se lee del resultado: el
 * número va en la oración, no suelto en una tabla.
 * `frase` y `detalle` aceptan HTML (<b>, <b class="mal">, enlaces) y NO se
 * escapan: quien llama debe pasar por esc() todo dato que venga de un archivo
 * (razones sociales, nombres de banco, nombres de archivo) antes de armarlos.
 */
export function titular(cont, frase, detalle) {
  cont.innerHTML = `<div class="titular"><p class="t-frase">${frase}</p>${detalle ? `<p class="t-det">${detalle}</p>` : ""}</div>`;
}

/**
 * Indicadores. Cada uno: [etiqueta, valor, tono?] con tono "ok" | "alerta" | "error".
 * `etiqueta` y `valor` aceptan HTML y NO se escapan: escape con esc() lo que
 * venga de un archivo. `tono` es del código, nunca un dato.
 */
export function cifras(cont, lista) {
  cont.innerHTML = lista.map(([e, v, tono]) => `<div class="cifra${tono ? " " + tono : ""}"><div class="v">${v}</div><div class="e">${e}</div></div>`).join("");
}

/** Línea de estado. `texto` se muestra como texto (textContent): no interpreta HTML. */
export function estado(el, texto, tipo) {
  el.className = tipo ? `aviso ${tipo}` : "estado";
  el.textContent = texto;
}

/** Aviso fijo de que lo que se ve son datos ficticios (sin parámetros de usuario). Regla del sitio: toda cifra de ejemplo va rotulada. */
export function rotuloEjemplo(cont, esEjemplo) {
  cont.innerHTML = esEjemplo ? `<p class="ejemplo"><b>Empresa de ejemplo</b> · cifras ficticias</p>` : "";
}

// ── Gráficos ───────────────────────────────────────────────────

let tip = null;
function mostrarTip(html, x, y) {
  if (!tip) {
    tip = document.createElement("div"); tip.className = "tip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip);
    document.addEventListener("keydown", ev => { if (ev.key === "Escape") ocultarTip(); });   // el globo se cierra con Escape
    window.addEventListener("scroll", () => { if (tip && !tip._teclado) ocultarTip(); }, { passive: true });   // al desplazar, el globo del puntero no se queda sobre el título
  }
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + "px";
  tip.style.top = (y - r.height - 10 < 8 ? y + 16 : y - r.height - 10) + "px";
}
const ocultarTip = () => { if (tip) tip.hidden = true; };

function pasosEje(min, max) {
  const rango = (max - min) || 1, bruto = rango / 5, pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map(m => m * pot).find(p => p >= bruto) || bruto;
  const t = [];
  for (let v = Math.ceil(min / paso) * paso; v <= max + paso * 0.001; v += paso) t.push(Math.round(v));
  return t;
}

/**
 * Columnas de una sola serie (p. ej. el saldo de cada semana). Las negativas
 * bajan del eje y cambian de color; la más baja lleva su valor escrito
 * (si es negativa, sobre la línea del cero, para no pisar el eje).
 * Cada columna responde al cursor y al teclado; la tabla de abajo es la vista
 * alternativa.
 * Se dibuja con un ancho proporcional al del contenedor (360 si mide menos de
 * 480 px, 720 si no), para que el texto no se encoja en el teléfono, y se
 * redibuja al cambiar el tamaño. Si las etiquetas del eje X no caben, muestra
 * una de cada dos (o una de cada tres...).
 * Escapados con esc(): `x`, `titulo` de cada punto y `op.titulo`. `op.pie`
 * acepta HTML y NO se escapa: quien llama escapa lo que venga de un archivo.
 * @param {HTMLElement} cont
 * @param {{x:string, valor:number, titulo:string}[]} puntos
 * @param {{titulo:string, destacar?:number, pie?:string}} op
 */
export function graficoColumnas(cont, puntos, op) {
  if (cont._ro) { cont._ro.disconnect(); cont._ro = null; }
  const angosto = () => { const w = cont.clientWidth; return w > 0 && w < 480; };
  let modo = null;
  const dibujar = () => { modo = angosto(); dibujarColumnas(cont, puntos, op, modo ? 360 : 720); };
  dibujar();
  if (typeof ResizeObserver === "function") {
    cont._ro = new ResizeObserver(() => { if (cont.clientWidth > 0 && angosto() !== modo) dibujar(); });
    cont._ro.observe(cont);
  }
}

function dibujarColumnas(cont, puntos, op, W) {
  const H = 250, L = 62, R = 10, T = 26, B = 30;
  const vals = puntos.map(p => p.valor);
  const ticks = pasosEje(Math.min(0, ...vals), Math.max(0, ...vals));
  const min = Math.min(0, ...vals, ...ticks), max = Math.max(0, ...vals, ...ticks);
  const y = v => T + (H - T - B) * (max - v) / ((max - min) || 1);
  const banda = (W - L - R) / puntos.length, ancho = Math.min(34, banda - 6), y0 = y(0);
  const largo = Math.max(1, ...puntos.map(p => String(p.x).length));
  const salto = Math.max(1, Math.ceil((largo * 6.8 + 6) / banda));   // 11 px de letra ≈ 6,8 px por carácter
  const columna = (p, i) => {
    const x = L + i * banda + (banda - ancho) / 2, y1 = y(p.valor), alto = Math.max(Math.abs(y1 - y0), 1.5), r = Math.min(4, alto, ancho / 2);
    const d = p.valor >= 0
      ? `M${x} ${y0}V${y1 + r}q0 ${-r} ${r} ${-r}h${ancho - 2 * r}q${r} 0 ${r} ${r}V${y0}z`
      : `M${x} ${y0}V${y0 + alto - r}q0 ${r} ${r} ${r}h${ancho - 2 * r}q${r} 0 ${r} ${-r}V${y0}z`;
    return `<path class="barra${p.valor < 0 ? " neg" : ""}${i === op.destacar ? " dest" : ""}" d="${d}"/>` +
      (i % salto === 0 ? `<text class="eje" x="${x + ancho / 2}" y="${H - 9}" text-anchor="middle">${esc(p.x)}</text>` : "") +
      `<rect class="toque" data-i="${i}" x="${L + i * banda}" y="${T}" width="${banda}" height="${H - T - B}" tabindex="0" role="img" aria-label="${esc(p.titulo)}: ${fmtCLP(p.valor)}"/>`;
  };
  let rotulo = "";
  if (op.destacar != null && puntos[op.destacar]) {
    const p = puntos[op.destacar], cx = L + op.destacar * banda + banda / 2, arriba = p.valor >= 0;
    const ancla = cx < L + 70 ? "start" : cx > W - R - 70 ? "end" : "middle";
    rotulo = `<text class="rotulo" x="${ancla === "start" ? cx - ancho / 2 : ancla === "end" ? cx + ancho / 2 : cx}" y="${arriba ? y(p.valor) - 8 : y0 - 8}" text-anchor="${ancla}">${fmtCorto(p.valor)}</text>`;
  }
  cont.innerHTML = `<figure class="grafico"><figcaption>${esc(op.titulo)}</figcaption><svg viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(op.titulo)}">` +
    ticks.map(t => `<line class="${t === 0 ? "base" : "grilla"}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="eje" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${fmtCorto(t)}</text>`).join("") +
    puntos.map(columna).join("") + rotulo + `</svg>${op.pie ? `<p class="nota">${op.pie}</p>` : ""}</figure>`;
  const svg = cont.querySelector("svg"), barras = [...svg.querySelectorAll(".barra")];
  svg.querySelectorAll(".toque").forEach(t => {
    const i = Number(t.dataset.i), p = puntos[i];
    const ver = () => { barras.forEach((b, k) => b.classList.toggle("activa", k === i)); const r = barras[i].getBoundingClientRect(); mostrarTip(`<b>${esc(p.titulo)}</b><span>${fmtCLP(p.valor)}</span>`, r.left + r.width / 2, r.top); };
    const fuera = () => { barras[i].classList.remove("activa"); ocultarTip(); };
    // El globo sale con movimiento real del puntero (no cuando la página se desplaza bajo un cursor quieto), con un toque o con el foco del teclado.
    t.addEventListener("pointerenter", ev => { if (ev.pointerType !== "mouse") ver(); });
    t.addEventListener("pointermove", ev => { if (ev.pointerType === "mouse" && (ev.movementX || ev.movementY)) { if (tip) tip._teclado = false; ver(); } });
    t.addEventListener("focus", () => { ver(); if (tip) tip._teclado = true; });
    t.addEventListener("pointerleave", fuera); t.addEventListener("blur", fuera);
  });
}

/**
 * Barras horizontales para comparar partidas (categorías de gasto, tramos de
 * deuda, clientes). El largo es proporcional al mayor; el valor va escrito.
 * Escapados con esc(): `titulo`, `etiqueta` y `nota` de cada partida.
 * `formato` devuelve HTML y NO se escapa (por defecto fmtCLP, que es seguro).
 * @param {HTMLElement} cont
 * @param {{etiqueta:string, valor:number, nota?:string, tono?:string}[]} items
 * @param {{titulo?:string, total?:number, formato?:(n:number)=>string}} [op]
 */
export function barrasH(cont, items, op) {
  op = op || {};
  const mayor = Math.max(...items.map(i => Math.abs(i.valor)), 1), f = op.formato || fmtCLP;
  cont.innerHTML = `<figure class="barras">${op.titulo ? `<figcaption>${esc(op.titulo)}</figcaption>` : ""}<ul>` + items.map(i =>
    `<li><span class="b-et">${esc(i.etiqueta)}</span><span class="b-pista"><span class="b-barra${i.tono ? " " + i.tono : ""}" style="width:${(Math.abs(i.valor) / mayor * 100).toFixed(1)}%"></span></span><span class="b-val">${f(i.valor)}${op.total ? `<small>${fmtPct(i.valor / op.total * 100)}</small>` : i.nota ? `<small>${esc(i.nota)}</small>` : ""}</span></li>`).join("") + "</ul></figure>";
}

// ── Siga con… ──────────────────────────────────────────────────

/**
 * Tarjetas hacia las herramientas que siguen. Como los documentos quedan en
 * la sesión, la siguiente abre con el resultado ya calculado.
 * `ids` son del catálogo; `titulo` acepta HTML y NO se escapa (lo escribe el código).
 */
export function siguientes(cont, ids, titulo) {
  const d = datos();
  const hs = ids.map(herramienta).filter(Boolean);
  cont.innerHTML = `<section class="siguientes"><h2>${titulo || "Siga con sus mismos documentos"}</h2><p class="nota">${d.vacia ? "Lo que suba en una herramienta queda disponible en las demás mientras esta pestaña esté abierta." : "No tiene que subirlos de nuevo: ya están cargados en esta pestaña."}</p><div class="tarjetas">${hs.map(h => tarjeta(h, h.grupo === "pregunta" ? "pregunta" : "nombre")).join("")}</div></section>`;
}

// ── Invitación ─────────────────────────────────────────────────

export const TEXTO_PROGRAMA = "Lo que acaba de ver es una foto de hoy, armada a mano. En AVE construimos con usted el ecosistema que la mantiene al día: la información llega sola y cuadrada, los cálculos se hacen con fórmulas en tablas —exactos y sin costo— y la IA se usa únicamente donde hay que interpretar. Y su equipo aprende a hacerlo: al cabo de un año construye sus propias mejoras.";

const GRADIENTE = [["Meses 1 y 2", "Levantamos y ordenamos su información"], ["Meses 3 a 5", "Construimos junto a su equipo"], ["Meses 6 a 8", "Su equipo construye; nosotros revisamos"], ["Meses 9 a 12", "Su equipo, por su cuenta"]];

/**
 * Muestra la invitación junto al resultado (nunca antes).
 * @param {HTMLElement} cont
 * @param {string} pregunta  la frase de entrada, propia de cada herramienta; acepta HTML y NO se escapa (la escribe el código, no un archivo)
 */
export function invitacion(cont, pregunta) {
  cont.innerHTML = `<aside class="invitacion" aria-label="Programa AVE">
    <h2>${pregunta}</h2>
    <p>${TEXTO_PROGRAMA}</p>
    <ol class="gradiente">${GRADIENTE.map(([m, t]) => `<li><b>${m}</b><span>${t}</span></li>`).join("")}</ol>
    <div class="inv-cta"><a class="btn claro" data-agenda href="mailto:${CORREO}?subject=Diagn%C3%B3stico%20AVE">Agendar un diagnóstico${icono("flecha")}</a>
    <small>El diagnóstico cuesta $30.000 y se paga al final, una vez entregado. No lo compromete a seguir.</small></div>
  </aside>`;
  conectarAgenda(cont);
}

export function conectarAgenda(raiz) {
  (raiz || document).querySelectorAll("[data-agenda]").forEach(a => {
    if (AGENDA_URL && AGENDA_URL.startsWith("http")) { a.href = AGENDA_URL; a.target = "_blank"; a.rel = "noopener"; }
    if (!a.dataset.conectado) { a.dataset.conectado = "1"; a.addEventListener("click", () => registrar("invitacion", { pagina: location.pathname })); }
  });
}

// ── Página ─────────────────────────────────────────────────────

/** Indicador de la barra: cuántos archivos hay cargados en esta pestaña (o, si no quedaron guardados, que solo valen para esta página). */
export function pintarSesion() {
  const el = $("#mis-docs");
  if (!el) return;
  const d = datos();
  el.hidden = d.vacia;
  if (d.vacia) return;
  const guardada = sesionGuardada();
  el.classList.toggle("ej", d.ejemplo || !guardada);
  const texto = !guardada ? "Solo en esta página" : d.ejemplo ? "Empresa de ejemplo" : plural(d.archivos.length, "archivo cargado", "archivos cargados");
  // En teléfono la barra solo tiene un ícono; con la empresa de ejemplo se agrega la palabra «Ejemplo».
  el.classList.toggle("es-ejemplo", d.ejemplo && guardada);
  el.innerHTML = `${icono("check")}<span>${texto}</span><span class="corto" aria-hidden="true">Ejemplo</span>`;
  el.setAttribute("aria-label", texto + ". Ver el panorama.");
  el.title = guardada ? "Sus documentos están cargados en esta pestaña. Ver el panorama." : "Son demasiados para guardarlos entre páginas: solo esta página los ve.";
}

/** La llama cada página al cargar (la inserta scripts/build-herramientas.mjs). */
export function iniciarPagina() {
  conectarAgenda(document);
  activarMontos(document);
  pintarSesion();
  document.addEventListener("ave:sesion", pintarSesion);
  // Si el navegador devuelve la página desde su caché (botón Atrás), trae una copia vieja de lo que había en pantalla: se recarga.
  window.addEventListener("pageshow", e => { if (e.persisted) location.reload(); });
}
