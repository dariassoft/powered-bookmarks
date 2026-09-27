# Plan de Desarrollo: Extensión Multiplataforma para Gestión Eficiente de Pestañas y Memoria

Este documento técnico sirve como especificación de diseño y plan de desarrollo paso a paso para ser procesado por un modelo de Inteligencia Artificial (IA) dentro de **WebStorm**. El objetivo es construir una extensión de navegador ligera, rápida, fluida y responsiva que resuelva el consumo excesivo de memoria RAM mediante el almacenamiento jerárquico estático de pestañas bajo demanda.

---

## 🛠️ Especificaciones Técnicas y Arquitectura Core

### 1. Stack Tecnológico (Sin Overhead de Frameworks)
*   **Lenguaje:** TypeScript compilado a JavaScript (ES6+ nativo).
*   **Diseño/Estilos:** CSS3 Vanilla con variables globales (Custom Properties). Sin frameworks de CSS para garantizar que el peso en bytes sea mínimo.
*   **Entorno de Construcción:** Vite para la transpilación ultrarrápida y empaquetado optimizado.
*   **Estructura Base:** API WebExtensions compatible con Manifest V3.

### 2. Soporte Multiplataforma Específico (Desktop & Android)
*   **Interfaz de Usuario (UI):** La extensión utilizará una **Página de Opciones completa (`options.html`)** como su centro de control principal en lugar de un popup flotante estrecho. Esto garantiza usabilidad táctil al 100% en Firefox Android y navegadores basados en Chromium para móviles.
*   **Detección Dinámica de Características (Feature Detection):** Las APIs de Grupos de Pestañas (`chrome.tabGroups`) y de Captura de Pantalla (`chrome.tabs.captureVisibleTab`) no están disponibles en entornos móviles (Android). El código base debe envolver estas llamadas en bloques condicionales para evitar excepciones que detengan la ejecución.

### 3. Modelo de Datos Indexado (Estructura de Árbol)
El estado de la jerarquía se almacenará en `chrome.storage.local`. Se definirá un modelo estricto en TypeScript para representar las carpetas y los enlaces (nodos):

```typescript
export interface BaseNode {
  id: string;          // UUID único o ID del marcador original
  parentId: string | null;
  title: string;
  type: 'folder' | 'tab';
  createdAt: number;
  lastViewedAt: number; // Para el ordenamiento cronológico por carpeta
}

export interface FolderNode extends BaseNode {
  type: 'folder';
  children: string[];  // Lista ordenada de IDs de los nodos hijos
}

export interface TabNode extends BaseNode {
  type: 'tab';
  url: string;
  screenshot?: string; // Cadena Base64 optimizada en formato WebP (opcional)
  faviconUrl?: string; // Fallback visual para Android
  description?: string; // Notas o metadatos extraídos de la web
}

export interface StorageSchema {
  rootFolderId: string;
  nodes: { [id: string]: FolderNode | TabNode };
}
```

---

## 📋 Plan de Desarrollo Paso a Paso

### Fase 1: Inicialización del Entorno e Internacionalización (i18n)
*   **Paso 1.1:** Crear la estructura de directorios estándar de Vite con soporte para TypeScript.
*   **Paso 1.2:** Configurar el archivo `manifest.json` bajo la especificación **Manifest V3**. Configurar la propiedad `options_page` apuntando a `options.html` y habilitar los permisos: `storage`, `tabs`, `bookmarks`, y condicionalmente `tabGroups`.
*   **Paso 1.3:** Crear el directorio `_locales/` e implementar los archivos `messages.json` para **Español (`es`)**, **Inglés (`en`)** y **Francés (`fr`)**. Todo texto visible en la UI debe ser renderizado mediante la llamada nativa `chrome.i18n.getMessage()`.

