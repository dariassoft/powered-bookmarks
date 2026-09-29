# Arquitectura híbrida y despliegue

## Componentes

- **Extensión Chrome/Firefox:** conserva acceso a pestañas, grupos, marcadores, capturas y almacenamiento local cifrado.
- **Web (`apps/web`):** inicia sesión con Google, descifra el árbol en el navegador, permite gestionarlo y sincroniza sobres cifrados.
- **API NestJS (`apps/api`):** valida Google OIDC, vincula dispositivos, controla revisiones e historial, registra conflictos y procesa Stripe. Nunca recibe la contraseña maestra.
- **Compartido (`packages/shared`):** contratos de datos y cifrado interoperable PBKDF2-SHA-256/AES-256-GCM.
- **PostgreSQL:** usuarios, dispositivos, historial de sobres cifrados, conflictos, suscripciones y eventos Stripe.
- **Redis:** reservado para límites de frecuencia, colas y sesiones efímeras al escalar; la API actual usa JWT sin estado.

## Flujo de seguridad

1. Google entrega un ID token a la web y la API valida firma, audiencia y correo verificado.
2. El usuario introduce la contraseña maestra únicamente en el cliente.
3. Web Crypto deriva una clave con PBKDF2-SHA-256 (250.000 iteraciones) y cifra con AES-256-GCM.
4. La API almacena el sobre, su hash y una revisión monotónica. No indexa títulos ni URLs porque están cifrados.
5. Una escritura basada en una revisión antigua responde `409 VAULT_REVISION_CONFLICT` y conserva el intento para recuperación.
6. La extensión pide un código en `POST /api/device-links`; la web lo aprueba y la extensión canjea un JWT revocable asociado a un dispositivo.
7. La extensión cifra el árbol con el módulo compartido, sube cambios con revisión base y exige confirmación antes de reemplazar el estado local con una revisión remota.

## API principal

- `POST /api/auth/google`
- `POST /api/device-links`, `POST /api/device-links/approve`, `POST /api/device-links/token`
- `GET /api/devices`, `DELETE /api/devices/:id`
- `GET /api/vault`, `PUT /api/vault`, `GET /api/vault/history`
- `GET /api/billing/license`, `POST /api/billing/checkout`
- `POST /api/billing/webhook`
- `GET /api/health`

## Desarrollo local

1. Copiar `.env.example` a `.env` y reemplazar todas las credenciales.
2. Crear un cliente web OAuth en Google Cloud con el origen autorizado de la web.
3. Crear un precio recurrente en Stripe y configurar el webhook a `/api/billing/webhook`.
4. Ejecutar `npm install`, `npm run build` y `docker compose up --build`.
5. Abrir `http://localhost:8080`.

## Vincular la extensión

1. Iniciar sesión en el sitio web y desbloquear la bóveda con la contraseña maestra.
2. En la extensión, pulsar **Vincular dispositivo** y copiar el código mostrado. La extensión usa automáticamente `https://tabs.dariassoft.com.ar/api`; el usuario no debe introducir ni configurar la URL.
3. Introducir el código en **Vincular extensión** dentro del sitio y aprobarlo.
4. Volver a la extensión y pulsar **Comprobar aprobación**. El JWT del dispositivo queda en almacenamiento local y puede revocarse desde la web.
5. **Subir cambios** cifra el árbol local y usa la última revisión conocida. Un `409` nunca sobrescribe silenciosamente cambios remotos.
6. **Descargar versión** requiere confirmación, descifra localmente y guarda el resultado otra vez bajo el cifrado local de la extensión.

La contraseña maestra vive únicamente en memoria mientras la página de opciones está abierta. Ni el código de vinculación, ni el JWT ni las peticiones REST contienen esa contraseña.

## Suspensión inteligente y recuperación

La página de opciones analiza `lastAccessed` de las pestañas, excluye pestañas activas, fijadas, con audio, ya descartadas, URLs internas y los dominios configurados por el usuario. Presenta una estimación conservadora de `~50 MB` por pestaña porque WebExtensions no ofrece memoria por pestaña de forma portable.

