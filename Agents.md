# Guía para agentes

## Objetivo del proyecto

Construir una extensión de navegador multiplataforma para Chrome y Firefox que permita guardar, organizar y abrir pestañas bajo demanda. Las pestañas guardadas deben permanecer como datos estáticos para reducir el consumo de RAM; solo se cargan en el navegador cuando el usuario las abre.

La extensión debe funcionar en escritorio y Firefox Android, con una interfaz táctil y responsiva basada en una página de opciones completa (`options.html`), no en un popup estrecho. La interfaz debe permitir organizar bookmarks con drag & drop y menús contextuales.

## Stack y restricciones técnicas

- TypeScript compilado a JavaScript ES6+ nativo.
- Vite para compilación y empaquetado.
- CSS3 vanilla con Custom Properties; no incorporar frameworks de CSS.
- WebExtensions API compatible con Manifest V3.
- Persistencia en `chrome.storage.local` (usar la API equivalente de Firefox cuando corresponda mediante un adaptador).
- Mantener el bundle ligero y evitar dependencias innecesarias.
- Toda operación de API debe ser asíncrona y manejar explícitamente sus errores.
- Usar detección de características antes de invocar APIs no disponibles:
  - `chrome.tabGroups` solo debe utilizarse cuando exista.
  - `chrome.tabs.captureVisibleTab` solo debe utilizarse cuando exista y el contexto lo permita.
- No asumir que las APIs de escritorio están disponibles en Android.

## Arquitectura esperada

Separar el código por responsabilidades:

- `background.ts`: service worker, eventos de guardado y captura de contenido.
- `StorageService.ts`: inicialización, lectura y escritura del esquema persistente y operaciones CRUD.
- Importadores: marcadores y grupos de pestañas.
- Exportadores: HTML Netscape, CSV y TXT.
- UI de opciones: árbol jerárquico, panel de detalles, búsqueda y acciones del usuario.
- Utilidades compartidas: ordenamiento, recorrido del árbol, detección de capacidades, i18n y normalización de datos.
- Interacciones avanzadas del explorador: drag & drop, carpetas colapsables, menús contextuales y portapapeles interno.

Antes de crear una utilidad nueva, buscar una implementación existente que pueda reutilizarse. Mantener tipos estrictos y evitar `any` y conversiones de tipo innecesarias.

## Modelo de datos

El estado debe ajustarse a este modelo:

```ts
export interface BaseNode {
  id: string;
  parentId: string | null;
  title: string;
  type: 'folder' | 'tab';
  createdAt: number;
  lastViewedAt: number;
}

export interface FolderNode extends BaseNode {
  type: 'folder';
  children: string[];
}

export interface TabNode extends BaseNode {
  type: 'tab';
  url: string;
  screenshot?: string;
  faviconUrl?: string;
  description?: string;
}

export interface StorageSchema {
  rootFolderId: string;
  nodes: Record<string, FolderNode | TabNode>;
}
```

`StorageService` debe crear la carpeta raíz en la primera ejecución. Al eliminar una carpeta, borrar recursivamente todos sus descendientes y evitar nodos huérfanos. El orden de los hijos debe poder calcularse por título, fecha de creación o `lastViewedAt`.

## Internacionalización

Crear `_locales/es/messages.json`, `_locales/en/messages.json` y `_locales/fr/messages.json`. Todo texto visible para el usuario debe proceder de `chrome.i18n.getMessage()`; no introducir textos de interfaz codificados directamente en HTML, TypeScript o CSS.

## Reglas de comportamiento

