/**
 * catalogo.js — la lista única de herramientas del sitio.
 *
 * Es dato puro (sin DOM): lo leen el índice (al generar el sitio), el panorama,
 * las tarjetas de "siga con…" de cada herramienta y la barra superior. Un nombre
 * o una descripción se cambia acá y cambia en todas partes.
 *
 * `usa` son las fuentes que la herramienta toma de la sesión de documentos
 * (lib/sesion.js): "ventas", "compras", "cartola".
 */

/** Trazos de los íconos (viewBox 0 0 24 24, sin relleno, línea de 1.6). */
export const ICONOS = {
  panorama: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  flujo: '<path d="M4 20V10M9.3 20V4M14.7 20v-7M20 20V8"/>',
  cobranza: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  f29: '<path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path d="M9.5 14.5l5-5.5"/><circle cx="9.8" cy="9.3" r=".9"/><circle cx="14.2" cy="14.3" r=".9"/>',
  gastos: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 3.9A8.5 8.5 0 0 1 20.1 9H15z"/>',
  radiografia: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.5-3.3 2.8-5 6-5s5.5 1.7 6 5"/><circle cx="17" cy="9.5" r="2.3"/><path d="M17.5 14.4c2 .4 3.2 1.9 3.5 4.1"/>',
  presupuesto: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>',
  cuadratura: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  facturas: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M10 12h5M10 15.5h5"/>',
  cartola: '<path d="M3.5 9.5L12 4l8.5 5.5M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3.5 20.5h17"/>',
  rut: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 15.8c.6-1.5 1.6-2.2 3-2.2s2.4.7 3 2.2M14.5 10h4M14.5 13.5h4"/>',
  honorarios: '<path d="M6 3.5h12v17H6z"/><path d="M9 8h6M9 11.5h6M9 15h3"/>',
  ia: '<path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16l-1.7-4.5-4.6-1.7 4.6-1.7z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  horas: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5"/>',
  agentes: '<path d="M8.5 8L4 12l4.5 4M15.5 8L20 12l-4.5 4M13.5 5.5l-3 13"/>',
  candado: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  subir: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19.5h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  flecha: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  falta: '<circle cx="12" cy="12" r="8.5"/>',
  aviso: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10.5v4M12 17.200v.1"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  correo: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',
  descarga: '<path d="M12 4.5v11M7.5 11L12 15.5 16.5 11M5 19.5h14"/>'
};

/** SVG de un ícono, como texto. */
export function icono(nombre, clase) {
  return `<svg class="ic${clase ? " " + clase : ""}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ""}</svg>`;
}

/**
 * Las herramientas. `grupo`:
 *   "pregunta"  responde una pregunta del dueño (es lo que se muestra primero)
 *   "preparar"  deja un documento en limpio
 *   "despues"   lo que viene una vez que hay tablas ordenadas
 */