### Fase 2: Capa de Persistencia y Estructuración de Datos
*   **Paso 2.1:** Crear un módulo de servicios de almacenamiento `StorageService.ts` encargado de inicializar el nodo raíz (`root`) la primera vez que se ejecuta la extensión.
*   **Paso 2.2:** Desarrollar funciones CRUD asíncronas para nodos (crear carpeta, mover nodo, renombrar, eliminar). Al eliminar una carpeta, implementar borrado recursivo de sus elementos secundarios para evitar nodos huérfanos en la base de datos.
*   **Paso 2.3:** Implementar algoritmos de ordenamiento en memoria dentro de cada carpeta basados en las propiedades del nodo: Alfabético, Fecha de creación y **Más recientemente visualizado (`lastViewedAt`)**.

### Fase 3: Motores de Importación de Datos Existentes
*   **Paso 3.1: Importador de Marcadores.** Usar la API `chrome.bookmarks.getTree()` para recorrer de forma recursiva el árbol de marcadores del navegador. Convertir cada carpeta de marcadores en un `FolderNode` y cada marcador en un `TabNode`.
*   **Paso 3.2: Importador de Grupos de Pestañas (Solo Escritorio).** Validar si `chrome.tabGroups` está definido. Si existe, mapear los grupos de pestañas abiertos actualmente. Obtener sus nombres y colores, crear las carpetas correspondientes en nuestra extensión, importar las URLs internas y cerrar el grupo original para liberar RAM de inmediato.

### Fase 4: Interfaz de Usuario "Explorador de Archivos" y Carga Bajo Demanda
*   **Paso 4.1:** Diseñar una interfaz limpia de doble panel en `options.html`: Panel izquierdo para el árbol jerárquico expandible/colapsable, panel derecho para la vista detallada de la carpeta seleccionada (diseño en cuadrícula o lista).
*   **Paso 4.2: Optimización Extrema del DOM.** Para evitar ralentizar el navegador con miles de registros, utilizar `DocumentFragment` al renderizar carpetas masivas. Implementar *Carga Perezosa (Lazy Loading)* para los elementos visuales del panel derecho.
*   **Paso 4.3: Comportamiento de las Pestañas.** Los elementos guardados se muestran estáticos (consumo 0 de RAM). Al hacer un **clic simple**, se despliega el panel de detalles con su título, descripción, fecha y screenshot. Al hacer **doble clic**, se invoca `chrome.tabs.create({ url })` para abrir y cargar la página de forma efectiva, actualizando inmediatamente el timestamp `lastViewedAt`.

### Fase 5: Captura Eficiente de Contenido en Segundo Plano (Background Engine)
*   **Paso 5.1:** En el Service Worker (`background.ts`), implementar un listener para el evento de solicitudes de guardado de pestañas activas.
*   **Paso 5.2:** Si el entorno soporta captura (Desktop), ejecutar `chrome.tabs.captureVisibleTab`. Pasar el flujo de la imagen a un elemento `Offscreen Canvas` invisible para reducir la resolución de la captura de pantalla a un tamaño estándar (ej. 400x250px) y comprimirla fuertemente a formato **Image/WebP** antes de guardarla.
*   **Paso 5.3:** Si el entorno es Android, omitir la captura visible, extraer únicamente el `favIconUrl` provisto por el objeto `Tab` y asignarlo como el identificador visual del nodo.

### Fase 6: Motores de Búsqueda Indexada y Exportación de Datos
*   **Paso 6.1:** Crear una función de búsqueda predictiva en tiempo real que filtre los nodos por coincidencia de texto en las propiedades `title`, `url` y `description`. La búsqueda debe ejecutarse directamente sobre el objeto en memoria derivado de `chrome.storage.local` para garantizar velocidad instantánea.
*   **Paso 6.2: Exportador HTML de Marcadores.** Diseñar un motor que convierta la jerarquía de la extensión al formato estándar de marcadores netscape (archivo HTML con etiquetas `<NETSCAPE-Bookmark-file-1>`, `<DL>`, `<p>`, `<DT>`), permitiendo que el usuario pueda volver a importarlos de forma nativa en cualquier navegador del mercado.
*   **Paso 6.3: Exportador CSV/Texto.** Crear funciones auxiliares que aplanen el árbol jerárquico y generen descargas de archivos en formato estructurado CSV (Columnas: ID, Ruta de Carpetas, Título, URL, Última Vez Visto) y formato estructurado TXT plano.
 