Se puede suspender una pestaña, un grupo o todas las candidatas mediante `chrome.tabs.discard`, conservando título, URL, favicon, posición y grupo en el navegador. Antes de cada operación se crea un punto de recuperación local; se mantienen los 20 más recientes y **Deshacer última** recarga las pestañas descartadas o vuelve a crear las que ya no existan. En navegadores sin `tabs.discard` se informa que la función no está disponible en lugar de cerrar pestañas de forma insegura.

## Dokploy

Usar el repositorio y `docker-compose.yml` como proyecto Compose. Configurar las variables del ejemplo como secretos de Dokploy, publicar únicamente el servicio `web`, asociar el dominio HTTPS y registrar ese dominio en Google OAuth, `WEB_URL` y `WEB_ORIGINS`. PostgreSQL y Redis no deben exponer puertos públicos.

`DB_SYNCHRONIZE=false` es el valor recomendado y predeterminado. Al arrancar, la API ejecuta las migraciones TypeORM pendientes y registra su estado en PostgreSQL. Los comandos `npm run migration:show --workspace @bookmarks/api`, `migration:run` y `migration:revert` permiten administrarlas manualmente. `DB_SYNCHRONIZE=true` queda reservado para desarrollo efímero y desactiva `migrationsRun` para evitar mezclar ambos mecanismos.

## Despliegue completo en un VPS con Dokploy

### 1. Preparar DNS y proveedores

1. En el proveedor DNS de `dariassoft.com.ar`, crear un registro `A` con nombre `tabs` y valor igual a la IPv4 pública del VPS. Si el VPS dispone de IPv6 estable, agregar también un registro `AAAA`; de lo contrario, no crearlo. Esperar a que `dig +short tabs.dariassoft.com.ar` devuelva la IP correcta antes de solicitar TLS.
2. En Google Cloud crear credenciales **Web application**. Añadir exactamente `https://tabs.dariassoft.com.ar` a **Authorized JavaScript origins**; no se necesita una URI de redirección porque Google Identity Services entrega el ID token en el navegador. Copiar el Client ID, no el Client Secret.
3. En Stripe crear un producto y un precio recurrente. Copiar el identificador `price_...`, usar una clave secreta `sk_live_...` en producción y crear el webhook `https://tabs.dariassoft.com.ar/api/billing/webhook`. Copiar su secreto `whsec_...`. Antes del lanzamiento se recomienda repetir este paso en modo prueba con `sk_test_...` y un precio de prueba.
4. En el firewall publicar solo `22`, `80` y `443`. PostgreSQL `5432`, Redis `6379` y API `3000` deben quedar dentro de la red Compose.

### 2. Configurar Dokploy

1. Subir el repositorio a GitHub/GitLab y crear en Dokploy un proyecto y una aplicación de tipo **Docker Compose**. Conectar el repositorio, seleccionar la rama de producción, indicar `docker-compose.yml` y dejar la raíz del repositorio como contexto.
2. En **Domains**, asociar `tabs.dariassoft.com.ar` únicamente al servicio `web`, con puerto interno `80`, HTTPS/Let's Encrypt y redirección HTTP a HTTPS. No crear dominios para `api`, `postgres` o `redis`: Nginx sirve la web y reenvía internamente `/api/*` a `api:3000`.
3. Definir como secretos las variables de `.env.example`. Para producción usar:

```dotenv
POSTGRES_DB=tabvault
POSTGRES_USER=tabvault
POSTGRES_PASSWORD=<contraseña-aleatoria-larga>
REDIS_PASSWORD=<contraseña-aleatoria-larga>
JWT_SECRET=<mínimo-32-bytes-aleatorios>
GOOGLE_CLIENT_ID=<id-real>.apps.googleusercontent.com
STRIPE_SECRET_KEY=sk_live_<valor-real>
STRIPE_WEBHOOK_SECRET=whsec_<valor-real>
STRIPE_PRICE_ID=price_<valor-real>
WEB_URL=https://tabs.dariassoft.com.ar
WEB_ORIGINS=https://tabs.dariassoft.com.ar
WEB_PORT=8080
VITE_API_URL=/api
DB_SYNCHRONIZE=false
```