export const HERRAMIENTAS = [
  { id: "panorama", href: "panorama.html", nombre: "Panorama", pregunta: "Su empresa en una pantalla",
    resumen: "Suba todo junto una sola vez y vea las seis respuestas a la vez.", grupo: "panorama", usa: ["ventas", "compras", "cartola"] },

  { id: "flujo", href: "flujo.html", nombre: "Flujo de caja a 13 semanas", pregunta: "¿Cuánta plata voy a tener?",
    resumen: "Su caja semana a semana por los próximos tres meses, con la semana más estrecha a la vista.", grupo: "pregunta", usa: ["ventas", "compras", "cartola"] },
  { id: "cobranza", href: "cobranza.html", nombre: "Cobranza por antigüedad", pregunta: "¿Quién me debe?",
    resumen: "La deuda de cada cliente por tramo de atraso y el correo de cobranza ya redactado.", grupo: "pregunta", usa: ["ventas", "cartola"] },
  { id: "f29", href: "f29.html", nombre: "Estimador del F29", pregunta: "¿Cuánto voy a pagar en el F29?",
    resumen: "El IVA y el PPM del mes, por separado, para llegar donde su contador sabiendo el número.", grupo: "pregunta", usa: ["ventas", "compras"] },
  { id: "gastos", href: "gastos.html", nombre: "Clasificador de gastos", pregunta: "¿En qué se va la plata?",
    resumen: "Cada movimiento con su categoría, con reglas que usted puede ver y cambiar.", grupo: "pregunta", usa: ["cartola", "compras"] },
  { id: "radiografia", href: "radiografia.html", nombre: "Radiografía de ventas y compras", pregunta: "¿De quién dependo?",
    resumen: "Sus principales clientes y proveedores, y cuánto de la venta está en pocas manos.", grupo: "pregunta", usa: ["ventas", "compras"] },
  { id: "presupuesto", href: "presupuesto.html", nombre: "Presupuesto de 12 meses", pregunta: "¿Cuánto puedo gastar el próximo año?",
    resumen: "Un Excel con fórmulas, armado desde su historia real de ventas y gastos.", grupo: "pregunta", usa: ["ventas", "compras", "cartola"] },

  { id: "facturas", href: "facturas.html", nombre: "Extractor de facturas a Excel", pregunta: "Facturas en una sola tabla",
    resumen: "Un lote de facturas en XML, PDF o foto, convertido en una tabla ordenada.", grupo: "preparar", usa: [] },
  { id: "cartola", href: "cartola.html", nombre: "Ordenador de cartolas", pregunta: "La cartola en limpio",
    resumen: "La cartola de cualquier banco en una tabla estándar, con el saldo verificado.", grupo: "preparar", usa: ["cartola"] },
  { id: "cuadratura", href: "cuadratura.html", nombre: "Cuadratura banco y facturas", pregunta: "¿Cuadra el banco con las facturas?",
    resumen: "Qué está pagado, qué está pendiente y qué movimientos no tienen factura.", grupo: "preparar", usa: ["ventas", "compras", "cartola"] },
  { id: "honorarios", href: "honorarios.html", nombre: "Boletas de honorarios", pregunta: "Retención de honorarios",
    resumen: "La retención según la tasa de cada año y la revisión del informe del SII.", grupo: "preparar", usa: [] },
  { id: "rut", href: "rut.html", nombre: "Validador de RUT", pregunta: "Listas de RUT sin errores",
    resumen: "Dígito verificador, formato y duplicados en sus listas de clientes y proveedores.", grupo: "preparar", usa: [] },

  { id: "guia-ia", href: "guia-ia.html", nombre: "Pregúntele a sus datos", pregunta: "Pregúntele a sus datos con IA", icono: "ia",
    resumen: "Paso a paso para conectar estas tablas a Copilot o Gemini y hacerles preguntas.", grupo: "despues", usa: [] },
  { id: "horas", href: "horas.html", nombre: "¿Cuánto le cuesta el desorden?", pregunta: "¿Cuánto le cuesta el desorden?",
    resumen: "Las horas y el dinero que se van cada mes en digitar, cuadrar y buscar.", grupo: "despues", usa: [] },
  { id: "agentes", href: "agentes.html", nombre: "Para desarrolladores y agentes de IA", pregunta: "Para su código o su agente de IA",
    resumen: "Las mismas funciones, en código abierto, para su propio asistente.", grupo: "despues", usa: [] }
];

export const herramienta = id => HERRAMIENTAS.find(h => h.id === id);

/** Tarjeta de una herramienta, como HTML. `modo`: "pregunta" (titular = la pregunta) o "nombre". */
export function tarjeta(h, modo, nota) {
  const titulo = modo === "pregunta" ? h.pregunta : h.nombre;
  const sub = modo === "pregunta" && h.pregunta !== h.nombre ? `<span class="t-sub">${h.nombre}</span>` : "";
  return `<a class="tarjeta" href="${h.href}">${icono(h.icono || h.id, "t-ic")}<span class="t-txt"><b class="t-tit">${titulo}</b><span class="t-res">${h.resumen}</span>${sub}${nota ? `<span class="t-nota">${nota}</span>` : ""}</span>${icono("flecha", "t-fl")}</a>`;
}