### Fase 7: Actualización, Duplicados y Ordenamiento Avanzado
*   **Paso 7.1: Actualización incremental.** Añadir una acción de actualización que vuelva a ejecutar los importadores de marcadores, grupos y pestañas para incorporar elementos nuevos después de la importación inicial, reutilizando carpetas existentes y evitando duplicar la estructura.
*   **Paso 7.2: Gestión de duplicados.** Implementar políticas configurables para ignorar, conservar, renombrar o eliminar duplicados antes de guardar una pestaña importada. La comparación debe usar una URL normalizada, con hostname en minúsculas y fragmentos eliminados.
*   **Paso 7.3: Detección de duplicados.** Añadir una función que agrupe las pestañas equivalentes y una vista de resultados para revisar los duplicados encontrados.
*   **Paso 7.4: Ordenamiento avanzado.** Permitir ordenar el contenido por título, fecha de creación, última visualización, dominio y URL, validando los valores recibidos por la interfaz.

### Fase 8: Gestión avanzada de bookmarks
*   **Paso 8.1: Drag & drop en ambos paneles.** Hacer que folders y nodos sean arrastrables y permitan mover elementos mediante drag & drop tanto en el árbol jerárquico del panel izquierdo como en las tarjetas/lista del panel derecho. El destino debe validarse para impedir mover la raíz, crear ciclos o soltar un nodo dentro de sí mismo.
*   **Paso 8.2: Carpetas colapsables en el panel derecho.** Mostrar el contenido jerárquico del folder seleccionado en el panel derecho con folders expandibles y colapsables, conservando el estado visual de expansión sin romper la selección ni la navegación.
*   **Paso 8.3: Estado de importación.** Al pulsar importar o actualizar importación, mostrar un indicador de proceso: icono de espera, estado accesible o barra de progreso. El indicador debe reflejar el inicio, progreso y finalización, y debe restaurarse correctamente cuando ocurra un error.
*   **Paso 8.4: Menú contextual.** Añadir menú de click derecho para folders y nodos, con acciones localizadas para editar, quitar, eliminar, renombrar, copiar y pegar. Las acciones deben respetar las invariantes de `StorageService`, evitar duplicar referencias y mostrar errores explícitos.
*   **Paso 8.5: Portapapeles interno.** Implementar copiar y pegar dentro de la extensión, diferenciando entre copiar una referencia/nodo y moverlo, validando destinos y preservando la jerarquía cuando corresponda.

---

## ✅ Estado actual de implementación

La base funcional de las fases 1 a 8 ya está implementada en TypeScript y compilada con Vite.

### Estructura creada

```text
.
├── options.html
├── public/
│   ├── manifest.json
│   └── _locales/
│       ├── es/messages.json
│       ├── en/messages.json
│       └── fr/messages.json
├── src/
│   ├── background.ts
│   ├── exporters/index.ts
│   ├── importers/
│   │   ├── BookmarksImporter.ts
│   │   ├── TabGroupsImporter.ts
│   │   ├── importHelpers.ts
│   │   └── index.ts
│   ├── options/
│   │   ├── main.ts
│   │   └── styles.css
│   └── shared/
│       ├── DuplicateService.ts
│       ├── SearchService.ts
│       ├── StorageService.ts
│       ├── i18n.ts
│       └── types.ts
├── tsconfig.json
└── vite.config.ts
```

### Fase 1: entorno e internacionalización

- El proyecto usa TypeScript estricto, Vite y CSS vanilla.
- `npm run build` ejecuta primero `tsc --noEmit` y después `vite build`.
- `manifest.json` usa Manifest V3, `options_page: "options.html"` y service worker en `background.js`.
- Los permisos requeridos son `storage`, `tabs` y `bookmarks`.
- `tabGroups` se declara como permiso opcional para permitir feature detection y compatibilidad con Firefox Android.
- La interfaz usa `chrome.i18n.getMessage()` para títulos, botones, etiquetas, mensajes y placeholders.
- Existen catálogos para español, inglés y francés.

