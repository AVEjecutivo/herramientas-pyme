/**
 * fuentes.js — la carga de documentos, igual en todas las herramientas.
 *
 * Una sola zona: el usuario arrastra todo junto (Registro de Ventas, Registro
 * de Compras, cartolas, XML) y cada archivo se reconoce solo. No tiene que
 * saber cuál va en qué casilla. Lo leído queda en la sesión (lib/sesion.js),
 * así que la herramienta siguiente abre con el resultado ya calculado.
 *
 * Uso:
 *   montarFuentes($("#fuentes"), {
 *     usa: ["ventas", "cartola"],            // qué fuentes le sirven a esta herramienta
 *     opcional: { cartola: "para descontar lo ya cobrado" },
 *     alCambiar: (d, motivo) => { ... }      // d = datos() · motivo: "inicio" | "archivos" | "ejemplo" | "rut" | "vacio"
 *   });
 */
import { leerDTE, leerRegistroSII, leerTablaFacturas, leerCartola, validarRut, detectarSeparador, dividirLineaCSV } from "./ave-herramientas.js";
import { $, esc, leerTexto, leerTabular, archivoMuestra, zonaCarga, plural } from "./ui.js";
import { icono } from "./catalogo.js";
import { datos, leerSesion, guardarSesion, borrarSesion, agregarArchivo, quitarArchivo, periodo, almacenDisponible, sesionGuardada } from "./sesion.js";

/** La empresa de ejemplo: los mismos tres archivos en todas las herramientas, para que la historia calce. */
export const EJEMPLO = {
  archivos: ["muestras/registros/RegistroVentas_SII_ejemplo.csv", "muestras/registros/RegistroCompras_SII_ejemplo.csv", "muestras/cartolas/Cartola_BancoEstado_ejemplo.csv"],
  fechaRef: "2026-07-08",
  ajustes: { tasaVencidas: 70, fijos: [{ nombre: "Remuneraciones", monto: 4620000, dia: 28 }, { nombre: "Arriendo", monto: 850000, dia: 26 }, { nombre: "Imposiciones", monto: 1390000, dia: 2 }, { nombre: "Cuota crédito", monto: 1180000, dia: 6 }] }
};

const NOMBRES = { ventas: "Registro de Ventas", compras: "Registro de Compras", cartola: "Cartola del banco" };

const sinTildes = t => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Qué libro es un Registro del SII según su primera línea con contenido, o null
 * si los encabezados no lo dicen. La biblioteca decide "compras" si cualquier
 * encabezado contiene "emisor", y el Registro de Ventas real trae la columna
 * "RUT Emisor Liquid. Factura": por eso se decide aquí, antes de llamarla.
 * Ventas: "Rut cliente" o "Tipo Venta". Compras: "RUT Proveedor" o "Tipo Compra".
 */
