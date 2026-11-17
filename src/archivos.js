/**
 * archivos.js — lectura de archivos en Node: texto con la codificación
 * correcta, PDF con texto y lotes de facturas (Registro de Compras y Ventas
 * del SII, XML de DTE, PDF o tablas exportadas).
 *
 * Todo ocurre en el computador donde corre: nada se envía a ningún servidor.
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { leerDTE, leerRegistroSII, leerTablaFacturas, leerFacturaTexto, textoInsuficiente, asignarLibro, COLUMNAS_FACTURA } from "./ave-herramientas.js";

/** Texto de un archivo: UTF-8 y, si aparecen caracteres inválidos, Windows-1252 (SII clásico). */
export async function leerTexto(ruta) {
  const buf = await readFile(ruta);
  let t = new TextDecoder("utf-8").decode(buf);
  if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf);
  return t.replace(/^﻿/, "");
}

/**
 * Texto de un PDF, agrupado por líneas según su posición en la página
 * (el mismo criterio que usa la herramienta web). Devuelve "" si el PDF es
 * una imagen escaneada sin capa de texto.
 */
export async function textoDePDF(ruta) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const datos = new Uint8Array(await readFile(ruta));
  const pdf = await pdfjs.getDocument({ data: datos, useSystemFonts: true, isEvalSupported: false }).promise;
  const paginas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const pag = await pdf.getPage(p);
    const cont = await pag.getTextContent();
    const lineas = new Map();
    for (const it of cont.items) {
      if (!("str" in it)) continue;
      const y = Math.round(it.transform[5] / 3);
      if (!lineas.has(y)) lineas.set(y, []);
      lineas.get(y).push([it.transform[4], it.str]);
    }
    paginas.push([...lineas.entries()].sort((a, b) => b[0] - a[0])
      .map(([, partes]) => partes.sort((a, b) => a[0] - b[0]).map(x => x[1]).join(" ").replace(/\s+/g, " ").trim()).join("\n"));
  }
  await pdf.destroy();
  return paginas.join("\n");
}

function filaError(ruta, motivo) {
  const f = {};
  for (const c of COLUMNAS_FACTURA) f[c] = "";
  return { ...f, archivo: basename(ruta), confianza: "baja", observaciones: motivo };
}

/**
 * Lee un lote de archivos de facturas y devuelve una sola tabla.
 * @param {string[]} rutas
 * @param {string} [rutEmpresa]  para clasificar XML, PDF y tablas como venta o compra
 * @returns {Promise<{facturas: object[], problemas: string[], sinLibro: number}>}
 */
export async function leerFacturas(rutas, rutEmpresa) {
  const facturas = [], problemas = [];
  for (const ruta of rutas) {
    const ext = extname(ruta).toLowerCase(), nombre = basename(ruta);
    try {
      if (ext === ".xml") {
        const r = leerDTE(await leerTexto(ruta), nombre);
        if (!r.length) problemas.push(`${nombre}: el XML no contiene un DTE reconocible.`);
        facturas.push(...r);
      } else if (ext === ".pdf") {
        const t = await textoDePDF(ruta);
        if (textoInsuficiente(t)) {
          facturas.push(filaError(ruta, "PDF escaneado sin texto: transcríbalo (por ejemplo, con la visión de su asistente) y use leer_factura_texto"));
        } else facturas.push(leerFacturaTexto(t, nombre, "pdf"));
      } else if ([".csv", ".txt", ".tsv"].includes(ext)) {
        const t = await leerTexto(ruta);
        let r = leerRegistroSII(t, null, nombre);
        if (!r.length) r = leerTablaFacturas(t, nombre);
        if (!r.length) problemas.push(`${nombre}: no se reconocieron facturas (use el Registro de Compras o Ventas del SII, XML, PDF o una tabla exportada).`);
        facturas.push(...r);
      } else {
        problemas.push(`${nombre}: formato no soportado (${ext || "sin extensión"}). Para Excel, expórtelo a CSV.`);
      }
    } catch (e) {
      problemas.push(`${nombre}: ${e.message}`);
    }
  }
  const conLibro = asignarLibro(facturas, rutEmpresa);
  return { facturas: conLibro, problemas, sinLibro: conLibro.filter(f => !f.libro && f.folio).length };
}