### Fase 2: persistencia y modelo

- `src/shared/types.ts` define `BaseNode`, `FolderNode`, `TabNode`, `StorageSchema`, `NodeId` y `SortMode`.
- `StorageService` guarda todo el estado bajo la clave `storageSchema` en `chrome.storage.local`.
- La primera lectura crea automáticamente una carpeta raíz con ID `root`.
- Se implementaron `createFolder`, `createTab`, `moveNode`, `renameNode`, `deleteNode`, `updateLastViewedAt`, `findTabsByUrl` y lectura del esquema.
- El movimiento impide mover la raíz, introducir un nodo en sí mismo o crear ciclos de carpetas.
- El borrado de carpetas recorre y elimina todos sus descendientes.
- El ordenamiento soporta título, fecha de creación, última visualización, dominio y URL.
- Los errores de nodos inexistentes, carpetas inválidas y esquemas corruptos se propagan explícitamente.

### Fase 3: importación de datos existentes

- `BookmarksImporter` recorre recursivamente `chrome.bookmarks.getTree()`.
- Las carpetas de marcadores se convierten en carpetas propias y los marcadores con URL en pestañas.
- Las carpetas existentes se reutilizan cuando coinciden por padre y título, evitando duplicar la estructura durante una actualización.
- `TabGroupsImporter` comprueba la existencia de `chrome.tabGroups` antes de usarla.
- Importa grupos abiertos y pestañas con título, URL y favicon.
- Las pestañas importadas correctamente se cierran después de completar la persistencia.
- En entornos sin `tabGroups`, el importador no intenta invocar la API.

### Fase 4: explorador de archivos

- `options.html` contiene un panel izquierdo para el árbol de carpetas y uno derecho para el contenido.
- El árbol y las tarjetas se renderizan con `DocumentFragment`.
- La interfaz es responsiva y táctil para pantallas pequeñas.
- Un clic en una pestaña muestra título, URL, descripción, fecha y captura/favicon.
- Un doble clic abre la URL con `chrome.tabs.create()` y actualiza `lastViewedAt`.
- Las imágenes usan `loading="lazy"`.
- La interfaz permite crear carpetas y muestra errores de operaciones mediante mensajes localizados.

### Fase 5: captura en segundo plano

- `background.ts` escucha mensajes `save-tab` con `tabId` y `parentId` opcional.
- Recupera la pestaña desde `chrome.tabs.get()` y rechaza pestañas sin URL.
- Si existe `chrome.tabs.captureVisibleTab`, captura la pestaña visible.
- La imagen se procesa con `OffscreenCanvas`, se redimensiona a `400x250` y se comprime como WebP con calidad `0.65`.
- Si la captura no está disponible, se guarda `favIconUrl` como alternativa visual.
- El resultado se persiste mediante `StorageService`.

### Fase 6: búsqueda y exportación

- `SearchService` filtra en memoria por título, URL y descripción.
- La interfaz incluye búsqueda instantánea y visualización de resultados.
- `buildNetscapeHtml` genera HTML compatible con el formato estándar de marcadores Netscape.
- `buildCsv` genera las columnas `ID`, `Ruta de Carpetas`, `Título`, `URL` y `Última Vez Visto`.
- `buildTxt` genera una representación plana con ruta, título, URL y última visualización.
- Se escapan caracteres especiales de HTML y comillas de CSV antes de exportar.
- Los archivos se descargan directamente como `bookmarks.html`, `bookmarks.csv` y `bookmarks.txt`.

### Fase 7: actualización, duplicados y orden avanzado

- El botón **Actualizar importación** ejecuta nuevamente los importadores para incorporar datos añadidos después de la primera importación.
- La política de duplicados se aplica por URL normalizada:
  - `ignore`: no guarda la nueva pestaña.
  - `keep`: guarda la nueva pestaña sin cambios.
  - `rename`: guarda la nueva pestaña con un sufijo numérico.
  - `remove`: elimina los nodos existentes con esa URL y guarda la nueva.