export function libroPorEncabezados(texto) {
  const linea = String(texto).split(/\r?\n/).find(l => l.trim());
  if (!linea) return null;
  const enc = dividirLineaCSV(linea, detectarSeparador(texto)).map(h => sinTildes(h).toLowerCase().replace(/["_]/g, " ").replace(/\s+/g, " ").trim());
  if (enc.some(h => h === "rut cliente" || h === "tipo venta")) return "ventas";
  if (enc.some(h => h === "rut proveedor" || h === "tipo compra")) return "compras";
  return null;
}

/**
 * Lee un archivo y dice qué es. `problema` es HTML ya escapado: los nombres de
 * archivo y los mensajes de error pasan por esc(); el único HTML propio es el
 * enlace al Extractor.
 * @returns {Promise<{nombre:string, tipo:"ventas"|"compras"|"facturas"|"cartola"|"", facturas?:object[], movimientos?:object[], banco?:string, problema?:string}>}
 */
export async function reconocer(archivo) {
  const nombre = archivo.name, n = nombre.toLowerCase(), nom = esc(nombre);
  try {
    if (/\.(pdf|png|jpe?g|webp|heic)$/.test(n)) return { nombre, tipo: "", problema: `${nom}: los PDF y las fotos de facturas se leen en el <a href="facturas.html">Extractor de facturas</a>; lo que lea ahí queda disponible aquí. Las cartolas en PDF no se pueden leer: descárguela en Excel o CSV.` };
    if (n.endsWith(".xml")) {
      const facturas = leerDTE(await leerTexto(archivo), nombre);
      return facturas.length ? { nombre, tipo: "facturas", facturas } : { nombre, tipo: "", problema: `${nom}: el XML no contiene un documento tributario reconocible.` };
    }
    const texto = await leerTabular(archivo);
    // Primero mandan los encabezados; si no lo dicen, el nombre que pone el SII (RCV_COMPRA_…, RCV_VENTA_…); si tampoco, decide la biblioteca.
    const esCompra = /compra/.test(n), esVenta = /venta/.test(n);
    const libro = libroPorEncabezados(texto) || (esCompra && !esVenta ? "compras" : esVenta && !esCompra ? "ventas" : null);
    let facturas = leerRegistroSII(texto, libro, nombre);
    if (facturas.length) return { nombre, tipo: facturas[0].origen === "registro_compras" ? "compras" : "ventas", facturas };
    facturas = leerTablaFacturas(texto, nombre);
    if (facturas.length) return { nombre, tipo: "facturas", facturas };
    const c = leerCartola(texto, nombre);
    if (c.movimientos.length) return { nombre, tipo: "cartola", movimientos: c.movimientos.map(m => { const b = m.banco || c.banco; return b ? { ...m, banco: b } : { ...m, banco: nombre.replace(/\.\w+$/, ""), sinBanco: true }; }), banco: c.banco };
    return { nombre, tipo: "", problema: `${nom}: no lo reconocimos. Sirven el Registro de Compras o de Ventas del SII, la cartola del banco en Excel o CSV, y los XML de facturas.` };
  } catch (e) { return { nombre, tipo: "", problema: `${nom}: ${esc(e.message)}` }; }
}

const AYUDA = `
  <p><b>Registro de Compras y de Ventas.</b> En sii.cl, con el RUT y la clave de la empresa: <i>Servicios online › Factura electrónica › Registro de Compras y Ventas</i>. Elija el mes y, en cada pestaña (Compra y Venta), presione <i>Descargar detalles</i>. Baja un archivo por cada una; súbalos tal cual, sin abrirlos. Mientras más meses, mejor.</p>
  <p><b>Cartola del banco.</b> En el sitio de su banco, en la cuenta corriente, busque <i>Cartola</i> o <i>Movimientos</i> y elija exportar a Excel o CSV. La cartola en PDF no sirve.</p>
  <p><b>Facturas sueltas.</b> Si las tiene en XML, se leen aquí mismo. Si las tiene en PDF o en fotos, páselas primero por el <a href="facturas.html">Extractor de facturas</a>.</p>
  <p>Los nombres de los menús cambian de vez en cuando. Si no los encuentra, su contador descarga estos archivos en un par de minutos.</p>`;

const CORTOS = { ventas: "Ventas", compras: "Compras", cartola: "Cartola" };

const privacidad = () => almacenDisponible()
  ? `<b>Sus archivos no salen de este computador.</b> Se leen en su navegador y no se suben a ningún servidor. Quedan guardados en este navegador, para las demás herramientas, mientras esta pestaña siga abierta; con «Quitar mis documentos» se borran en el momento.`
  : `<b>Sus archivos no salen de este computador.</b> Se leen en su navegador y no se suben a ningún servidor. Este navegador no permite guardarlos entre páginas, así que cada herramienta los pide por separado.`;

/**
 * Lleva la respuesta a la vista y le da el foco, para que el lector de pantalla la anuncie.
 * Se desplaza hasta el rótulo de «Empresa de ejemplo» si lo hay (así nunca se ven
 * cifras sin saber que son de ejemplo) y, si no, hasta el titular.
 */
function llevarARespuesta() {
  const r = $("#resultado"), t = $("#titular");
  if (!r || r.hidden || !t || !t.firstElementChild) return;
  t.tabIndex = -1;
  const rot = $("#rotulo"), destino = rot && rot.firstElementChild ? rot : t;
  const quieto = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  destino.scrollIntoView({ behavior: quieto ? "auto" : "smooth", block: "start" });   // el margen para la barra fija está en estilo.css
  t.focus({ preventScroll: true });
}

export function montarFuentes(cont, op) {
  const usa = op.usa, opcional = op.opcional || {};
  let problemas = [], ocupado = "", abierto = false, rutAviso = null, rutEscrito = null, rutEnter = false;

  const avisar = motivo => {
    document.dispatchEvent(new Event("ave:sesion"));
    op.alCambiar && op.alCambiar(datos(), motivo);
    if (motivo !== "archivos" && motivo !== "ejemplo") return;
    // Si la carga dejó avisos o falta el RUT, la vista y el foco se quedan donde está el aviso: no se esconde bajo la respuesta.
    const d = datos(), faltaElRut = d.sinLibro.length > 0 && !d.rut && !d.rutInferido;
    const aviso = problemas.length ? $(".aviso.alerta", cont) : null, rut = !aviso && faltaElRut ? $("#rut", cont) : null;
    const donde = aviso || rut;
    if (!donde) return llevarARespuesta();
    if (aviso) aviso.tabIndex = -1;
    donde.scrollIntoView({ behavior: "auto", block: "nearest" });
    donde.focus({ preventScroll: true });
  };

  function resumen(d, tipo) {
    if (tipo === "cartola") {
      const bancos = [...new Set(d.movimientos.map(m => m.banco).filter(Boolean))];
      return `${plural(d.movimientos.length, "movimiento", "movimientos")} · ${periodo(d.movimientos.map(m => m.fecha))}${bancos.length ? " · " + bancos.join(", ") : ""}`;
    }
    const fs = d[tipo];
    return `${plural(fs.length, "documento", "documentos")} · ${periodo(fs.map(f => f.fecha_emision))}`;
  }
  const cuenta = (d, t) => t === "cartola" ? plural(d.movimientos.length, "movimiento", "movimientos") : plural(d[t].length, "documento", "documentos");
  // Lo que falta en una casilla: si hay documentos sin clasificar y no se sabe el RUT, lo que falta es el RUT, no un registro.
  const faltaRut = (d, t) => (t === "ventas" || t === "compras") && d.sinLibro.length > 0 && !d.rut && !d.rutInferido;

  function pintar() {
    const d = datos();
    const cargadas = usa.filter(t => d.tiene[t]).length;
    const compacto = cargadas > 0;
    const rutVisible = d.sinLibro.length > 0 || d.rutInferido || (d.rut && d.archivos.some(a => a.tipo === "facturas"));
    const tipos = usa.map(t => NOMBRES[t].replace(" del banco", "")).join(", ").replace(/, ([^,]*)$/, usa.length > 1 ? " y $1" : ", $1");
    const guardaNo = !d.vacia && almacenDisponible() && !sesionGuardada();

    const slots = usa.map(t => {
      if (d.tiene[t]) return compacto
        ? `<li class="slot ok" title="${esc(resumen(d, t))}">${icono("check")}<div><b>${CORTOS[t]}</b> · ${cuenta(d, t)}</div></li>`
        : `<li class="slot ok">${icono("check")}<div><b>${NOMBRES[t]}</b><span>${esc(resumen(d, t))}</span></div></li>`;
      if (faltaRut(d, t)) return compacto
        ? `<li class="slot">${icono("falta")}<div><b>${CORTOS[t]}</b> · falta el RUT de su empresa</div></li>`
        : `<li class="slot">${icono("falta")}<div><b>${NOMBRES[t]}</b><span>Falta el RUT de su empresa para separarlo de lo demás</span></div></li>`;
      return compacto
        ? `<li class="slot">${icono("falta")}<div><b>${CORTOS[t]}</b> · ${opcional[t] ? "opcional" : "falta"}</div></li>`
        : `<li class="slot">${icono("falta")}<div><b>${NOMBRES[t]}</b><span>${opcional[t] ? "Opcional: " + esc(opcional[t]) : "Falta"}</span></div></li>`;
    }).join("");

    const campoRut = rutVisible ? `<div class="campo rut-campo"><label for="rut">RUT de su empresa</label><input type="text" id="rut" inputmode="text" autocomplete="off" placeholder="76.123.456-0" value="${esc(rutEscrito != null ? rutEscrito : d.rut || d.rutInferido)}"${rutAviso && rutAviso.tipo === "error" ? ' aria-invalid="true"' : ""} aria-describedby="rut-nota">
        <small id="rut-nota"${rutAviso ? ` class="${rutAviso.tipo}" role="alert"` : ""}>${rutAviso ? esc(rutAviso.texto) : d.sinLibro.length ? `${plural(d.sinLibro.length, "documento no indica", "documentos no indican")} si es venta o compra. Con el RUT de su empresa se separan solos.` : d.rutInferido ? "Lo dedujimos porque aparece en todos sus documentos. Corríjalo si no es el de su empresa." : "Se usa solo para separar ventas de compras."}</small></div>` : "";
    const avisos = (problemas.length ? `<div class="aviso alerta" role="alert">${problemas.join("<br>")}</div>` : "")
      + (guardaNo ? `<div class="aviso alerta" role="status"><b>Son muchos documentos para guardarlos entre una página y otra.</b> Los resultados de esta página son correctos, pero las demás herramientas no los verán: tendría que volver a subirlos en cada una. Para que queden disponibles, quite algunos archivos.</div>` : "");
    const zona = `<label class="zona${compacto ? " compacta" : ""}" id="zona">
        <input type="file" multiple accept=".csv,.txt,.xlsx,.xls,.xml" aria-label="Elegir archivos">
        ${icono("subir")}
        <b>${ocupado && !compacto ? esc(ocupado) : compacto ? "Agregar o cambiar archivos" : "Arrastre aquí sus archivos, o haga clic para elegirlos"}</b>
        <span>${compacto ? "Si sube un archivo con el mismo nombre, reemplaza al anterior." : `${tipos}. Súbalos todos juntos: cada uno se reconoce solo.`}</span>
      </label>`;
    const ayuda = `<details class="ayuda"><summary>¿De dónde saco estos archivos?</summary>${AYUDA}</details>`;
    const ejemploAviso = d.ejemplo ? `<p class="ejemplo"><b>Empresa de ejemplo.</b> Está viendo datos ficticios.${compacto ? "" : ` <button type="button" class="enlace" data-borrar>Usar mis archivos</button>`}</p>` : "";

    if (compacto) {
      cont.innerHTML = `<div class="fuentes con-datos compacto">
      ${ejemploAviso}
      <div class="fuentes-fila">
        <ul class="slots">${slots}</ul>
        <details class="cambiar"${abierto ? " open" : ""}><summary>Cambiar archivos</summary>
          <div class="cambiar-cuerpo"><ul class="periodos" aria-label="Lo que está cargado">${usa.filter(t => d.tiene[t]).map(t => `<li><b>${NOMBRES[t]}</b> · ${esc(resumen(d, t))}</li>`).join("")}</ul>${zona}${ayuda}<p class="privado">${icono("candado")}<span>${privacidad()}</span></p></div>
        </details>
        <button type="button" class="enlace" data-borrar>${d.ejemplo ? "Usar mis archivos" : "Quitar mis documentos"}</button>
      </div>
      ${ocupado ? `<p class="nota" role="status">${esc(ocupado)}</p>` : ""}
      ${campoRut}${avisos}
      <p class="privado corto">${icono("candado")}<span>No salen de su computador.</span></p>
    </div>`;
    } else {
      cont.innerHTML = `<div class="fuentes">
      ${ejemploAviso}
      ${zona}
      <ul class="slots">${slots}</ul>
      ${campoRut}${avisos}
      <div class="fuentes-pie">
        ${d.vacia ? `<button type="button" class="btn sec" id="muestra">Probar con una empresa de ejemplo</button>` : ""}
        ${!d.vacia && !d.ejemplo ? `<button type="button" class="btn plano" data-borrar>Quitar mis documentos</button>` : ""}
      </div>
      <p class="privado">${icono("candado")}<span>${privacidad()}</span></p>
      ${ayuda}
    </div>`;
    }
    zonaCarga($("#zona", cont), cargar);
    const det = $("details.cambiar", cont); if (det) det.addEventListener("toggle", () => { abierto = det.open; });
    const m = $("#muestra", cont); if (m) m.onclick = cargarEjemplo;
    cont.querySelectorAll("[data-borrar]").forEach(b => b.onclick = () => { borrarSesion(); problemas = []; rutAviso = null; rutEscrito = null; abierto = false; pintar(); avisar("vacio"); const z = $("#zona input", cont); if (z) z.focus({ preventScroll: true }); });
    const r = $("#rut", cont);
    if (r) {
      r.addEventListener("keydown", ev => { if (ev.key === "Enter") rutEnter = true; });
      r.onchange = () => aceptarRut(r.value);
    }
  }

  /** Valida el RUT al cambiar: lo dice junto al campo y solo guarda uno válido. */
  function aceptarRut(texto) {
    const volver = rutEnter; rutEnter = false;
    const v = validarRut(texto), s = leerSesion();
    if (!texto.trim()) { s.rut = ""; guardarSesion(s); rutAviso = null; rutEscrito = null; }
    else if (!v.valido) { rutAviso = { tipo: "error", texto: `«${texto.trim()}» no es un RUT válido. Revise los números y el dígito verificador.` }; rutEscrito = texto; }
    else {
      s.rut = v.rut; guardarSesion(s); rutEscrito = null;
      const sueltas = s.facturas.filter(f => !f.libro && f.origen !== "registro_ventas" && f.origen !== "registro_compras");
      const aparece = sueltas.some(f => validarRut(f.rut_emisor).cuerpo === v.cuerpo || validarRut(f.rut_receptor).cuerpo === v.cuerpo);
      rutAviso = sueltas.length && !aparece ? { tipo: "alerta", texto: "Ese RUT no aparece en sus documentos. Revise que sea el de su empresa." } : null;
    }
    pintar(); avisar("rut");
    if (volver) { const r = $("#rut", cont); if (r) r.focus(); }
  }

  async function cargar(archivos) {
    problemas = []; rutAviso = null; rutEscrito = null; abierto = false;
    let duplicadas = 0, movOmitidos = 0, reconocidos = 0;
    for (let i = 0; i < archivos.length; i++) {
      ocupado = `Leyendo ${i + 1} de ${archivos.length}: ${archivos[i].name}…`; pintar();
      const r = await reconocer(archivos[i]);
      if (r.problema) { problemas.push(r.problema); continue; }
      // La empresa de ejemplo solo se descarta cuando llega un archivo que sí se reconoce (no se mezclan datos ficticios con reales).
      if (!reconocidos++ && leerSesion().ejemplo) borrarSesion();
      const a = agregarArchivo(r);
      duplicadas += a.duplicadas; movOmitidos += a.movimientosOmitidos;
    }
    if (duplicadas) problemas.push(`${plural(duplicadas, "documento ya estaba", "documentos ya estaban")} en otro archivo y no se ${duplicadas === 1 ? "contó" : "contaron"} dos veces.`);
    if (movOmitidos) problemas.push(`${plural(movOmitidos, "movimiento ya estaba", "movimientos ya estaban")} en otro archivo y no se ${movOmitidos === 1 ? "contó" : "contaron"} dos veces.`);
    ocupado = ""; pintar(); avisar("archivos");
  }

  async function cargarEjemplo() {
    ocupado = "Cargando la empresa de ejemplo…"; pintar();
    try {
      const leidos = await Promise.all(EJEMPLO.archivos.map(async r => reconocer(await archivoMuestra(r))));
      borrarSesion(); problemas = []; rutAviso = null; rutEscrito = null;
      leidos.forEach(agregarArchivo);
      const s = leerSesion(); s.ejemplo = true; s.fechaRef = EJEMPLO.fechaRef; s.ajustes = structuredClone(EJEMPLO.ajustes); guardarSesion(s);
    } catch (e) { problemas = ["No se pudo cargar el ejemplo: " + esc(e.message)]; }
    ocupado = ""; pintar(); avisar("ejemplo");
  }

  pintar();
  if (new URLSearchParams(location.search).has("ejemplo") && datos().vacia) cargarEjemplo();
  else avisar("inicio");
  return { cargar, cargarEjemplo, pintar, quitar: n => { quitarArchivo(n); pintar(); avisar("archivos"); } };
}