- Importar marcadores recorriendo recursivamente `chrome.bookmarks.getTree()`.
- Convertir carpetas de marcadores en carpetas propias y marcadores en nodos de pestaña.
- En escritorio, importar grupos abiertos solo si `tabGroups` está disponible; mapear nombre, color y URLs, y cerrar el grupo original después de importar correctamente para liberar memoria.
- Un clic simple sobre una pestaña guardada muestra sus detalles.
- Un doble clic ejecuta `chrome.tabs.create({ url })` y actualiza inmediatamente `lastViewedAt`.
- En escritorio, capturar la pestaña visible y comprimir la imagen mediante Offscreen Canvas a aproximadamente `400x250` en WebP.
- En Android o cuando la captura no esté disponible, omitirla y usar `favIconUrl` como representación visual.
- Buscar en memoria por `title`, `url` y `description` para ofrecer resultados instantáneos.
- Renderizar listas grandes con `DocumentFragment` y cargar visuales del panel derecho de forma perezosa.
- Folders y nodos deben poder arrastrarse y soltarse en los paneles izquierdo y derecho, con validación de ciclos y destinos.
- Las carpetas del panel derecho deben poder expandirse y colapsarse.
- Las importaciones deben mostrar un estado de progreso o espera, incluyendo finalización y error.
- El click derecho sobre folders y nodos debe ofrecer editar, quitar, eliminar, renombrar, copiar y pegar.
- Un menú contextual abierto debe cerrarse al hacer click derecho fuera de un folder, nodo o enlace.
- La opción Pegar solo debe aparecer después de seleccionar Copiar.
- Las acciones de importación y actualización de miniaturas deben mostrar el texto de la acción y detener el indicador al completarse o fallar.
- Los errores de la interfaz deben mostrarse en un modal localizado con contexto útil.
- Las operaciones persistentes deben soportar Deshacer y Rehacer.
- El menú contextual de una pestaña debe incluir **Abrir pestaña**.
- El botón de actualización debe estar rotulado **Actualizar importación de grupos y pestañas**.
- Debe existir un control para importar archivos HTML Netscape exportados por este gestor o por otros navegadores.
- El menú contextual de un folder debe ofrecer crear un grupo de pestañas en Chrome o una carpeta de marcadores en Firefox, abriendo todos los tabs descendientes.
- La importación HTML debe procesar la jerarquía Netscape de forma recursiva, reutilizar carpetas y aplicar la política de duplicados configurada por el flujo.
- Cada nodo de tipo tab debe ofrecer checkbox de selección múltiple.
- Debe existir **Seleccionar todos** para los tabs directos de la carpeta actual y acciones grupales de copiar, quitar y eliminar.
- Arrastrar un tab seleccionado debe transportar todos los IDs seleccionados y moverlos juntos al folder destino.
- Copiar y pegar debe admitir múltiples nodos y conservar la jerarquía de carpetas copiadas.
- No mostrar en la UI un selector de estrategia de duplicados que no esté conectado a una decisión clara; la importación incremental usa `ignore` como política predeterminada.
- La búsqueda de duplicados debe mostrar estado de proceso y resultado, sin bloquear el hilo de renderizado.
- Cuando un componente usa `display` propio, añadir una regla explícita para `[hidden]`; de lo contrario el estilo del componente puede sobrescribir el ocultamiento nativo.

## Interfaz

La página de opciones debe tener:

- Panel izquierdo con árbol jerárquico expandible y contraíble.
- Panel derecho con el contenido de la carpeta seleccionada en cuadrícula o lista.
- Vista de detalles para una pestaña guardada.
- Controles para crear, mover, renombrar y eliminar nodos.
- Diseño responsivo y usable con interacción táctil en Firefox Android.

## Exportación

Implementar:

1. HTML estándar de marcadores Netscape, incluyendo `NETSCAPE-Bookmark-file-1`, `DL`, `p`, `DT`, carpetas y enlaces.
2. CSV con las columnas `ID`, `Ruta de Carpetas`, `Título`, `URL` y `Última Vez Visto`.
3. TXT plano con el árbol aplanado y rutas de carpetas.

Las exportaciones deben escapar correctamente HTML, CSV y texto para no corromper datos con comillas, saltos de línea o caracteres especiales.

## Orden de implementación