- `DuplicateService` normaliza hostname y elimina el fragmento `#hash` para detectar duplicados equivalentes.
- `findDuplicateGroups` agrupa y lista todas las pestañas repetidas.
- La interfaz ofrece un botón **Buscar duplicados** para mostrar esas pestañas.
- Se añadieron selectores de orden por título, creación, última visita, dominio y URL.
- Los valores de los controles se validan antes de llegar a los servicios.

### Fase 8: gestión avanzada de bookmarks

- `src/options/main.ts` implementa drag & drop para folders y nodos en el árbol izquierdo y en las tarjetas del panel derecho.
- Los destinos se validan mediante `StorageService.moveNode`; la raíz no se puede mover y no se permiten ciclos ni movimientos dentro del propio nodo.
- Las carpetas se pueden expandir y colapsar en ambos paneles mediante `expandedFolders`.
- La actualización de importación muestra un estado accesible (`role="status"`, `aria-live`), spinner y barra de progreso entre importadores; el botón se deshabilita durante el proceso.
- El menú contextual ofrece editar, renombrar, quitar, eliminar, copiar, pegar y actualizar miniatura.
- Un menú contextual abierto se cierra cuando se pulsa el botón derecho fuera de un folder, nodo o enlace.
- El cierre del menú contextual se controla en fase de captura del evento y también al perder el foco de la página para evitar que quede visible.
- Se añadió `.context-menu[hidden] { display: none; }` porque el `display: grid` del menú sobrescribía el comportamiento nativo del atributo `hidden`. También se escucha `pointerdown` fuera del menú para cerrarlo inmediatamente.
- `StorageService.copyNode` clona recursivamente carpetas y descendientes con nuevos IDs, manteniendo `parentId` y referencias coherentes.
- El portapapeles interno conserva el ID copiado y pega una copia en el folder objetivo o en el padre de un nodo.
- Los títulos y URLs de las tarjetas usan `overflow-wrap`, `word-break` y `min-width: 0` para ajustarse al recuadro. El atributo `title` muestra el contenido completo como tooltip nativo.
- Las tarjetas muestran screenshot, favicon persistido o un fallback calculado como `origin/favicon.ico`, con recuperación adicional si la primera imagen falla.
- Los importadores persisten un favicon fallback cuando no reciben `favIconUrl`.
- La acción **Actualizar miniatura** solicita al service worker una captura WebP si la URL está abierta en la pestaña activa y la API de captura está disponible; en cualquier otro caso recalcula y guarda el favicon de `origin/favicon.ico`.
- **Actualizar importación** se muestra como “Actualizar importación de grupos y pestañas”.
- La interfaz permite importar un archivo HTML Netscape exportado por este gestor o por otro navegador; las carpetas se reutilizan y las pestañas aplican la política incremental predeterminada.
- El menú contextual de folders del panel derecho ofrece **Crear grupo o marcadores**: usa `tabs.group`/`tabGroups.update` en Chrome y crea una carpeta de marcadores en Firefox u otros entornos sin grupos.
- La actualización de miniaturas activa la pestaña temporal, espera su carga completa, captura después de un breve asentamiento visual, persiste el WebP en el nodo y restaura la pestaña anterior.
- `HtmlBookmarksImporter` usa `DOMParser` para leer archivos Netscape, recorre `DL`, `DT`, `H3` y `A`, reutiliza carpetas por padre/título y guarda URLs importadas con favicon fallback.
- Firefox utiliza `manifest.firefox.json` con `background.scripts` y `type: "module"`; Chrome mantiene `manifest.json` con `background.service_worker`. Esta separación evita el error de Firefox “background.service_worker is currently disabled. Add background.scripts”.
- El botón **Importar pestañas de otro navegador** usa un selector de archivos HTML y procesa exportaciones creadas por esta extensión o por navegadores compatibles con Netscape bookmarks.
- Al crear un grupo nativo, se abren todos los tabs descendientes de la carpeta. En Chrome se agrupan y se les asigna el nombre del folder; en Firefox se crea una carpeta nativa de marcadores y se eliminan las pestañas temporales.
- Cada enlace del panel derecho incluye una casilla de selección múltiple.
- **Seleccionar todos** selecciona o deselecciona los enlaces directos de la carpeta visible; los botones **Copiar seleccionados**, **Quitar seleccionados** y **Eliminar seleccionados** operan sobre el conjunto seleccionado.
- Al arrastrar un enlace seleccionado se arrastra el grupo completo; al soltarlo sobre una carpeta, todos sus nodos se mueven mediante `StorageService.moveNodes`.
- Copiar seleccionados guarda varios IDs en el portapapeles interno y permite pegarlos en grupo mediante `StorageService.copyNodes`. Pegar solo aparece después de copiar.
- La eliminación grupal usa `StorageService.deleteNodes` y mantiene el borrado recursivo de carpetas.
- El motor de captura captura y comprime screenshots cuando es posible; si la captura falla por restricciones del contexto, registra el problema y conserva el fallback favicon en lugar de abortar el guardado.
- La UI muestra qué acción está ejecutando: importación de marcadores, importación de grupos o creación de miniatura. El spinner se oculta al terminar y la barra de progreso se restablece.
- La opción **Pegar** solo se crea en el menú contextual después de seleccionar **Copiar**.
- La política de duplicados se mantiene como comportamiento de importación predeterminado `ignore`; se eliminó el dropdown de estrategias de la interfaz porque no era un control coherente con el flujo actual.
- **Buscar duplicados** muestra un estado de búsqueda, procesa el resultado en un ciclo de UI separado y muestra una confirmación con la cantidad encontrada o un mensaje de ausencia de duplicados.
- Cada enlace ofrece **Abrir pestaña** en el menú contextual.
- **Actualizar miniatura** intenta capturar la URL abierta; si no existe una pestaña activa coincidente, crea temporalmente una pestaña activa, espera su carga, captura el viewport, guarda el WebP, restaura la pestaña anterior y elimina la temporal. Si el entorno lo impide, conserva el favicon.
- Los errores y confirmaciones se muestran en un modal localizado en vez de depender únicamente de `alert`.
- La selección total refresca visualmente las casillas de inmediato y se eliminó **Quitar seleccionados**. Crear carpetas, renombrar nodos y confirmar eliminaciones usan el modal propio con entrada y botones localizados, sin `prompt` ni `confirm` nativos.
- `StorageService` mantiene historial de snapshots para **Deshacer** y **Rehacer**, con botones que reflejan si existe una operación disponible.

