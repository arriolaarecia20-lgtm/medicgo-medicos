# Medic GO · Portal médico

Portal independiente en HTML, CSS y JavaScript, sin instalación ni compilación. No está conectado a la web de pacientes ni a servicios de mensajería.

## Abrir

Abre esta carpeta en VS Code. Con **Live Server** instalado, haz clic derecho en `index.html` y selecciona **Open with Live Server**. Mantén el mismo navegador, dirección y puerto para seguir usando los datos guardados.

## Archivos y dependencias

| Página | Función | Archivos que carga |
| --- | --- | --- |
| `index.html` | Acceso y selección de médico | `styles.css`, `app.js` |
| `resumen.html` | Indicadores y próximas visitas | `styles.css`, `app.js` |
| `solicitudes.html` | Listado, filtros y decisiones | `styles.css`, `app.js` |
| `agenda.html` | Agenda por día y semana | `styles.css`, `app.js` |
| `disponibilidad.html` | Bloques semanales y guardado | `styles.css`, `app.js` |
| `historial.html` | Visitas cerradas y por completar | `styles.css`, `app.js` |

`app.js` contiene datos iniciales, persistencia, validaciones, vistas y controles compartidos. El arranque está reunido en `start()`. Las validaciones de aceptación y de fecha se comparten entre la interfaz y los cambios de estado. Los eventos se asignan una vez al crear cada control; abrir detalles utiliza un único evento delegado en el contenido.

`styles.css` reúne los estilos antes repartidos entre dos hojas, con componentes, estados y reglas adaptables. Los iconos y la ilustración médica son SVG incluidos en JavaScript. La única dependencia externa es Poppins desde Google Fonts; si no hay conexión se utiliza Arial. Ninguna página del portal carga archivos de `qa/` ni scripts de Node.

## Datos y funcionamiento

Se conservan las claves existentes de localStorage, sin migraciones ni reinicios:

- `medicgo-medicos:data:v1`: visitas y disponibilidad de los tres médicos.
- `medicgo-medicos:selected:v1`: médico seleccionado.

Las fechas de ejemplo se calculan únicamente al generar los datos iniciales. Cada perfil consulta sus visitas y horarios. La separación es local y no sustituye una autenticación con servidor. Salir elimina la selección activa, pero conserva visitas y disponibilidad.

Las visitas duran 30 minutos. Una solicitud solo se acepta si cabe en la disponibilidad y no coincide con otra visita aceptada. Aceptar, rechazar, cancelar y completar requieren confirmación. Cancelar libera el horario; completar solo está disponible a partir de la hora programada. Las visitas cerradas no vuelven a estados activos.

En Disponibilidad, agregar o quitar bloques prepara un borrador. **Guardar disponibilidad** aplica los cambios y **Descartar cambios** recupera los horarios guardados. Se impiden superposiciones y se solicita confirmación si el nuevo horario deja visitas aceptadas fuera de disponibilidad. Esas visitas conservan su estado. Si falla el almacenamiento, se mantiene el último estado guardado y se informa del error.

## Comprobaciones de mantenimiento

Se conservan únicamente pruebas reutilizables; no requieren paquetes de npm:

| Archivo | Función |
| --- | --- |
| `verify.cjs` | Pruebas de lógica con almacenamiento en memoria: estados, conflictos, filtros, aislamiento, persistencia, recuperación ante errores y dependencias HTML. |
| `qa/browser.cjs` | Ejecuta interacciones en Edge con un perfil temporal propio; comprueba las seis páginas a cinco anchos y detecta excepciones JavaScript. Inicia y cierra su servidor y navegador. |
| `qa/interacciones.html` | Recorrido de interacción que usa el ejecutor. Restaura los valores iniciales de almacenamiento en `finally`, incluso si una prueba falla. |
| `qa/server.cjs` | Servidor estático local compartido por el ejecutor y la revisión manual; solo escucha en `127.0.0.1`. |

Desde la carpeta del proyecto:

```sh
node --check app.js
node verify.cjs
node qa/browser.cjs
```

El ejecutor de navegador requiere Node.js 22 o posterior y Edge de Windows. Busca Edge en su ubicación habitual; admite una ruta alternativa en la variable de entorno `EDGE_PATH`. No cambia la configuración de Windows ni la del navegador del usuario. Los argumentos de lanzamiento se aplican solo al proceso de pruebas y su perfil temporal.

Para revisión manual puedes ejecutar `node qa/server.cjs` y abrir `http://127.0.0.1:4173/index.html`. Si ejecutas directamente `qa/interacciones.html`, utiliza un perfil destinado a pruebas: el recorrido modifica datos mientras se ejecuta, antes de restaurarlos.

Opcionalmente, `node qa/browser.cjs --snapshot` guarda estilos calculados en `qa/snapshot.json`. Después de una modificación, `node qa/browser.cjs --compare qa/snapshot.json` verifica que sean idénticos. La instantánea es un resultado temporal y no se distribuye con el portal.

## Resultado de la depuración

Pasaron las pruebas de lógica y 58 comprobaciones de interacción: acceso, cambio entre los tres médicos, aceptación, agenda, finalización e historial, rechazo con motivo, cancelación y liberación del horario, filtros, navegación semanal, guardado y descarte de disponibilidad, advertencias por visitas afectadas, persistencia y salida sin borrar datos.

Los estilos calculados antes y después de la limpieza coincidieron en las seis páginas a 390, 760, 1100, 1200 y 1440 px. No se detectaron excepciones JavaScript de la aplicación ni desbordamiento horizontal de la página. Las tablas y la agenda semanal conservan desplazamiento dentro de su área.

Se retiraron `theme.css` después de integrar sus reglas, el antiguo ejecutor de capturas `qa/capture.cjs`, imágenes de prueba, resultados antiguos y el registro interno `edge-qa.log`, sin referencias desde el portal. Los temporales `browser-qa.html`, `improve.cjs` y `qa-server.cjs` ya no estaban en disco al comenzar esta revisión; no eran dependencias del portal.

Los mensajes internos de Edge sobre GPU, cifrado o componentes pertenecen al proceso del navegador y se distinguen de las excepciones de la web. El ejecutor informa por separado de recursos de red no disponibles. Google Fonts no estuvo accesible en este entorno; se verificó la fuente alternativa. La petición automática de `favicon.ico` puede devolver 404 porque el portal no define un icono de pestaña. No se probó en dispositivos físicos ni en otros navegadores.

Proyecto académico · Datos de ejemplo