1. Configurar Vite, TypeScript, Manifest V3, `options.html` y la estructura de directorios.
2. Añadir i18n para español, inglés y francés.
3. Implementar tipos y `StorageService`, incluyendo CRUD y eliminación recursiva.
4. Implementar importadores de marcadores y grupos de pestañas con feature detection.
5. Construir la UI del explorador y el comportamiento de apertura bajo demanda.
6. Añadir el motor de captura del service worker con la alternativa para Android.
7. Añadir búsqueda indexada y exportadores.
8. Implementar gestión avanzada de bookmarks: drag & drop, carpetas colapsables, progreso de importación y menú contextual.
9. Revisar compatibilidad Chrome/Firefox, escritorio/Android, rendimiento y accesibilidad.

## Calidad y validación

- Mantener cambios pequeños, coherentes y limitados al alcance de la tarea.
- No romper compatibilidad móvil por asumir APIs de escritorio.
- Validar tipos, compilación y las pruebas existentes después de cada cambio relevante.
- Añadir o actualizar pruebas para CRUD, eliminación recursiva, ordenamiento, búsqueda, importación y escape de exportaciones cuando exista infraestructura de pruebas.
- No ocultar errores con capturas amplias ni valores predeterminados silenciosos; informar o propagar los fallos siguiendo el patrón del proyecto.
- No modificar archivos de configuración de WebStorm (`.idea/`) salvo que sea estrictamente necesario para el desarrollo.

## Implementación disponible actualmente

### Comandos y empaquetado

- `npm run build`: comprueba tipos con TypeScript y genera el paquete Vite en `dist/`.
- `npm run dev`: inicia Vite para desarrollo.
- El proyecto usa `typescript`, `vite`, `@types/chrome` y `@types/node` como dependencias de desarrollo.
- `dist/` y `node_modules/` están excluidos mediante `.gitignore`.
- El entrypoint de Vite es `options.html`; el service worker se genera como `background.js`.
- El paquete incluye `public/manifest.json` para Chrome MV3 y `public/manifest.firefox.json` para Firefox MV3, donde Firefox usa `background.scripts` porque el soporte `background.service_worker` puede estar deshabilitado.
- Para cargar temporalmente en Firefox, seleccionar `dist/manifest.firefox.json` en `about:debugging`, no el manifest de Chrome.

### Persistencia

La implementación de `StorageService` está en `src/shared/StorageService.ts` y utiliza la clave `storageSchema` de `chrome.storage.local`. La lectura inicial crea una carpeta raíz con ID estable `root`. Las operaciones disponibles son creación de carpetas y pestañas, movimiento, renombrado, borrado recursivo, actualización de `lastViewedAt`, búsqueda por URL y ordenamiento.

El servicio debe conservar invariantes: la raíz no puede moverse ni eliminarse, una pestaña solo puede pertenecer a una carpeta, una carpeta no puede moverse a un descendiente y no deben quedar referencias a nodos borrados. Los métodos lanzan errores para nodos inexistentes, padres inválidos, ciclos o esquemas corruptos.

### Importadores y actualización incremental

Los importadores viven en `src/importers/`. `BookmarksImporter` recorre el árbol de marcadores y reutiliza carpetas que ya existen bajo el mismo padre y con el mismo título. `TabGroupsImporter` solo usa `chrome.tabGroups` cuando la API existe, importa las pestañas agrupadas y cierra las pestañas importadas tras guardar sus datos.

Ambos importadores aceptan `ImportOptions` y pueden ejecutarse varias veces. La acción **Actualizar importación** de la UI vuelve a ejecutar ambos motores para incorporar nuevos datos posteriores a la importación inicial.

### Políticas de duplicados

`src/shared/DuplicateService.ts` define `DuplicateStrategy`:

- `ignore`: descarta la nueva pestaña.
- `keep`: conserva también la nueva pestaña.
- `rename`: conserva la nueva pestaña con un sufijo numérico en el título.
- `remove`: elimina duplicados existentes antes de guardar la nueva pestaña.

La comparación usa URL normalizada: hostname en minúsculas y fragmento eliminado. `findDuplicateGroups` devuelve grupos con dos o más pestañas equivalentes; la UI los lista mediante **Buscar duplicados**.

