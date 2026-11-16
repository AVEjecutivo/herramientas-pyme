/**
 * herramientas-pyme — punto de entrada para Node.
 *
 *   import { leerCartola, conciliar, estimarF29, leerFacturas } from "herramientas-pyme";
 *
 * Reexporta la biblioteca pura (la misma que corre en el navegador en
 * miavejecutivo.com/herramientas) y agrega la lectura de archivos y PDF.
 */
export * from "./ave-herramientas.js";
export { leerTexto, textoDePDF, leerFacturas } from "./archivos.js";