4. Confirmar que Dokploy conserva los volúmenes nombrados `postgres_data` y `redis_data`. Pulsar **Deploy**. Compose construye dos imágenes: `api` compila NestJS y arranca `apps/api/dist/main.js`; `web` compila Vite, copia `apps/web/dist` a Nginx y configura el proxy `/api`.
5. Esperar a que `postgres` y `redis` estén saludables; entonces arranca `api`, ejecuta automáticamente las migraciones pendientes con `DB_SYNCHRONIZE=false`, y finalmente arranca `web`. Si falla una etapa, revisar los logs de ese servicio antes de reintentar.
6. Una actualización normal consiste en publicar el commit, solicitar un nuevo deploy y revisar primero migraciones y logs de `api`. No cambiar a `DB_SYNCHRONIZE=true` para solucionar una migración fallida.

#### Qué queda publicado

- `https://tabs.dariassoft.com.ar/` sirve los archivos estáticos de la web desde Nginx.
- `https://tabs.dariassoft.com.ar/api/*` llega al mismo Nginx y se reenvía a NestJS dentro de la red privada de Compose.
- NestJS no necesita otro subdominio ni exponer el puerto `3000`; PostgreSQL y Redis tampoco tienen puertos públicos.
- `VITE_API_URL=/api` se incorpora al JavaScript durante el build. Si se cambia, es obligatorio reconstruir la imagen web; reiniciar el contenedor no modifica un bundle ya compilado.

### 3. Pruebas de infraestructura después del deploy

Ejecutar desde otro equipo, no desde el propio VPS, para validar DNS, TLS y proxy público:

```bash
curl -i https://tabs.dariassoft.com.ar/api/health
curl -I https://tabs.dariassoft.com.ar/
curl -I http://tabs.dariassoft.com.ar/
```

Resultados esperados: el health devuelve `200` y JSON con `status: ok` y `database: up`; la web devuelve `200`; HTTP redirige a HTTPS. El certificado debe ser válido para el dominio y no debe haber contenido mixto.

Desde la terminal del proyecto en Dokploy comprobar el estado interno:

```bash
docker compose ps
docker compose logs --tail=100 api
docker compose exec -T postgres psql -U tabvault -d tabvault -c 'SELECT name FROM migrations ORDER BY id;'
docker compose exec -T postgres psql -U tabvault -d tabvault -c '\dt'
```

Los cuatro servicios deben estar `running/healthy`, los logs no deben mostrar reinicios ni excepciones, `migrations` debe incluir `InitialSchema1790527560000` y deben existir las siete tablas de aplicación. Nunca copiar aquí valores de JWT, Google o Stripe.

### 4. Pruebas funcionales web

1. Abrir una ventana privada y entrar por HTTPS. Iniciar sesión con Google; si aparece `origin_mismatch`, revisar que el origen configurado sea exactamente el dominio, protocolo y puerto públicos.
2. Introducir una contraseña maestra nueva de al menos ocho caracteres. Crear dos carpetas anidadas y dos enlaces, buscar por título y URL, editar/eliminar un elemento y pulsar **Sincronizar**.
3. Cerrar la sesión o usar otro navegador, iniciar con la misma cuenta y contraseña maestra, y comprobar que aparece el mismo árbol. Con una contraseña incorrecta el servidor no debe revelar títulos ni URLs y la web debe rechazar el descifrado.
4. Exportar el archivo cifrado, crear un elemento temporal, importar el archivo y verificar que se restaura la versión exportada.
5. Abrir DevTools y confirmar que las peticiones `/api/vault` transportan un sobre cifrado; no deben contener la contraseña maestra, títulos ni URLs en texto claro.
6. Ejecutar Stripe Checkout en modo prueba antes de usar claves live. Completar el pago con `4242 4242 4242 4242`, comprobar respuesta `2xx` del webhook en Stripe y verificar que la licencia cambia. Repetir/reintentar el mismo evento no debe duplicar el estado.