### UI del explorador

`src/options/main.ts` controla el árbol de carpetas, la carpeta seleccionada, búsqueda, duplicados, ordenamiento, creación de carpetas y exportaciones. El panel derecho muestra tarjetas de carpetas o pestañas. El clic simple muestra detalles; el doble clic abre una pestaña y actualiza su timestamp.

Para listas grandes, usar `DocumentFragment`, evitar reconstrucciones innecesarias y conservar `loading="lazy"` en imágenes. La búsqueda opera en memoria mediante `SearchService` sobre `title`, `url` y `description`.

### Capturas y fallback móvil

El service worker de `src/background.ts` recibe mensajes con esta forma:

```ts
{
  type: 'save-tab',
  tabId: number,
  parentId?: string
}
```

En escritorio intenta `chrome.tabs.captureVisibleTab`, procesa la imagen con `OffscreenCanvas` a `400x250` y la guarda como WebP. Cuando la API no existe o el entorno no permite la captura, debe usarse el favicon de la pestaña, sin invocar APIs de escritorio de forma incondicional.

### Exportadores

`src/exporters/index.ts` expone constructores de contenido y una función de descarga:

- `buildNetscapeHtml(schema)`
- `buildCsv(schema)`
- `buildTxt(schema)`
- `downloadExport(content, filename, mimeType)`

El HTML debe conservar la jerarquía, el CSV debe escapar comillas y el HTML debe escapar entidades especiales. Las exportaciones de la UI usan `bookmarks.html`, `bookmarks.csv` y `bookmarks.txt`.

### Ordenamiento

`SortMode` admite `title`, `createdAt`, `lastViewedAt`, `domain` y `url`. El orden por dominio obtiene el hostname en minúsculas; las URLs no válidas se ordenan de forma segura sin interrumpir la interfaz. Los controles de la UI validan sus valores antes de pasarlos a `StorageService`.

### Fase 8: gestión avanzada de bookmarks

La Fase 8 está implementada en `src/options/main.ts`, `src/options/styles.css` y `src/shared/StorageService.ts` sin romper las invariantes del árbol:

- Hacer arrastrables folders y nodos en el árbol izquierdo y en el contenido derecho.
- Permitir soltar sobre folders válidos y rechazar la raíz, el propio nodo y cualquier descendiente de una carpeta movida.
- Renderizar folders anidados del panel derecho con controles de expansión y colapso.
- Mostrar en importaciones un indicador accesible de espera/progreso/finalización/error; el control debe quedar habilitado al finalizar.
- Añadir un menú contextual localizado para editar, quitar, eliminar, renombrar, copiar y pegar.
- Cerrar el menú contextual cuando el evento `contextmenu` ocurre fuera de sus elementos objetivo.
- Crear la acción **Actualizar miniatura** con estado de progreso; intentar screenshot WebP desde la pestaña activa y persistir favicon como fallback.
- Mantener Pegar oculto hasta que exista un nodo en el portapapeles interno.
- Mostrar errores y resultados importantes mediante el modal localizado de `options.html`.
- Mostrar **Abrir pestaña** para nodos de tipo tab y actualizar `lastViewedAt` después de abrir.
- Exponer `canUndo`, `canRedo`, `undo` y `redo` en `StorageService`; conservar snapshots completos para no dejar referencias huérfanas.
- Añadir **Actualizar miniatura** al menú contextual. La acción solicita al service worker una captura WebP de la pestaña activa; si la URL no está abierta, puede crear una pestaña temporal activa, esperar la carga, capturar, guardar el screenshot, restaurar la pestaña anterior y cerrar la temporal. Si no es posible, guarda un favicon derivado de `origin/favicon.ico`. La UI usa screenshot, favicon persistido o fallback calculado.
- Para asegurar que la captura temporal se persista, activar explícitamente la pestaña, esperar `status: complete` y un asentamiento corto, volver a obtener el objeto `Tab`, y solo entonces llamar a `captureVisibleTab`.
- `HtmlBookmarksImporter` procesa formato Netscape mediante `DOMParser`, importa carpetas recursivamente y reutiliza `saveImportedTab`.
- `openFolderAsGroup` abre todos los tabs descendientes; en Chrome crea y titula un grupo, y sin `tabGroups` crea una carpeta nativa de bookmarks y elimina las pestañas temporales.
- Mantener `tabs.group` protegido por detección de características; Firefox debe seguir el camino de bookmarks sin invocar APIs de grupos.
- Corregir tarjetas para que títulos y URLs hagan wrap dentro de sus límites y expongan el valor completo mediante `title`.
- `StorageService.updateTabVisuals` actualiza los visuales persistidos sin reemplazar otros metadatos.
- `StorageService.copyNode` copia recursivamente folders y nodos con IDs nuevos, preservando la jerarquía y sin crear referencias huérfanas.
- `StorageService.moveNodes`, `copyNodes` y `deleteNodes` ejecutan operaciones grupales respetando las validaciones existentes.
- Implementar un portapapeles interno para copiar y pegar nodos, evitando referencias huérfanas y aplicando las validaciones existentes.
- Todas las acciones visibles deben usar `chrome.i18n.getMessage()` y contar con mensajes en `es`, `en` y `fr`.
- Añadir pruebas para drag & drop, ciclos, pegado de carpetas con descendientes, menú contextual y estados de importación cuando exista infraestructura de pruebas.