### Validación realizada

### Correcciones adicionales de gestión

- El drag & drop fusiona automáticamente carpetas con el mismo nombre. La fusión recorre subcarpetas homónimas, mueve el resto de contenidos y elimina pestañas duplicadas comparando URL normalizada.
- El árbol izquierdo ofrece ordenación por nombre, cantidad de enlaces descendientes o cantidad de subnodos, mostrando un contador junto a cada carpeta.
- El panel derecho añade un checkbox para mostrar carpetas primero.
- La copia de uno o varios nodos mantiene el portapapeles interno y escribe simultáneamente texto plano en el portapapeles del sistema para pegarlo en aplicaciones externas sin formato.
- La importación informa por separado cuántas pestañas y grupos se guardaron. En Chrome consulta `chrome.tabGroups` y `chrome.tabs`, usa `group.title` como nombre de la carpeta importada y declara el permiso `tabGroups`; Firefox conserva la detección de API y no invoca grupos si no están disponibles.
- La vista de detalles ahora muestra la ruta completa de carpetas y subcarpetas donde está almacenada cada pestaña, también cuando se accede desde resultados de búsqueda.
- El fallback visual valida el protocolo y el hostname antes de generar el favicon; para URLs locales o no compatibles omite la imagen en lugar de intentar cargar `file:///favicon.ico`.
- Se añadió **Listar carpetas vacías**, una vista global que identifica carpetas no raíz sin enlaces descendientes y permite abrirlas desde sus tarjetas como cualquier otra carpeta.
- Las carpetas ahora tienen checkbox de selección en ambos paneles. Las acciones grupales de seleccionar todos, copiar, arrastrar y eliminar incluyen carpetas además de enlaces.
- Al seleccionar o deseleccionar todos, se sincronizan inmediatamente todos los checkboxes visibles del nodo en ambos paneles.
- **Seleccionar todos** usa únicamente los nodos renderizados en el panel derecho, incluidos resultados filtrados o carpetas vacías; **Deseleccionar todos** elimina todos los IDs seleccionados globalmente.

