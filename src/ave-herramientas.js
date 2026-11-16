/**
 * ave-herramientas.js — Biblioteca pública de AVE para ordenar documentos
 * tributarios y bancarios chilenos.
 *
 * Funciones puras: no tocan la página, no hacen llamadas de red y funcionan
 * igual en el navegador y en Node (>= 18). Toda la lectura es determinista:
 * mismas entradas, mismas salidas, sin IA y sin costo.
 *
 *   import { leerDTE, leerFacturaTexto, leerCartola, validarRut,
 *            depurarRuts, aCSV } from "https://miavejecutivo.com/herramientas/lib/ave-herramientas.js";
 *
 * Origen: los lectores de cartolas y del Registro de Compras y Ventas
 * (apps-script/src/ImportadorFinanciero.js), trasladados al navegador.
 * Si se corrige algo acá, conviene revisar si aplica también allá.
 *
 * Licencia MIT © 2026 AVE (miavejecutivo.com). Código abierto en
 * https://github.com/AVEjecutivo/herramientas-pyme (src/ave-herramientas.js):
 * este archivo y ese deben ser idénticos. Si se cambia uno, se copia al otro.
 */

export const VERSION = "1.0.0";

// ─────────────────────────────────────────────────────────────
//  Utilidades generales
// ─────────────────────────────────────────────────────────────

/** Tipos de documento tributario electrónico (DTE) más comunes del SII. */
export const TIPOS_DTE = {
  "33": "Factura electrónica",
  "34": "Factura no afecta o exenta electrónica",
  "39": "Boleta electrónica",
  "41": "Boleta exenta electrónica",
  "43": "Liquidación factura electrónica",
  "46": "Factura de compra electrónica",
  "52": "Guía de despacho electrónica",
  "56": "Nota de débito electrónica",
  "61": "Nota de crédito electrónica",
  "110": "Factura de exportación electrónica",
  "111": "Nota de débito de exportación electrónica",
  "112": "Nota de crédito de exportación electrónica"
};

/** Columnas de la tabla de facturas, en el orden en que se exportan. */
export const COLUMNAS_FACTURA = [
  "archivo", "tipo_dte", "tipo_documento", "folio", "fecha_emision",
  "rut_emisor", "razon_social_emisor", "rut_receptor", "razon_social_receptor",
  "monto_neto", "monto_exento", "iva", "monto_total",
  "origen", "confianza", "observaciones"
];

/** Columnas de la tabla de movimientos bancarios. */
export const COLUMNAS_CARTOLA = [
  "fecha", "descripcion", "referencia", "cargo", "abono", "saldo", "banco"
];