### Reglas para continuar el desarrollo

- Mantener los importadores idempotentes para carpetas y aplicar siempre la política elegida a pestañas duplicadas.
- Ejecutar `npm run build` después de cambios en TypeScript, manifest, Vite o los catálogos.
- Al añadir texto visible o accesible, agregarlo a los tres archivos `_locales/*/messages.json` y usar el helper de i18n.
- Probar tanto APIs disponibles como ausentes (`tabGroups`, `captureVisibleTab`) antes de cerrar una tarea.
- No añadir frameworks de UI ni dependencias de alto peso.
- Al soltar una carpeta sobre otra carpeta con el mismo nombre, o sobre su carpeta padre cuando ya existe una subcarpeta con ese nombre, `StorageService.mergeFolders` fusiona recursivamente las carpetas y descarta pestañas duplicadas por URL normalizada.
- El árbol izquierdo permite ordenar carpetas por nombre, cantidad de enlaces descendientes o cantidad total de subnodos, y muestra un contador compacto por carpeta.
- El panel derecho incluye la casilla **Mostrar carpetas primero**, independiente del criterio de ordenamiento de nodos.
- Copiar nodos conserva el portapapeles interno para pegar dentro de la extensión y también escribe una representación de texto plano en el portapapeles del sistema, incluyendo rutas, títulos y URLs.
- La importación muestra por separado el total de pestañas y grupos importados. En Chrome, `TabGroupsImporter` consulta `chrome.tabGroups` y `chrome.tabs`, conserva `group.title` como nombre de carpeta y requiere el permiso `tabGroups`; en Firefox continúa protegido por detección de capacidades.
- Los detalles de una pestaña incluyen la ruta completa de carpetas y subcarpetas desde la raíz hasta el nodo.
- Los fallbacks de favicon solo generan `/favicon.ico` para URLs HTTP/HTTPS con hostname válido; las URLs `file:`, `chrome:` y otras URLs sin origen no provocan cargas locales inválidas como `file:///favicon.ico`.
- La UI incluye **Listar carpetas vacías**, que muestra todas las carpetas no raíz sin enlaces descendientes, incluyendo carpetas que solo contienen subcarpetas vacías.
- Las carpetas son seleccionables mediante checkbox en el árbol izquierdo y en las tarjetas del panel derecho; **Seleccionar todos**, copiar, arrastrar y eliminar respetan también carpetas seleccionadas.
- Autoría y contacto: **Daniel Esteban Arias**, `dariassoft@gmail.com`, [LinkedIn](https://www.linkedin.com/in/danielestebanarias).
- La sincronización automática de `chrome.storage.sync` fue deshabilitada por sus cuotas y limitaciones. El estado se conserva cifrado en `chrome.storage.local`.
- La transferencia entre dispositivos se realiza mediante copias ZIP cifradas con la contraseña maestra. La extensión permite descargar y abrir esos archivos localmente.
- Para respetar la cuota por elemento de Chrome, el esquema sincronizado se serializa en fragmentos de aproximadamente 3.5 KB y usa un manifiesto de chunks; las capturas no se incluyen.
- Los backups ZIP contienen un payload cifrado y comprimido, además de un README con instrucciones para subirlo manualmente a Google Drive.
- En Chrome Android, donde no se cargan extensiones, **Sincronizar con marcadores del navegador** reconstruye exactamente el contenido de la extensión dentro de una carpeta administrada llamada `Gestor de pestañas`. Borra y vuelve a crear solo los hijos de esa carpeta; los marcadores ajenos se conservan.
- La operación usa `chrome.bookmarks`, recorre carpetas y pestañas recursivamente, pide confirmación y muestra progreso/resultado. La sincronización de Chrome propagará esa carpeta a los dispositivos Android.
- La persistencia local y sincronizada usa cifrado de extremo a extremo del lado cliente: contraseña maestra del usuario, PBKDF2-SHA-256 con 250.000 iteraciones para derivar la clave y AES-256-GCM con salt e IV aleatorios por escritura. La contraseña nunca se guarda ni se sincroniza.
- La interfaz solicita la contraseña maestra al iniciar, exige confirmación durante la configuración inicial y no permite leer el esquema sin desbloquearlo. Los datos antiguos sin cifrar se migran inmediatamente después del desbloqueo.
- La contraseña no se puede recuperar. Perderla implica perder acceso a los datos cifrados; no debe añadirse una recuperación que exponga la clave.

## Propuesta de valor y monetización

- Diferenciador principal: descargar pestañas de la memoria sin perderlas, con una organización más flexible que el administrador nativo, búsqueda, filtros, grupos, rutas, duplicados, ordenación y sincronización entre dispositivos del mismo navegador.
- Feature premium recomendada: **modo inteligente de suspensión y restauración**, que detecte pestañas inactivas, guarde estado visual/metadatos, proponga liberar memoria y restaure una sesión completa con un clic. Debe incluir revisión previa, exclusiones por dominio y recuperación segura.
- Para el lanzamiento inicial se recomienda una prueba gratuita de 15 días y pago único de **USD 2**, porque el valor es utilitario, el precio es fácil de entender y evita la fricción de una suscripción mensual. Mantener una versión gratuita limitada o aceptar donaciones puede servir como alternativa comunitaria, pero una suscripción de USD 1 mensual añade complejidad y poca ventaja a este precio.
- Speech comercial: “Recupera memoria sin perder tu trabajo. Gestor de pestañas guarda tus pestañas y grupos fuera de la memoria activa, los organiza con carpetas, búsquedas, filtros y duplicados, y los abre solo cuando los necesitas. Disfruta una navegación más rápida, una organización más clara que los marcadores nativos y sincroniza tu biblioteca entre tus dispositivos. Prueba 15 días y desbloquea todo por solo USD 2, pago único.”
- El refresco de selección actualiza todos los checkboxes renderizados del nodo, incluidos los duplicados visuales del árbol izquierdo y del panel derecho.
- **Seleccionar todos** opera sobre los nodos actualmente visibles en el panel derecho, respetando búsqueda, filtros y la vista de carpetas vacías; **Deseleccionar todos** limpia globalmente la selección.
- **Seleccionar todos** actualiza inmediatamente el estado visual de cada casilla; se eliminó la acción **Quitar seleccionados**.
- Crear carpetas, renombrar nodos y confirmar eliminaciones usan el modal propio con entrada y botones localizados, sin `prompt` ni `confirm` nativos.