### Autoría, sincronización y propuesta comercial

- **Autor:** Daniel Esteban Arias.
- **Email:** `dariassoft@gmail.com`.
- **Perfil:** https://www.linkedin.com/in/danielestebanarias
- La sincronización automática de `chrome.storage.sync` y su equivalente Firefox fue deshabilitada por sus cuotas y limitaciones.
- La transferencia entre dispositivos usa un backup ZIP cifrado con la contraseña maestra. La interfaz permite descargarlo e importarlo localmente.
- El ZIP contiene un payload cifrado/comprimido y un README con instrucciones para subirlo manualmente a Google Drive y descargarlo en otro dispositivo.
- La integración directa con Google Drive no se activa en esta versión: requiere OAuth, permisos de Drive, revisión de privacidad y una gestión adicional de tokens. El flujo manual evita exponer credenciales o datos a un tercero.

### Sincronización con marcadores para Chrome Android

- Chrome Android no ejecuta esta extensión, por lo que se añadió **Sincronizar con marcadores del navegador**.
- La función crea o reutiliza una carpeta administrada llamada `Gestor de pestañas` y reemplaza exactamente su contenido con todas las carpetas y enlaces de la extensión.
- Solo se eliminan los descendientes de la carpeta administrada; los marcadores existentes fuera de ella se conservan, según el alcance elegido para evitar pérdida accidental.
- La operación es recursiva, pide confirmación y usa `chrome.bookmarks`; los cambios pueden propagarse mediante la sincronización nativa del navegador hacia Chrome Android.
- La información se cifra antes de persistirse en `storage.local` o `storage.sync`. La contraseña maestra permanece solo en memoria durante la sesión; PBKDF2-SHA-256 con 250.000 iteraciones deriva una clave AES-256-GCM, usando salt e IV aleatorios por escritura.
- Al abrir la extensión se solicita la contraseña maestra; la configuración inicial exige repetirla. Las instalaciones antiguas con datos sin cifrar se migran tras desbloquearse. No existe recuperación de contraseña para evitar que terceros puedan descifrar el contenido.
- El producto resuelve dos problemas: reduce RAM al mantener pestañas guardadas como datos estáticos y ofrece una organización superior a los marcadores nativos mediante carpetas, grupos, búsqueda, filtros, duplicados, ordenación, selección múltiple y apertura bajo demanda.
- Feature adicional recomendada para diferenciarse: suspensión inteligente de pestañas inactivas con reglas por dominio, vista previa, exclusiones y restauración de sesiones completas. Es una función directamente relacionada con el ahorro de memoria y perceptible por el usuario.
- Modelo recomendado para el MVP: **15 días gratis y USD 2 de pago único**. Es preferible a USD 1 mensual porque el producto es utilitario y de bajo precio; una versión totalmente gratuita con donaciones reduce la conversión, aunque puede mantenerse como alternativa para usuarios no comerciales.
- Speech de venta: “Recupera memoria sin perder tu trabajo. Gestor de pestañas guarda tus pestañas y grupos fuera de la memoria activa, los organiza con carpetas, búsquedas, filtros y duplicados, y los abre solo cuando los necesitas. Disfruta una navegación más rápida, una organización más clara que los marcadores nativos y sincroniza tu biblioteca entre tus dispositivos. Prueba 15 días y desbloquea todo por solo USD 2, pago único.”

La compilación actual se valida con:

```bash
npm run build
```

Este comando realiza comprobación estricta de tipos y genera el paquete de extensión en `dist/`.