function sinTildes(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normalizarEncabezado(h) {
  return sinTildes(h).trim().replace(/"/g, "").toLowerCase()
    .replace(/[$#°()]/g, "").replace(/\s+/g, "_").replace(/\./g, "");
}

function aISO(anio, mes, dia) {
  const a = Number(anio), m = Number(mes), d = Number(dia);
  if (!a || !m || !d || m > 12 || d > 31) return "";
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Fecha a formato ISO (aaaa-mm-dd). Acepta dd/mm/aaaa, dd-mm-aaaa,
 * dd.mm.aaaa, aaaa-mm-dd y "12 de junio de 2026". Devuelve "" si no la reconoce.
 */
export function leerFecha(s) {
  const t = sinTildes(String(s == null ? "" : s)).trim().toLowerCase();
  if (!t) return "";
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return aISO(m[3], m[2], m[1]);
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
  if (m) return aISO(2000 + Number(m[3]), m[2], m[1]);
  m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return aISO(m[1], m[2], m[3]);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  m = t.match(/(\d{1,2})\s+de\s+([a-z]+)\s+(?:de|del)\s+(\d{4})/);
  if (m) {
    const mes = MESES.findIndex(x => x.startsWith(m[2].slice(0, 3))) + 1;
    if (mes) return aISO(m[3], mes, m[1]);
  }
  return "";
}

/**
 * Monto en pesos a número entero. Entiende "1.234.567", "$ 1.234.567",
 * "1234567", "1.234,50" y "-15.000". Devuelve 0 si está vacío.
 */
export function leerMonto(s) {
  if (typeof s === "number") return Math.round(s);
  let t = String(s == null ? "" : s).replace(/[$\s]/g, "").replace(/[a-zA-Z]/g, "");
  if (!t) return 0;
  const negativo = /^-|^\(.*\)$|-$/.test(t);
  t = t.replace(/[()\-+]/g, "");
  if (t.includes(",") && t.includes(".")) {
    t = t.lastIndexOf(",") > t.lastIndexOf(".")
      ? t.replace(/\./g, "").replace(",", ".")
      : t.replace(/,/g, "");
  } else if (t.includes(".")) {
    const partes = t.split(".");
    if (partes.length > 2 || partes[partes.length - 1].length === 3) t = t.replace(/\./g, "");
  } else if (t.includes(",")) {
    const partes = t.split(",");
    t = (partes.length > 2 || partes[partes.length - 1].length === 3)
      ? t.replace(/,/g, "") : t.replace(",", ".");
  }
  const n = parseFloat(t);
  if (isNaN(n)) return 0;
  return Math.round(negativo ? -n : n);
}

/** Detecta el separador de un CSV (punto y coma, coma o tabulación). */
export function detectarSeparador(texto) {
  const linea = String(texto).split(/\r?\n/).find(l => l.trim().length > 10) || "";
  const cuenta = c => linea.split(c).length - 1;
  let sep = ";";
  if (cuenta(",") > cuenta(sep)) sep = ",";
  if (cuenta("\t") > cuenta(sep)) sep = "\t";
  return sep;
}

/** Divide una línea de CSV respetando comillas ("Pérez, Juan" queda junto). */
export function dividirLineaCSV(linea, sep) {
  const cols = [];
  let actual = "", entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') { actual += '"'; i++; }
      else entreComillas = !entreComillas;
    } else if (c === sep && !entreComillas) {
      cols.push(actual.trim()); actual = "";
    } else {
      actual += c;
    }
  }
  cols.push(actual.trim());
  return cols;
}

function buscarColumna(encabezados, opciones, excluir) {
  for (const o of opciones) {
    const i = encabezados.findIndex(h => h.includes(o) && !(excluir || []).some(x => h.includes(x)));
    if (i !== -1) return i;
  }
  return -1;
}

// ─────────────────────────────────────────────────────────────
//  RUT
// ─────────────────────────────────────────────────────────────

/** Calcula el dígito verificador de un RUT (módulo 11). */
export function calcularDV(cuerpo) {
  let suma = 0, factor = 2;
  const digitos = String(cuerpo).replace(/\D/g, "");
  for (let i = digitos.length - 1; i >= 0; i--) {
    suma += Number(digitos[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

/**
 * Valida y da formato a un RUT chileno.
 * @returns {{entrada:string, rut:string, cuerpo:string, dv:string, valido:boolean, motivo:string}}
 *   rut viene con puntos y guion ("76.123.456-0"); motivo explica el rechazo.
 */
export function validarRut(entrada) {
  const original = String(entrada == null ? "" : entrada).trim();
  const limpio = original.toUpperCase().replace(/[^0-9K]/g, "");
  const base = { entrada: original, rut: "", cuerpo: "", dv: "", valido: false, motivo: "" };
  if (!limpio) return { ...base, motivo: "Vacío" };
  if (limpio.length < 2) return { ...base, motivo: "Muy corto" };
  const cuerpo = limpio.slice(0, -1).replace(/^0+/, "");
  const dv = limpio.slice(-1);
  if (!/^\d+$/.test(cuerpo)) return { ...base, motivo: "Formato no reconocido" };
  if (cuerpo.length < 6 || cuerpo.length > 8) return { ...base, cuerpo, dv, motivo: "Largo fuera de rango" };
  const rut = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv;
  const esperado = calcularDV(cuerpo);
  if (esperado !== dv) return { ...base, rut, cuerpo, dv, motivo: `Dígito verificador incorrecto (debería ser ${esperado})` };
  return { ...base, rut, cuerpo, dv, valido: true };
}

/**
 * Revisa una lista de RUT: formato, dígito verificador y duplicados.
 * @param {string[]} lista
 * @returns {Array<{fila:number, entrada:string, rut:string, valido:boolean, motivo:string, duplicado_de:number|""}>}
 */
export function depurarRuts(lista) {
  const vistos = new Map();
  return lista.map((entrada, i) => {
    const r = validarRut(entrada);
    let duplicado_de = "";
    if (r.cuerpo) {
      if (vistos.has(r.cuerpo)) duplicado_de = vistos.get(r.cuerpo);
      else vistos.set(r.cuerpo, i + 1);
    }
    return { fila: i + 1, entrada: r.entrada, rut: r.rut, valido: r.valido, motivo: r.motivo, duplicado_de };
  });
}

function primerRutValido(texto) {
  const re = /(\d{1,2}[.\s]?\d{3}[.\s]?\d{3}\s*-\s*[\dkK])/g;
  let m;
  while ((m = re.exec(texto))) {
    const r = validarRut(m[1]);
    if (r.valido) return { rut: r.rut, posicion: m.index };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
//  Facturas: XML del DTE (lectura exacta)
// ─────────────────────────────────────────────────────────────

function decodificarEntidades(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
}

function etiqueta(xml, nombre) {
  const re = new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`);
  const m = xml.match(re);
  return m ? decodificarEntidades(m[1]) : "";
}

function bloques(xml, nombre) {
  const re = new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>[\\s\\S]*?</(?:[\\w-]+:)?${nombre}>`, "g");
  return xml.match(re) || [];
}

function filaVacia(archivo) {
  const f = {};
  for (const c of COLUMNAS_FACTURA) f[c] = "";
  f.archivo = archivo || "";
  return f;
}

function revisarCuadre(f, obs) {
  const neto = Number(f.monto_neto) || 0, exento = Number(f.monto_exento) || 0;
  const iva = Number(f.iva) || 0, total = Number(f.monto_total) || 0;
  if (total && Math.abs(neto + exento + iva - total) > 2) {
    obs.push("Neto + exento + IVA no suma el total (puede haber impuestos adicionales)");
    return false;
  }
  if (neto && iva && Math.abs(Math.round(neto * 0.19) - iva) > 2) {
    obs.push("El IVA no es el 19% del neto");
    return false;
  }
  return true;
}

/**
 * Lee un XML de DTE del SII (un documento suelto o un EnvioDTE con varios).
 * Es la vía exacta: si el usuario tiene el XML, no hace falta nada más.
 * @param {string} xml   contenido del archivo
 * @param {string} [archivo] nombre del archivo, para la columna "archivo"
 * @returns {object[]} una fila por documento, con las columnas de COLUMNAS_FACTURA
 */
export function leerDTE(xml, archivo) {
  const texto = String(xml || "");
  let docs = bloques(texto, "Documento");
  if (!docs.length) docs = bloques(texto, "Exportaciones");
  if (!docs.length) docs = bloques(texto, "Liquidacion");
  if (!docs.length && /<(?:[\w-]+:)?Encabezado/.test(texto)) docs = [texto];
  return docs.map(doc => {
    const f = filaVacia(archivo);
    const obs = [];
    const enc = bloques(doc, "Encabezado")[0] || doc;
    const idDoc = bloques(enc, "IdDoc")[0] || enc;
    const emisor = bloques(enc, "Emisor")[0] || "";
    const receptor = bloques(enc, "Receptor")[0] || "";
    const totales = bloques(enc, "Totales")[0] || "";
    f.tipo_dte = etiqueta(idDoc, "TipoDTE");
    f.tipo_documento = TIPOS_DTE[f.tipo_dte] || (f.tipo_dte ? `Otro (${f.tipo_dte})` : "");
    f.folio = etiqueta(idDoc, "Folio");
    f.fecha_emision = leerFecha(etiqueta(idDoc, "FchEmis"));
    f.rut_emisor = validarRut(etiqueta(emisor, "RUTEmisor")).rut || etiqueta(emisor, "RUTEmisor");
    f.razon_social_emisor = etiqueta(emisor, "RznSoc") || etiqueta(emisor, "RznSocEmisor");
    f.rut_receptor = validarRut(etiqueta(receptor, "RUTRecep")).rut || etiqueta(receptor, "RUTRecep");
    f.razon_social_receptor = etiqueta(receptor, "RznSocRecep");
    f.monto_neto = leerMonto(etiqueta(totales, "MntNeto"));
    f.monto_exento = leerMonto(etiqueta(totales, "MntExe"));
    f.iva = leerMonto(etiqueta(totales, "IVA"));
    f.monto_total = leerMonto(etiqueta(totales, "MntTotal"));
    f.origen = "xml";
    const faltan = ["tipo_dte", "folio", "rut_emisor", "monto_total"].filter(c => f[c] === "" || f[c] === 0);
    if (faltan.length) obs.push("Faltan datos en el XML: " + faltan.join(", "));
    revisarCuadre(f, obs);
    f.confianza = faltan.length ? "media" : "alta";
    f.observaciones = obs.join(" · ");
    return f;
  });
}

// ─────────────────────────────────────────────────────────────
//  Facturas: texto de un PDF o de una imagen
// ─────────────────────────────────────────────────────────────

function montoTrasEtiqueta(texto, patrones) {
  for (const p of patrones) {
    const re = new RegExp(p + String.raw`[^\d\n$-]{0,40}\$?\s*(-?[\d.,]{1,15}\d)`, "i");
    const m = texto.match(re);
    if (m) return leerMonto(m[1]);
  }
  return 0;
}

/**
 * Lee una factura a partir de su texto (el que entrega un PDF con texto o un
 * reconocimiento de caracteres sobre una imagen). Usa las reglas del formato
 * de representación impresa del SII: recuadro con RUT, tipo y número; luego
 * "Señor(es)", fecha y totales.
 *
 * No es exacta como el XML: devuelve "confianza" y "observaciones" para que
 * una persona revise lo que no cuadró.
 * @param {string} texto
 * @param {string} [archivo]
 * @param {"pdf"|"ocr"} [origen]
 * @returns {object} una fila con las columnas de COLUMNAS_FACTURA
 */
export function leerFacturaTexto(texto, archivo, origen) {
  const t = String(texto || "").replace(/ /g, " ");
  const plano = sinTildes(t);
  const f = filaVacia(archivo);
  const obs = [];
  f.origen = origen || "pdf";

  // Tipo de documento
  const tipos = [
    [/nota\s+de\s+credito/i, "61"], [/nota\s+de\s+debito/i, "56"],
    [/guia\s+de\s+despacho/i, "52"], [/factura\s+de\s+compra/i, "46"],
    [/factura\s+(no\s+afecta|exenta)/i, "34"], [/factura\s+de\s+exportacion/i, "110"],
    [/boleta\s+exenta/i, "41"], [/boleta/i, "39"], [/factura/i, "33"]
  ];
  for (const [re, cod] of tipos) if (re.test(plano)) { f.tipo_dte = cod; break; }
  f.tipo_documento = TIPOS_DTE[f.tipo_dte] || "";

  // Folio: "Nº 1234", "N° 1234", "No 1234", "Folio 1234"
  // El OCR suele leer "Nº" como "N*", "N°", "No" o "N.".
  const folio = plano.match(/(?:\bN\s*[º°o*.:ª]+|\bNro\.?|\bfolio)\s*:?\s*(\d{1,10})\b/i);
  if (folio) f.folio = folio[1];

  // Emisor: el primer RUT válido. Receptor: el primero después de "Señor(es)" o "Cliente".
  const emisor = primerRutValido(t);
  if (emisor) f.rut_emisor = emisor.rut;
  const iSenor = plano.search(/se(n|ñ)or(\(?es\)?)?|cliente|receptor|razon\s+social\s*:/i);
  if (iSenor !== -1) {
    const receptor = primerRutValido(t.slice(iSenor));
    if (receptor && receptor.rut !== f.rut_emisor) f.rut_receptor = receptor.rut;
  }
  if (!f.rut_receptor && emisor) {
    const otro = primerRutValido(t.slice(emisor.posicion + 8));
    if (otro && otro.rut !== f.rut_emisor) f.rut_receptor = otro.rut;
  }

  // Razón social del receptor: lo que sigue a "Señor(es):" en la misma línea
  const rs = t.match(/se[nñ]or(?:\(?es\)?)?\s*:?\s*([^\n]{3,80})/i);
  if (rs) f.razon_social_receptor = rs[1].replace(/R\.?U\.?T\.?.*$/i, "").trim();
  // Razón social del emisor: primera línea con forma de empresa
  const lineas = t.split(/\n/).map(l => l.trim()).filter(Boolean);
  const empresa = lineas.find(l => /\b(SpA|S\.?A\.?|Ltda\.?|Limitada|EIRL|E\.I\.R\.L\.)\b/i.test(l) && l !== f.razon_social_receptor && !/se[nñ]or/i.test(l));
  if (empresa) f.razon_social_emisor = empresa.replace(/R\.?U\.?T\.?.*$/i, "").trim();

  // Fecha
  const fe = plano.match(/fecha(?:\s+de)?(?:\s+emision)?\s*:?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|[0-9]{1,2}\s+de\s+[a-z]+\s+(?:de|del)\s+[0-9]{4})/i)
    || plano.match(/\b([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{4})\b/);
  if (fe) f.fecha_emision = leerFecha(fe[1]);

  // Totales
  f.monto_neto = montoTrasEtiqueta(plano, [String.raw`monto\s+neto`, String.raw`\bneto\b`, String.raw`sub\s*total`, String.raw`afecto`]);
  f.monto_exento = montoTrasEtiqueta(plano, [String.raw`monto\s+exento`, String.raw`\bexento\b`]);
  // "I.V.A.", "IVA" o, en OCR, "LV.A." / "1.V.A."
  f.iva = montoTrasEtiqueta(plano, [String.raw`\b[il1|]\.?\s*v\.?\s*a\b\.?\s*(?:\(?19\s*%\)?)?`]);
  f.monto_total = montoTrasEtiqueta(plano, [String.raw`monto\s+total`, String.raw`total\s+a\s+pagar`, String.raw`\btotal\b`]);
  if (!f.monto_neto && f.monto_total && f.iva) f.monto_neto = f.monto_total - f.iva - f.monto_exento;

  const claves = ["tipo_dte", "folio", "fecha_emision", "rut_emisor", "monto_total"];
  const faltan = claves.filter(c => f[c] === "" || f[c] === 0);
  if (faltan.length) obs.push("No se encontró: " + faltan.join(", "));
  const cuadra = revisarCuadre(f, obs);
  f.confianza = !faltan.length && cuadra ? "alta" : faltan.length <= 2 ? "media" : "baja";
  if (f.confianza !== "alta") obs.push("Revisar manualmente");
  f.observaciones = obs.join(" · ");
  return f;
}

/** true si el texto tiene muy poco contenido útil (PDF escaneado o imagen). */
export function textoInsuficiente(texto) {
  const t = String(texto || "").replace(/\s+/g, "");
  return t.length < 60 || !/\d{3}/.test(t);
}

// ─────────────────────────────────────────────────────────────
//  Registro de Compras y Ventas del SII (CSV)
// ─────────────────────────────────────────────────────────────

/**
 * Lee el CSV del Registro de Compras o de Ventas que se descarga desde el SII
 * y lo deja con las mismas columnas que la tabla de facturas.
 * @param {string} texto
 * @param {"compras"|"ventas"} [libro]  si no se indica, se deduce de los encabezados
 * @param {string} [archivo]
 */
export function leerRegistroSII(texto, libro, archivo) {
  const sep = detectarSeparador(texto);
  const lineas = String(texto).split(/\r?\n/).filter(l => l.trim());
  if (lineas.length < 2) return [];
  const enc = dividirLineaCSV(lineas[0], sep).map(normalizarEncabezado);
  const esCompras = libro ? libro === "compras" : enc.some(h => h.includes("emisor") || h.includes("proveedor"));
  const idx = {
    tipo: buscarColumna(enc, ["tipo_doc"]),
    folio: buscarColumna(enc, ["folio"]),
    fecha: buscarColumna(enc, ["fecha_docto", "fecha"]),
    rut: esCompras ? buscarColumna(enc, ["rut_emisor", "rut_proveedor", "rut"]) : buscarColumna(enc, ["rut_receptor", "rut_cliente", "rut"]),
    razon: buscarColumna(enc, ["razon_social"]),
    exento: buscarColumna(enc, ["monto_exento"]),
    neto: buscarColumna(enc, ["monto_neto"]),
    iva: buscarColumna(enc, ["iva_recuperable", "monto_iva", "iva"], ["no_recuperable", "uso_comun"]),
    total: buscarColumna(enc, ["monto_total"])
  };
  if (idx.folio === -1 || idx.total === -1) return [];
  const val = (cols, i) => (i === -1 ? "" : cols[i] || "");
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const cols = dividirLineaCSV(lineas[i], sep);
    if (cols.length < 5 || !val(cols, idx.folio)) continue;
    const f = filaVacia(archivo);
    f.tipo_dte = val(cols, idx.tipo);
    f.tipo_documento = TIPOS_DTE[f.tipo_dte] || (f.tipo_dte ? `Otro (${f.tipo_dte})` : "");
    f.folio = val(cols, idx.folio);
    f.fecha_emision = leerFecha(val(cols, idx.fecha));
    const rut = validarRut(val(cols, idx.rut)).rut || val(cols, idx.rut);
    const razon = val(cols, idx.razon);
    if (esCompras) { f.rut_emisor = rut; f.razon_social_emisor = razon; }
    else { f.rut_receptor = rut; f.razon_social_receptor = razon; }
    f.monto_neto = leerMonto(val(cols, idx.neto));
    f.monto_exento = leerMonto(val(cols, idx.exento));
    f.iva = leerMonto(val(cols, idx.iva));
    f.monto_total = leerMonto(val(cols, idx.total));
    f.origen = esCompras ? "registro_compras" : "registro_ventas";
    f.confianza = "alta";
    filas.push(f);
  }
  return filas;
}

// ─────────────────────────────────────────────────────────────
//  Cartolas bancarias
// ─────────────────────────────────────────────────────────────

const BANCOS = [
  ["bci", "BCI"], ["santander", "Santander"], ["bancoestado", "BancoEstado"],
  ["banco estado", "BancoEstado"], ["chile", "Banco de Chile"], ["itau", "Itaú"],
  ["scotiabank", "Scotiabank"], ["security", "Security"], ["bice", "BICE"],
  ["falabella", "Falabella"], ["ripley", "Ripley"], ["consorcio", "Consorcio"],
  ["internacional", "Internacional"]
];

function detectarBanco(texto, nombreArchivo) {
  const fuente = sinTildes(String(nombreArchivo || "") + " " + String(texto).slice(0, 400)).toLowerCase();
  for (const [clave, nombre] of BANCOS) if (fuente.includes(clave)) return nombre;
  return "";
}

/**
 * Lee la cartola de cualquier banco exportada como CSV (o una hoja de Excel
 * convertida a CSV) y la deja en una tabla estándar.
 * Busca la fila de encabezados (la que dice "Fecha" y "Cargo"/"Abono"/"Monto"),
 * ignora títulos, totales y saldos iniciales.
 * @param {string} texto
 * @param {string} [nombreArchivo]  ayuda a reconocer el banco
 * @returns {{movimientos: object[], banco: string, error?: string}}
 */
export function leerCartola(texto, nombreArchivo) {
  const t = String(texto || "");
  const banco = detectarBanco(t, nombreArchivo);
  const sep = detectarSeparador(t);
  const lineas = t.split(/\r?\n/);
  let iEnc = -1;
  for (let i = 0; i < Math.min(lineas.length, 40); i++) {
    const l = sinTildes(lineas[i]).toLowerCase();
    if (l.includes("fecha") && /cargo|abono|debito|credito|monto|debe|haber|giro|deposito/.test(l)) { iEnc = i; break; }
  }
  if (iEnc === -1) return { movimientos: [], banco, error: "No se encontró la fila de encabezados (Fecha y Cargo/Abono)." };
  const enc = dividirLineaCSV(lineas[iEnc], sep).map(normalizarEncabezado);
  const idx = {
    fecha: buscarColumna(enc, ["fecha_contable", "fecha_operacion", "fecha", "date"], ["valuta"]),
    desc: buscarColumna(enc, ["descripcion", "detalle", "glosa", "concepto", "movimiento"]),
    ref: buscarColumna(enc, ["referencia", "documento", "nro_documento", "n_documento", "comprobante", "cheque", "operacion"], ["fecha"]),
    cargo: buscarColumna(enc, ["cargo", "debito", "debe", "giro"]),
    abono: buscarColumna(enc, ["abono", "credito", "haber", "deposito"]),
    monto: buscarColumna(enc, ["monto", "importe"]),
    saldo: buscarColumna(enc, ["saldo"])
  };
  if (idx.fecha === -1) return { movimientos: [], banco, error: "No se encontró la columna Fecha." };
  if (idx.cargo === -1 && idx.abono === -1 && idx.monto === -1) {
    return { movimientos: [], banco, error: "No se encontraron columnas de Cargo, Abono o Monto." };
  }
  const val = (cols, i) => (i === -1 || i >= cols.length ? "" : cols[i]);
  const movimientos = [];
  for (let j = iEnc + 1; j < lineas.length; j++) {
    if (!lineas[j].trim()) continue;
    const cols = dividirLineaCSV(lineas[j], sep);
    const fecha = leerFecha(val(cols, idx.fecha));
    if (!fecha) continue;
    const descripcion = val(cols, idx.desc);
    if (/^(total|saldo\s*(anterior|inicial|final))/i.test(sinTildes(descripcion))) continue;
    let cargo = Math.abs(leerMonto(val(cols, idx.cargo)));
    let abono = Math.abs(leerMonto(val(cols, idx.abono)));
    if (idx.cargo === -1 && idx.abono === -1) {
      const m = leerMonto(val(cols, idx.monto));
      if (m < 0) cargo = -m; else abono = m;
    }
    if (!cargo && !abono) continue;
    const saldoTxt = val(cols, idx.saldo);
    movimientos.push({
      fecha, descripcion, referencia: val(cols, idx.ref),
      cargo, abono, saldo: saldoTxt === "" ? "" : leerMonto(saldoTxt), banco
    });
  }
  return { movimientos, banco };
}

// ─────────────────────────────────────────────────────────────
//  Exportar
// ─────────────────────────────────────────────────────────────

/**
 * Convierte filas en CSV. Por defecto usa punto y coma, que es lo que Excel
 * en español espera, e incluye la marca BOM para que respete las tildes.
 * @param {object[]} filas
 * @param {string[]} [columnas]  orden de columnas; por defecto, las de la primera fila
 * @param {{separador?:string, bom?:boolean}} [opciones]
 */
export function aCSV(filas, columnas, opciones) {
  const sep = (opciones && opciones.separador) || ";";
  const bom = !opciones || opciones.bom !== false;
  const cols = columnas || (filas[0] ? Object.keys(filas[0]) : []);
  const celda = v => {
    const s = v == null ? "" : String(v);
    return /[";\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cuerpo = [cols.join(sep)].concat(filas.map(f => cols.map(c => celda(f[c])).join(sep))).join("\r\n");
  return (bom ? "﻿" : "") + cuerpo;
}

/** Encabezados legibles para Excel y Google Sheets (los asistentes de IA los entienden mejor). */
export const ETIQUETAS = {
  archivo: "Archivo", tipo_dte: "Código DTE", tipo_documento: "Tipo de documento", folio: "Folio",
  fecha_emision: "Fecha de emisión", rut_emisor: "RUT emisor", razon_social_emisor: "Razón social emisor",
  rut_receptor: "RUT receptor", razon_social_receptor: "Razón social receptor",
  monto_neto: "Monto neto", monto_exento: "Monto exento", iva: "IVA", monto_total: "Monto total",
  origen: "Origen del dato", confianza: "Confianza", observaciones: "Observaciones",
  fecha: "Fecha", descripcion: "Descripción", referencia: "Referencia", cargo: "Cargo", abono: "Abono",
  saldo: "Saldo", banco: "Banco", categoria: "Categoría", regla: "Regla aplicada"
};

// ─────────────────────────────────────────────────────────────
//  Fechas auxiliares
// ─────────────────────────────────────────────────────────────

function aDia(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  return Date.UTC(a, m - 1, d) / 86400000;
}
function desdeDia(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
/** Días entre dos fechas ISO (b - a). */
export function diasEntre(a, b) {
  return aDia(b) - aDia(a);
}
/** Suma días a una fecha ISO. */
export function sumarDias(iso, dias) {
  return desdeDia(aDia(iso) + dias);
}

function palabras(s) {
  return sinTildes(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter(p => p.length > 3 && !["transferencia", "pago", "abono", "cargo", "factura", "sociedad", "limitada", "ltda", "spa", "comercial", "servicios", "empresa", "desde", "para"].includes(p));
}

// ─────────────────────────────────────────────────────────────
//  H3 · Cuadratura banco contra facturas
// ─────────────────────────────────────────────────────────────

/**
 * Cruza movimientos bancarios con facturas. Un abono se busca entre las
 * facturas de venta; un cargo, entre las de compra. Se exige el mismo monto
 * total y que el movimiento sea posterior a la emisión (hasta `ventanaDias`).
 * Si hay varias candidatas, gana la que tiene el folio o el nombre del
 * cliente/proveedor en la glosa; si sigue habiendo empate, queda sin cruzar
 * para que lo decida una persona.
 *
 * @param {object[]} movimientos  salida de leerCartola
 * @param {object[]} facturas     cada una con `libro`: "ventas" | "compras"
 * @param {{ventanaDias?:number}} [opciones]
 * @returns {{facturas: object[], movimientos: object[], resumen: object}}
 */
export function conciliar(movimientos, facturas, opciones) {
  const ventana = (opciones && opciones.ventanaDias) || 180;
  const facts = facturas.map((f, i) => ({ ...f, _i: i, estado_pago: "Pendiente", fecha_pago: "", movimiento: "", dias_a_pago: "" }));
  const movs = movimientos.map((m, i) => ({ ...m, _i: i, factura: "", cruce: "" }));
  const usadas = new Set();
  const puntaje = (m, f) => {
    let p = 0;
    const glosa = sinTildes(m.descripcion + " " + m.referencia).toLowerCase();
    if (f.folio && new RegExp(`\\b${f.folio}\\b`).test(glosa)) p += 2;
    const nombre = f.libro === "ventas" ? f.razon_social_receptor : f.razon_social_emisor;
    if (palabras(nombre).some(w => glosa.includes(w))) p += 1;
    return p;
  };
  for (const m of movs) {
    const libro = m.abono ? "ventas" : "compras";
    const monto = m.abono || m.cargo;
    const candidatas = facts.filter(f => !usadas.has(f._i) && f.libro === libro &&
      Math.abs(Number(f.monto_total) - monto) <= 1 &&
      (!f.fecha_emision || (diasEntre(f.fecha_emision, m.fecha) >= 0 && diasEntre(f.fecha_emision, m.fecha) <= ventana)));
    if (!candidatas.length) continue;
    let elegida = null, tipo = "";
    if (candidatas.length === 1) { elegida = candidatas[0]; tipo = puntaje(m, elegida) ? "monto y glosa" : "monto"; }
    else {
      const conPuntaje = candidatas.map(f => [f, puntaje(m, f)]).sort((a, b) => b[1] - a[1]);
      if (conPuntaje[0][1] > 0 && conPuntaje[0][1] > conPuntaje[1][1]) { elegida = conPuntaje[0][0]; tipo = "monto y glosa"; }
      else { m.cruce = `Ambiguo: ${candidatas.length} facturas con el mismo monto`; continue; }
    }
    usadas.add(elegida._i);
    elegida.estado_pago = "Pagada";
    elegida.fecha_pago = m.fecha;
    elegida.movimiento = m.descripcion;
    elegida.dias_a_pago = elegida.fecha_emision ? diasEntre(elegida.fecha_emision, m.fecha) : "";
    m.factura = `${elegida.tipo_documento || "Doc."} ${elegida.folio}`;
    m.cruce = tipo;
  }
  for (const m of movs) if (!m.factura && !m.cruce) m.cruce = "Sin respaldo";
  const limpiar = o => { const { _i, ...resto } = o; return resto; };
  const fs = facts.map(limpiar), ms = movs.map(limpiar);
  return {
    facturas: fs,
    movimientos: ms,
    resumen: {
      facturas_pagadas: fs.filter(f => f.estado_pago === "Pagada").length,
      facturas_pendientes: fs.filter(f => f.estado_pago === "Pendiente").length,
      movimientos_cruzados: ms.filter(m => m.factura).length,
      movimientos_sin_respaldo: ms.filter(m => m.cruce === "Sin respaldo").length,
      movimientos_ambiguos: ms.filter(m => m.cruce.startsWith("Ambiguo")).length
    }
  };
}

// ─────────────────────────────────────────────────────────────
//  H4 · Antigüedad de cuentas por cobrar
// ─────────────────────────────────────────────────────────────

export const TRAMOS = ["Por vencer", "1 a 30 días", "31 a 60 días", "61 a 90 días", "Más de 90 días"];

function tramo(diasVencida) {
  if (diasVencida <= 0) return TRAMOS[0];
  if (diasVencida <= 30) return TRAMOS[1];
  if (diasVencida <= 60) return TRAMOS[2];
  if (diasVencida <= 90) return TRAMOS[3];
  return TRAMOS[4];
}

/**
 * Antigüedad de las facturas de venta impagas.
 * @param {object[]} ventas  facturas de venta; se excluyen las que tengan estado_pago "Pagada"
 *                           y las notas de crédito se restan al cliente
 * @param {{fechaCorte:string, plazoDias?:number}} opciones  fechaCorte en ISO
 * @returns {{detalle: object[], clientes: object[], tramos: object, total: number}}
 */
export function antiguedadCobranza(ventas, opciones) {
  const corte = opciones.fechaCorte;
  const plazo = opciones.plazoDias == null ? 30 : Number(opciones.plazoDias);
  const detalle = [];
  for (const f of ventas) {
    if (f.estado_pago === "Pagada" || !f.fecha_emision) continue;
    const signo = f.tipo_dte === "61" ? -1 : 1;
    const vence = sumarDias(f.fecha_emision, plazo);
    const diasVencida = diasEntre(vence, corte);
    detalle.push({
      cliente: f.razon_social_receptor || f.rut_receptor, rut_cliente: f.rut_receptor,
      tipo_documento: f.tipo_documento, folio: f.folio, fecha_emision: f.fecha_emision,
      fecha_vencimiento: vence, dias_vencida: Math.max(diasVencida, 0),
      tramo: tramo(diasVencida), monto: signo * (Number(f.monto_total) || 0)
    });
  }
  detalle.sort((a, b) => b.dias_vencida - a.dias_vencida);
  const porCliente = new Map();
  const tramos = Object.fromEntries(TRAMOS.map(t => [t, 0]));
  for (const d of detalle) {
    tramos[d.tramo] += d.monto;
    const c = porCliente.get(d.rut_cliente || d.cliente) || { cliente: d.cliente, rut_cliente: d.rut_cliente, documentos: 0, total: 0, vencido: 0, mayor_atraso: 0, ...Object.fromEntries(TRAMOS.map(t => [t, 0])) };
    c.documentos++; c.total += d.monto; c[d.tramo] += d.monto;
    if (d.dias_vencida > 0) c.vencido += d.monto;
    c.mayor_atraso = Math.max(c.mayor_atraso, d.dias_vencida);
    porCliente.set(d.rut_cliente || d.cliente, c);
  }
  const clientes = [...porCliente.values()].sort((a, b) => b.vencido - a.vencido || b.total - a.total);
  return { detalle, clientes, tramos, total: detalle.reduce((s, d) => s + d.monto, 0) };
}

const fmtCLP = n => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const fmtFecha = iso => { const [a, m, d] = String(iso).split("-"); return `${d}-${m}-${a}`; };

/**
 * Borrador de correo de cobranza para un cliente. Tono cordial y formal;
 * es un borrador: lo revisa y lo envía una persona.
 */
export function correoCobranza(cliente, detalle, firma) {
  const docs = detalle.filter(d => (d.rut_cliente || d.cliente) === (cliente.rut_cliente || cliente.cliente) && d.monto > 0);
  const vencidos = docs.filter(d => d.dias_vencida > 0);
  const lista = (vencidos.length ? vencidos : docs)
    .map(d => `  • ${d.tipo_documento || "Factura"} N° ${d.folio}, emitida el ${fmtFecha(d.fecha_emision)}, por ${fmtCLP(d.monto)}${d.dias_vencida ? ` (${d.dias_vencida} días de atraso)` : ""}`).join("\n");
  const asunto = vencidos.length ? `Documentos pendientes de pago — ${cliente.cliente}` : `Recordatorio de vencimiento — ${cliente.cliente}`;
  const cuerpo = `Estimados ${cliente.cliente}:

Junto con saludar, les escribimos para revisar el estado de ${vencidos.length ? "los siguientes documentos, que según nuestros registros se encuentran pendientes de pago" : "los siguientes documentos, cuyo vencimiento se aproxima"}:

${lista}

Total: ${fmtCLP((vencidos.length ? vencidos : docs).reduce((s, d) => s + d.monto, 0))}

Si el pago ya fue realizado, les agradeceremos enviarnos el comprobante para registrarlo. Si necesitan coordinar una fecha o tienen alguna observación sobre los documentos, quedamos atentos a su respuesta.

Saludos cordiales,
${firma || "[Nombre y cargo]"}`;
  return { asunto, cuerpo };
}

// ─────────────────────────────────────────────────────────────
//  H5 · Flujo de caja a 13 semanas
// ─────────────────────────────────────────────────────────────

/**
 * Proyección semanal de caja. Las facturas impagas vencidas se cobran o
 * pagan en la primera semana (supuesto explícito y modificable: tasaCobroVencidas).
 * @param {{saldoInicial:number, fechaInicio:string, porCobrar:object[], porPagar:object[],
 *          gastosFijos?:{nombre:string, monto:number, dia:number}[], plazoCobro?:number,
 *          plazoPago?:number, tasaCobroVencidas?:number, semanas?:number}} e
 * @returns {{semanas: object[], saldoMinimo: number, semanaMinima: number}}
 */
export function flujoCaja(e) {
  const n = e.semanas || 13;
  const plazoCobro = e.plazoCobro == null ? 30 : e.plazoCobro;
  const plazoPago = e.plazoPago == null ? 30 : e.plazoPago;
  const tasaVencidas = e.tasaCobroVencidas == null ? 1 : e.tasaCobroVencidas;
  const semanas = [];
  for (let i = 0; i < n; i++) {
    const desde = sumarDias(e.fechaInicio, i * 7);
    semanas.push({ semana: i + 1, desde, hasta: sumarDias(desde, 6), saldo_inicial: 0, cobros: 0, pagos_proveedores: 0, gastos_fijos: 0, saldo_final: 0 });
  }
  const ubicar = (iso) => {
    const d = diasEntre(e.fechaInicio, iso);
    if (d < 0) return 0;
    const i = Math.floor(d / 7);
    return i < n ? i : -1;
  };
  for (const f of e.porCobrar || []) {
    if (f.estado_pago === "Pagada" || !f.fecha_emision) continue;
    const vence = sumarDias(f.fecha_emision, plazoCobro);
    const i = ubicar(vence);
    if (i === -1) continue;
    const signo = f.tipo_dte === "61" ? -1 : 1;
    const factor = diasEntre(e.fechaInicio, vence) < 0 ? tasaVencidas : 1;
    semanas[i].cobros += signo * Number(f.monto_total) * factor;
  }
  for (const f of e.porPagar || []) {
    if (f.estado_pago === "Pagada" || !f.fecha_emision) continue;
    const i = ubicar(sumarDias(f.fecha_emision, plazoPago));
    if (i === -1) continue;
    semanas[i].pagos_proveedores += (f.tipo_dte === "61" ? -1 : 1) * Number(f.monto_total);
  }
  for (const g of e.gastosFijos || []) {
    for (let k = 0; k <= Math.ceil(n * 7 / 28) + 1; k++) {
      const [a, m] = e.fechaInicio.split("-").map(Number);
      const mes = new Date(Date.UTC(a, m - 1 + k, 1));
      const ultimo = new Date(Date.UTC(mes.getUTCFullYear(), mes.getUTCMonth() + 1, 0)).getUTCDate();
      const iso = aISO(mes.getUTCFullYear(), mes.getUTCMonth() + 1, Math.min(g.dia || 1, ultimo));
      if (diasEntre(e.fechaInicio, iso) < 0) continue;
      const i = ubicar(iso);
      if (i !== -1) semanas[i].gastos_fijos += Number(g.monto) || 0;
    }
  }
  let saldo = Number(e.saldoInicial) || 0, minimo = Infinity, semMin = 1;
  for (const s of semanas) {
    s.cobros = Math.round(s.cobros);
    s.saldo_inicial = saldo;
    saldo = saldo + s.cobros - s.pagos_proveedores - s.gastos_fijos;
    s.saldo_final = Math.round(saldo);
    if (saldo < minimo) { minimo = saldo; semMin = s.semana; }
  }
  return { semanas, saldoMinimo: Math.round(minimo), semanaMinima: semMin };
}

// ─────────────────────────────────────────────────────────────
//  H8 · Boletas de honorarios
// ─────────────────────────────────────────────────────────────

/** Tasa de retención de boletas de honorarios por año (Ley 21.133). */
export const TASA_RETENCION = { 2019: 0.10, 2020: 0.1075, 2021: 0.115, 2022: 0.1225, 2023: 0.13, 2024: 0.1375, 2025: 0.145, 2026: 0.1525, 2027: 0.16, 2028: 0.17 };

export function tasaRetencion(anio) {
  const a = Number(anio);
  if (TASA_RETENCION[a]) return TASA_RETENCION[a];
  return a > 2028 ? 0.17 : 0.10;
}

/** De bruto a retención y líquido, o de líquido a bruto. */
export function calcularHonorario({ bruto, liquido, anio }) {
  const t = tasaRetencion(anio);
  if (bruto != null && bruto !== "") {
    const b = Math.round(Number(bruto));
    const r = Math.round(b * t);
    return { anio: Number(anio), tasa: t, bruto: b, retencion: r, liquido: b - r };
  }
  const l = Math.round(Number(liquido));
  const b = Math.round(l / (1 - t));
  const r = Math.round(b * t);
  return { anio: Number(anio), tasa: t, bruto: b, retencion: r, liquido: b - r };
}

/**
 * Lee el informe de boletas de honorarios (emitidas o recibidas) descargado
 * desde el SII en CSV, y verifica que la retención corresponda a la tasa del año.
 */
export function leerHonorarios(texto) {
  const sep = detectarSeparador(texto);
  const lineas = String(texto).split(/\r?\n/);
  let iEnc = lineas.findIndex(l => /bruto/i.test(sinTildes(l)) && /(fecha|boleta|folio)/i.test(sinTildes(l)));
  if (iEnc === -1) return { boletas: [], error: "No se encontró la fila de encabezados (debe tener una columna de montos brutos)." };
  const enc = dividirLineaCSV(lineas[iEnc], sep).map(normalizarEncabezado);
  const idx = {
    folio: buscarColumna(enc, ["n_boleta", "nro_boleta", "boleta", "folio", "numero"]),
    fecha: buscarColumna(enc, ["fecha_boleta", "fecha_emision", "fecha"]),
    estado: buscarColumna(enc, ["estado"]),
    rut: buscarColumna(enc, ["rut_emisor", "rut_receptor", "rut"]),
    nombre: buscarColumna(enc, ["nombre", "razon_social"]),
    bruto: buscarColumna(enc, ["bruto"]),
    retenido: buscarColumna(enc, ["retenido", "retencion", "impuesto"]),
    liquido: buscarColumna(enc, ["pagado", "liquido"])
  };
  const val = (c, i) => (i === -1 ? "" : c[i] || "");
  const boletas = [];
  for (let j = iEnc + 1; j < lineas.length; j++) {
    if (!lineas[j].trim()) continue;
    const c = dividirLineaCSV(lineas[j], sep);
    const fecha = leerFecha(val(c, idx.fecha));
    const bruto = leerMonto(val(c, idx.bruto));
    if (!fecha || !bruto) continue;
    const estado = val(c, idx.estado);
    const anulada = /nul/i.test(estado);
    const calc = calcularHonorario({ bruto, anio: fecha.slice(0, 4) });
    const retenido = idx.retenido === -1 ? calc.retencion : leerMonto(val(c, idx.retenido));
    const diferencia = anulada ? 0 : retenido - calc.retencion;
    boletas.push({
      folio: val(c, idx.folio), fecha, rut: validarRut(val(c, idx.rut)).rut || val(c, idx.rut), nombre: val(c, idx.nombre),
      estado: estado || "Vigente", bruto, retencion_informada: retenido, tasa: calc.tasa,
      retencion_calculada: calc.retencion, liquido: idx.liquido === -1 ? bruto - retenido : leerMonto(val(c, idx.liquido)),
      diferencia, revision: anulada ? "Anulada: no se suma" : Math.abs(diferencia) > 1 ? "La retención no corresponde a la tasa del año" : "OK"
    });
  }
  const vigentes = boletas.filter(b => !/nul/i.test(b.estado));
  const porMes = {};
  for (const b of vigentes) {
    const m = b.fecha.slice(0, 7);
    porMes[m] = porMes[m] || { mes: m, boletas: 0, bruto: 0, retencion: 0, liquido: 0 };
    porMes[m].boletas++; porMes[m].bruto += b.bruto; porMes[m].retencion += b.retencion_informada; porMes[m].liquido += b.liquido;
  }
  return { boletas, meses: Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes)) };
}

// ─────────────────────────────────────────────────────────────
//  H9 · Clasificador de gastos
// ─────────────────────────────────────────────────────────────

/** Reglas por defecto: palabra clave → categoría. Se evalúan en orden; gana la primera. */
export const REGLAS_GASTO = [
  { categoria: "Impuestos", palabras: ["f29", "f 29", "tesoreria", "sii", "impuesto", "iva", "ppm", "contribuciones"] },
  { categoria: "Remuneraciones", palabras: ["remuner", "sueldo", "salario", "prevision", "cotizacion", "afp", "isapre", "fonasa", "finiquito", "liquidacion de sueldo"] },
  { categoria: "Honorarios", palabras: ["honorario", "boleta de honorario", "consultoria", "asesoria", "asesor"] },
  { categoria: "Arriendo", palabras: ["arriendo", "arrendamiento", "renta oficina", "gastos comunes"] },
  { categoria: "Financiamiento", palabras: ["credito", "cuota", "leasing", "prestamo", "linea de credito", "intereses"] },
  { categoria: "Gastos bancarios", palabras: ["comision", "mantencion cuenta", "mantención", "cargo por servicio", "seguro desgravamen"] },
  { categoria: "Servicios básicos", palabras: ["enel", "cge", "aguas andinas", "esval", "essbio", "metrogas", "lipigas", "abastible", "agua", "luz", "electricidad", "gas"] },
  { categoria: "Telecomunicaciones", palabras: ["entel", "movistar", "claro", "gtd", "vtr", "wom", "mundo", "internet", "telefon", "celular"] },
  { categoria: "Software y suscripciones", palabras: ["software", "licencia", "microsoft", "google", "aws", "amazon web", "zoom", "slack", "adobe", "notion", "canva", "openai", "anthropic", "suscripcion"] },
  { categoria: "Combustible y peajes", palabras: ["combustible", "copec", "shell", "petrobras", "aramco", "peaje", "autopista", "tag", "bencina", "diesel"] },
  { categoria: "Transporte y despacho", palabras: ["transporte", "flete", "courier", "chilexpress", "starken", "correos de chile", "blue express", "despacho", "logistic"] },
  { categoria: "Seguros", palabras: ["seguro", "poliza", "aseguradora"] },
  { categoria: "Marketing", palabras: ["marketing", "publicidad", "facebook", "meta ads", "google ads", "instagram", "agencia"] },
  { categoria: "Materiales e insumos", palabras: ["sodimac", "easy", "construmart", "imperial", "materiales", "insumos", "ferreteria", "aridos", "hormigon", "mercaderia"] },
  { categoria: "Proveedores y subcontratos", palabras: ["proveedor", "subcontrat", "contratista"] }
];

/**
 * Asigna una categoría a cada fila según su texto (glosa de cartola o razón
 * social del proveedor). Los abonos se marcan como "Ingresos".
 * @param {object[]} filas
 * @param {{reglas?:object[], campos?:string[]}} [opciones]  campos de texto a revisar
 */
export function clasificar(filas, opciones) {
  const reglas = (opciones && opciones.reglas) || REGLAS_GASTO;
  const campos = (opciones && opciones.campos) || ["descripcion", "razon_social_emisor", "referencia"];
  const filasOut = filas.map(f => {
    if (f.abono && !f.cargo) return { ...f, categoria: "Ingresos", regla: "abono" };
    const texto = " " + sinTildes(campos.map(c => f[c] || "").join(" ")).toLowerCase() + " ";
    for (const r of reglas) {
      const p = r.palabras.find(w => {
        const ww = sinTildes(w).toLowerCase();
        return ww.length <= 4 ? new RegExp(`[^a-z0-9]${ww.replace(/\s/g, "\\s")}[^a-z0-9]`).test(texto) : texto.includes(ww);
      });
      if (p) return { ...f, categoria: r.categoria, regla: p };
    }
    return { ...f, categoria: "Sin clasificar", regla: "" };
  });
  const resumen = {};
  for (const f of filasOut) {
    const monto = Number(f.cargo || f.monto_total || 0) || Number(f.abono || 0);
    resumen[f.categoria] = resumen[f.categoria] || { categoria: f.categoria, movimientos: 0, monto: 0 };
    resumen[f.categoria].movimientos++; resumen[f.categoria].monto += monto;
  }
  return { filas: filasOut, resumen: Object.values(resumen).sort((a, b) => b.monto - a.monto) };
}

/** Convierte un texto "palabra, palabra → Categoría" (una regla por línea) en reglas. */
export function leerReglas(texto) {
  return String(texto).split(/\r?\n/).map(l => l.split(/=>|→|->/)).filter(p => p.length === 2 && p[1].trim())
    .map(([izq, der]) => ({ categoria: der.trim(), palabras: izq.split(",").map(s => s.trim()).filter(Boolean) }));
}

// ─────────────────────────────────────────────────────────────
//  H10 · Plantilla de presupuesto
// ─────────────────────────────────────────────────────────────

/**
 * Prepara la base de un presupuesto de 12 meses a partir de la historia:
 * promedio mensual de ventas (neto) y de cada categoría de gasto.
 * El crecimiento y los ajustes se dejan como celdas editables en la planilla.
 * @param {{ventas?:object[], gastos?:object[]}} historia
 *   ventas: facturas de venta; gastos: filas con `categoria` y `cargo` o `monto_neto`
 */
export function basePresupuesto(historia) {
  const mesesVentas = new Set(), mesesGastos = new Set();
  let ventas = 0;
  for (const f of historia.ventas || []) {
    if (!f.fecha_emision) continue;
    mesesVentas.add(f.fecha_emision.slice(0, 7));
    ventas += (f.tipo_dte === "61" ? -1 : 1) * (Number(f.monto_neto) + Number(f.monto_exento || 0));
  }
  const gastosCat = {};
  for (const g of historia.gastos || []) {
    const fecha = g.fecha || g.fecha_emision;
    if (!fecha || g.categoria === "Ingresos") continue;
    mesesGastos.add(fecha.slice(0, 7));
    const monto = Number(g.cargo || g.monto_neto || g.monto_total || 0);
    gastosCat[g.categoria || "Otros"] = (gastosCat[g.categoria || "Otros"] || 0) + monto;
  }
  // Cada fuente se promedia sobre sus propios meses: una cartola de dos meses
  // y un registro de ventas de cuatro no se mezclan en un mismo divisor.
  const nV = Math.max(mesesVentas.size, 1), nG = Math.max(mesesGastos.size, 1);
  const filas = [];
  if (mesesVentas.size) filas.push({ tipo: "Ingreso", concepto: "Ventas netas", base_mensual: Math.round(ventas / nV) });
  for (const [cat, total] of Object.entries(gastosCat).sort((a, b) => b[1] - a[1])) {
    filas.push({ tipo: "Gasto", concepto: cat, base_mensual: Math.round(total / nG) });
  }
  return { meses_ventas: [...mesesVentas].sort(), meses_gastos: [...mesesGastos].sort(), filas };
}

// ─────────────────────────────────────────────────────────────
//  H7 · Calculadora de horas
// ─────────────────────────────────────────────────────────────

/**
 * Estima las horas mensuales que se van en ordenar información, con los datos
 * que entrega el propio usuario. No usa supuestos ocultos: cada número sale de
 * una respuesta.
 * @param {{documentosMes:number, minutosPorDocumento:number, horasConciliacionSemana:number,
 *          horasInformesMes:number, horasCobranzaSemana:number, horasBuscarSemana:number,
 *          valorHora:number}} r
 */
export function calcularHoras(r) {
  const S = 4.33;
  const partidas = [
    { tarea: "Digitar o revisar documentos", horas_mes: (Number(r.documentosMes) || 0) * (Number(r.minutosPorDocumento) || 0) / 60 },
    { tarea: "Cuadrar banco con facturas", horas_mes: (Number(r.horasConciliacionSemana) || 0) * S },
    { tarea: "Armar informes y planillas", horas_mes: Number(r.horasInformesMes) || 0 },
    { tarea: "Seguimiento de cobranza", horas_mes: (Number(r.horasCobranzaSemana) || 0) * S },
    { tarea: "Buscar información dispersa", horas_mes: (Number(r.horasBuscarSemana) || 0) * S }
  ].map(p => ({ ...p, horas_mes: Math.round(p.horas_mes * 10) / 10 }));
  const horas = Math.round(partidas.reduce((s, p) => s + p.horas_mes, 0) * 10) / 10;
  const valor = Number(r.valorHora) || 0;
  return { partidas, horas_mes: horas, horas_anio: Math.round(horas * 12), costo_mes: Math.round(horas * valor), costo_anio: Math.round(horas * valor * 12), jornadas_mes: Math.round(horas / 9 * 10) / 10 };
}

// ─────────────────────────────────────────────────────────────
//  Volver a leer una tabla exportada por estas herramientas
// ─────────────────────────────────────────────────────────────

/**
 * Lee un CSV (o una hoja convertida a CSV) con columnas de factura, ya sea
 * con los nombres técnicos (monto_total) o con los encabezados legibles
 * (Monto total) que usan las descargas en Excel.
 */
export function leerTablaFacturas(texto, archivo) {
  const sep = detectarSeparador(texto);
  const lineas = String(texto).replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim());
  if (lineas.length < 2) return [];
  const inverso = {};
  for (const [k, v] of Object.entries(ETIQUETAS)) { inverso[normalizarEncabezado(v)] = k; inverso[k] = k; }
  const enc = dividirLineaCSV(lineas[0], sep).map(h => inverso[normalizarEncabezado(h)] || normalizarEncabezado(h));
  if (!enc.includes("monto_total") || !enc.includes("folio")) return [];
  const numericas = ["monto_neto", "monto_exento", "iva", "monto_total"];
  return lineas.slice(1).map(l => {
    const c = dividirLineaCSV(l, sep);
    const f = filaVacia(archivo);
    enc.forEach((k, i) => { if (k in f || k === "libro" || k === "estado_pago") f[k] = numericas.includes(k) ? leerMonto(c[i]) : (c[i] || ""); });
    f.fecha_emision = leerFecha(f.fecha_emision) || f.fecha_emision;
    return f;
  }).filter(f => f.folio);
}

/**
 * Decide si cada factura es de venta o de compra. Los registros del SII ya lo
 * traen; para XML o tablas exportadas se compara contra el RUT de la empresa.
 * @returns {object[]} facturas con `libro`; las que no se pueden decidir quedan con libro ""
 */
export function asignarLibro(facturas, rutEmpresa) {
  const mio = validarRut(rutEmpresa).cuerpo;
  return facturas.map(f => {
    if (f.libro) return f;
    if (f.origen === "registro_ventas") return { ...f, libro: "ventas" };
    if (f.origen === "registro_compras") return { ...f, libro: "compras" };
    if (mio && validarRut(f.rut_emisor).cuerpo === mio) return { ...f, libro: "ventas" };
    if (mio && validarRut(f.rut_receptor).cuerpo === mio) return { ...f, libro: "compras" };
    return { ...f, libro: "" };
  });
}

// ─────────────────────────────────────────────────────────────
//  H12 · Estimación del F29 (IVA, PPM y retenciones)
// ─────────────────────────────────────────────────────────────

const signoDTE = t => (String(t) === "61" || String(t) === "112" ? -1 : 1);

/**
 * Estimación del F29 de un mes. Es una estimación con datos propios: la
 * declaración la valida y la presenta el contador.
 * @param {{ventas:object[], compras:object[], mes:string, tasaPPM?:number,
 *          remanente?:number, retencionHonorarios?:number}} e
 *   mes "aaaa-mm"; tasaPPM en porcentaje (p. ej. 0,25); remanente de crédito del mes anterior
 */
export function estimarF29(e) {
  const delMes = f => (f.fecha_emision || "").slice(0, 7) === e.mes;
  const v = (e.ventas || []).filter(delMes), c = (e.compras || []).filter(delMes);
  const sum = (fs, k) => fs.reduce((s, f) => s + signoDTE(f.tipo_dte) * (Number(f[k]) || 0), 0);
  const debito = sum(v, "iva"), credito = sum(c, "iva");
  const ventasNetas = sum(v, "monto_neto") + sum(v, "monto_exento");
  const remanente = Number(e.remanente) || 0;
  const ivaDeterminado = debito - credito - remanente;
  const ppm = Math.round(ventasNetas * (Number(e.tasaPPM) || 0) / 100);
  const ret = Math.round(Number(e.retencionHonorarios) || 0);
  const ivaPagar = Math.max(ivaDeterminado, 0);
  return {
    mes: e.mes, documentos_venta: v.length, documentos_compra: c.length,
    ventas_netas: ventasNetas, iva_debito: debito, iva_credito: credito, remanente_anterior: remanente,
    iva_a_pagar: ivaPagar, remanente_siguiente: Math.max(-ivaDeterminado, 0),
    ppm, retencion_honorarios: ret, total_estimado: ivaPagar + ppm + ret,
    notas_credito_venta: v.filter(f => String(f.tipo_dte) === "61").length,
    notas_credito_compra: c.filter(f => String(f.tipo_dte) === "61").length
  };
}

/** Meses (aaaa-mm) presentes en un conjunto de facturas, del más reciente al más antiguo. */
export function mesesDe(facturas) {
  return [...new Set(facturas.map(f => (f.fecha_emision || "").slice(0, 7)).filter(Boolean))].sort().reverse();
}

// ─────────────────────────────────────────────────────────────
//  H13 · Radiografía de ventas y compras
// ─────────────────────────────────────────────────────────────

/**
 * Evolución mensual, principales clientes y proveedores, y concentración.
 * @param {{ventas?:object[], compras?:object[]}} e
 */
export function radiografia(e) {
  const neto = f => signoDTE(f.tipo_dte) * ((Number(f.monto_neto) || 0) + (Number(f.monto_exento) || 0));
  const meses = {};
  const agrupar = (fs, rutK, nomK) => {
    const m = new Map();
    for (const f of fs) {
      const k = validarRut(f[rutK]).cuerpo || f[nomK] || "Sin identificar";
      const x = m.get(k) || { nombre: f[nomK] || f[rutK], rut: f[rutK], documentos: 0, neto: 0 };
      x.documentos++; x.neto += neto(f); m.set(k, x);
    }
    const lista = [...m.values()].sort((a, b) => b.neto - a.neto);
    const total = lista.reduce((s, x) => s + x.neto, 0) || 1;
    let acum = 0;
    return lista.map((x, i) => { acum += x.neto; return { posicion: i + 1, ...x, participacion: Math.round(x.neto / total * 1000) / 10, acumulado: Math.round(acum / total * 1000) / 10 }; });
  };
  for (const f of e.ventas || []) { const m = (f.fecha_emision || "").slice(0, 7); if (!m) continue; meses[m] = meses[m] || { mes: m, ventas_netas: 0, compras_netas: 0, documentos_venta: 0, documentos_compra: 0 }; meses[m].ventas_netas += neto(f); meses[m].documentos_venta++; }
  for (const f of e.compras || []) { const m = (f.fecha_emision || "").slice(0, 7); if (!m) continue; meses[m] = meses[m] || { mes: m, ventas_netas: 0, compras_netas: 0, documentos_venta: 0, documentos_compra: 0 }; meses[m].compras_netas += neto(f); meses[m].documentos_compra++; }
  const evolucion = Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes)).map(m => ({ ...m, diferencia: m.ventas_netas - m.compras_netas }));
  const clientes = agrupar(e.ventas || [], "rut_receptor", "razon_social_receptor");
  const proveedores = agrupar(e.compras || [], "rut_emisor", "razon_social_emisor");
  const top = (l, n) => Math.round(l.slice(0, n).reduce((s, x) => s + x.participacion, 0) * 10) / 10;
  const docsVenta = (e.ventas || []).filter(f => signoDTE(f.tipo_dte) > 0);
  return {
    evolucion, clientes, proveedores,
    indicadores: {
      clientes: clientes.length, proveedores: proveedores.length,
      concentracion_top1: top(clientes, 1), concentracion_top3: top(clientes, 3),
      clientes_80: (clientes.findIndex(c => c.acumulado >= 80) + 1) || clientes.length,
      ticket_promedio: docsVenta.length ? Math.round(docsVenta.reduce((s, f) => s + neto(f), 0) / docsVenta.length) : 0
    }
  };
}
