/**
 * entradas.js — carga de facturas común a cuadratura, cobranza, flujo de caja
 * y presupuesto. Acepta el Registro de Compras y Ventas del SII, XML de DTE y
 * las tablas que descarga el extractor de facturas.
 */
import { leerDTE, leerRegistroSII, leerTablaFacturas, asignarLibro } from "./ave-herramientas.js";
import { leerTexto, leerTabular } from "./ui.js";

/**
 * @param {File[]} archivos
 * @param {string} rutEmpresa  necesario solo para XML o tablas exportadas
 * @returns {Promise<{facturas: object[], problemas: string[], sinLibro: number}>}
 */
export async function leerFacturas(archivos, rutEmpresa) {
  const facturas = [], problemas = [];
  for (const a of archivos) {
    const n = a.name.toLowerCase();
    try {
      if (n.endsWith(".xml")) { facturas.push(...leerDTE(await leerTexto(a), a.name)); continue; }
      const texto = await leerTabular(a);
      let r = leerRegistroSII(texto, null, a.name);
      if (!r.length) r = leerTablaFacturas(texto, a.name);
      if (!r.length) problemas.push(`${a.name}: no se reconocieron facturas (use el Registro de Compras o Ventas del SII, XML, o la tabla del extractor).`);
      facturas.push(...r);
    } catch (e) { problemas.push(`${a.name}: ${e.message}`); }
  }
  const conLibro = asignarLibro(facturas, rutEmpresa);
  return { facturas: conLibro, problemas, sinLibro: conLibro.filter(f => !f.libro).length };
}