### 5. Pruebas de extensión contra el VPS

1. Ejecutar `npm run build:extension`, abrir `chrome://extensions`, activar modo desarrollador y cargar o recargar la carpeta `dist`. Si se deja cargada la raíz o no se pulsa **Recargar**, se seguirá viendo el diseño anterior.
2. Abrir **Detalles → Opciones de la extensión**. Pulsar **Vincular dispositivo**; la extensión contactará directamente con `https://tabs.dariassoft.com.ar/api`. Copiar el código, aprobarlo en la web y pulsar **Comprobar aprobación**.
3. Crear un enlace en la extensión, pulsar **Subir cambios** y comprobarlo en la web tras desbloquear. Crear otro enlace en la web, sincronizar y pulsar **Descargar versión** en la extensión; aceptar únicamente después de exportar si hay datos locales importantes.
4. Intentar subir desde dos dispositivos partiendo de la misma revisión. El segundo debe recibir conflicto `409` y no sobrescribir silenciosamente el primer cambio.
5. Revocar el dispositivo desde la web y comprobar que la siguiente petición de la extensión deja de estar autorizada.
6. Para suspensión, abrir varias pestañas HTTP, dejar una activa y otra fijada, usar un umbral pequeño y excluir un dominio. **Analizar** no debe listar la activa, fijada, audible, interna ni excluida. Suspender candidatas y usar **Deshacer última** para restaurarlas.

### 6. Matriz responsive y criterios de aceptación

Probar tanto la web como las opciones de la extensión con anchos `320`, `375`, `768`, `1024` y `1440` píxeles, zoom `100%` y `200%`:

- No debe existir desplazamiento horizontal en la página; títulos, URL y nombres largos deben cortar o envolver sin ampliar el viewport.
- A `320–680 px`, la web muestra una sola columna, el árbol queda encima del contenido y las acciones se distribuyen en una o dos columnas. En la extensión, explorador, sincronización y suspensión se apilan; los botones ocupan filas utilizables.
- A `768–1024 px`, el contenido sigue legible sin superposición; búsqueda y acciones pueden saltar de línea.
- A `1440 px`, la web conserva un ancho máximo y el explorador usa dos columnas sin estirar excesivamente las tarjetas.
- Todos los controles deben poder recorrerse con `Tab`, mostrar foco visible, tener un área clicable cómoda y conservar contraste. Los diálogos deben caber en alto y ancho sin quedar fuera de pantalla.
- En Chrome DevTools ejecutar Lighthouse en modo móvil. Como mínimo no deben existir errores de accesibilidad, contenido fuera del viewport ni errores de consola.

### 7. Pruebas de reinicio, actualización y respaldo

1. Crear datos de prueba y ejecutar `docker compose restart api postgres`; al volver, el health y el árbol cifrado deben conservarse.
2. Antes de actualizar, realizar un dump de PostgreSQL y verificar que el archivo no está vacío: `docker compose exec -T postgres pg_dump -U tabvault tabvault > tabvault-AAAA-MM-DD.sql`.
3. Desplegar la nueva versión, comprobar migraciones y repetir health, login, lectura y escritura de bóveda. Probar restauración del dump en una base aislada, no por primera vez durante una emergencia.
4. Revisar periódicamente expiración TLS, espacio de volúmenes, reinicios, errores `5xx`, webhooks fallidos y crecimiento de historial/conflictos.

## Consideraciones operativas

- La estimación de memoria es orientativa; Chrome y Firefox no exponen consumo exacto y portable por pestaña.
- Los puntos de recuperación de suspensión son locales al dispositivo. El árbol de marcadores sí se sincroniza cifrado mediante el VPS.
- Google Drive continúa siendo un respaldo opcional futuro; exportar ZIP cifrado y sincronizar al VPS cubren actualmente recuperación y portabilidad sin entregar claves a terceros.
