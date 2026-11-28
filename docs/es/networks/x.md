<div lang="es">

# X

## Conexión mediante la API

**Necesitas** una aplicación de desarrollador de X con OAuth 2.0 y saldo. X cobra por usar su API.

1. Abre [developer.x.com](https://developer.x.com), inicia sesión y abre la aplicación de tu proyecto. Si aún no tienes una, créala.
2. En **User authentication settings**, configura OAuth 2.0. Elige **Native App** para Mac o **Web App** para un espacio de trabajo alojado en un servidor. Copia la dirección de **Configuración > Canales > Tus aplicaciones de redes sociales > X** en **Callback URI** y añade el sitio en **Website URL**.
3. En **Keys and tokens**, copia **OAuth 2.0 Client ID** en Postline. Si elegiste **Native App**, marca **Usar una app pública de X con solo el ID de cliente**. Si elegiste **Web App**, introduce también el **Client Secret**. Guarda y elige **Probar conexión** o conecta la cuenta desde su tarjeta.

[Tipos de aplicación OAuth y PKCE en X](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)

Postline solicita `tweet.read`, `tweet.write`, `media.write` para subir imágenes, `users.read` y `offline.access` para renovar el inicio de sesión. Si conectaste la cuenta antes de que se añadiera el permiso para subir imágenes, vuelve a conectarla.

- **Costos.** X descuenta cada llamada del saldo que compras por adelantado. En octubre de 2026, una publicación costaba alrededor de 0,015 USD y una publicación con enlace alrededor de 0,20 USD. Publicar un artículo en X siempre cuenta como publicación con enlace. Consulta el portal de desarrolladores porque X cambia sus precios. Postline no añade un recargo.
- **Presupuesto diario de lecturas.** `TWITTER_DAILY_READ_BUDGET_USD` tiene un valor inicial de 2 USD por espacio de trabajo y se restablece a medianoche UTC. Postline reserva el costo máximo antes de consultar perfiles, buscar en Escucha social, leer publicaciones para Limpieza, actualizar estadísticas o pedir una página de mensajes directos. Puedes ver el costo estimado en **Configuración > Canales > Tus aplicaciones de redes sociales > X** y el cargo real en el portal de X. El límite cubre las consultas de este espacio de trabajo. [Precios por recurso de X](https://docs.x.com/x-api/getting-started/pricing).
- **Eliminación.** X admite 50 eliminaciones cada 15 minutos. Limpieza respeta ese ritmo, por lo que eliminar muchas publicaciones puede llevar horas.
- **Interacciones.** Permite las consultas de pago sobre interacciones en la configuración de X o establece `TWITTER_ENGAGEMENT_METRICS=true`. Selecciona la opción para actualizar interacciones en **Estadísticas** para consultar hasta 100 publicaciones recientes por cuenta de X conectada. Las métricas públicas de X usan el permiso `tweet.read`.
- **Límites.** Cada publicación admite 280 caracteres y hasta cuatro imágenes. Usa el modo **Hilo** del editor para escribir más.

### Mensajes directos mediante la API

Habilita los mensajes directos de pago de la API de X en **Configuración > Canales > Tus aplicaciones de redes sociales > X**. Guarda y vuelve a conectar cada cuenta que quieras usar en la bandeja de entrada. La pantalla de autorización añade `dm.read` y `dm.write`. En tu propio servidor puedes configurar `TWITTER_DIRECT_MESSAGES=true`. Si usas `TWITTER_ACCESS_TOKEN`, debe ser un token de usuario de X con ambos permisos.

En **Bandeja de entrada**, elige **Sincronizar mensajes de X** para la cuenta. Cada consulta recibe una página de hasta 25 eventos de mensajes y sus remitentes, con un costo de lectura máximo estimado de 0,50 USD según los precios publicados. La opción para cargar mensajes anteriores solicita la siguiente página del historial. El servicio de X ofrece hasta 30 días de eventos. Postline guarda los mensajes importados localmente. Abrir o actualizar la bandeja de entrada no genera consultas de pago. El presupuesto diario cubre ambos botones y las sincronizaciones interrumpidas continúan desde donde terminaron. Antes de leer, Postline muestra el costo estimado. El botón de envío indica el costo de la respuesta. [Precios de la API de X](https://docs.x.com/x-api/getting-started/pricing).

Puedes responder con texto a conversaciones existentes. Cuando un mensaje contiene solo un adjunto, Postline lo indica. Abre X para ver el archivo.

<a id="sesion-x-mac"></a>

## Sesión de X en el navegador del Mac

En una versión de Postline con ventanas WebKit aisladas, abre **Configuración > Canales > Sesión de X en el navegador** y elige **Abrir X**. Inicia sesión directamente en X. Vuelve a Postline y selecciona **Verificar sesión**. Esta función requiere macOS 14 o posterior.

WebKit guarda el inicio de sesión en este Mac y Postline recuerda el identificador confirmado. Para cerrar sesión, usa el menú de X en esa ventana y vuelve a verificarla en Postline. Si X te pide verificar la cuenta durante una importación, Postline pausa las lecturas, registra un aviso en **Actividad** y trae la ventana de X al frente. La pausa se conserva al recargar. Completa la verificación en X y selecciona **Verificar sesión** en Postline.

Si Postline encuentra resultados visibles que no puede leer, pausa las importaciones y registra el motivo en **Actividad**. Abre una página de búsqueda o menciones en X, espera a que cargue y selecciona **Verificar sesión** para volver a comprobar los controles de la página. [Reglas de automatización de X](https://help.x.com/en/rules-and-policies/x-automation).

Elige **Abrir el perfil de X**. Cuando cargue tu perfil en la ventana de X, selecciona **Leer interacciones visibles** en Postline. Los recuentos exactos que aparecen en tus publicaciones actualizan las publicaciones correspondientes en **Estadísticas**. Postline lee la página abierta mediante WebKit sin pedir credenciales de una aplicación de desarrollador.

En **Escucha social**, crea una regla activa y selecciona **X**. En **Fuente de X**, elige **Sesión de X en el navegador**. Elige **Abrir las menciones de X** en **Canales**, o abre la búsqueda en la ventana de X. Cuando carguen los resultados, selecciona **Importar menciones visibles**. Las publicaciones que coincidan aparecen en **Escucha social**. Las reglas que usan la sesión del navegador no hacen consultas programadas a la API de X. Si seleccionaste otras redes, el programador sigue consultándolas.

Activa **Consultar X en segundo plano** en una regla para que consulte X mientras la aplicación para Mac está abierta, incluso cuando solo aparece en la barra de menús. Postline comprueba una regla activa cada 20 minutos y alterna entre las que tengan esa opción habilitada. Si pausas la regla o desactivas la opción, se detienen sus consultas en segundo plano.

Selecciona tu cuenta de X en el navegador en **Redacción** para publicar un hilo en el momento o programarlo desde la **Cola**. Postline rellena cada parte del hilo en el editor de X y usa **Post all**. Si X confirma solo algunas partes, la **Cola** muestra las publicaciones confirmadas y deja las demás pendientes de revisión.

Si X no confirma un envío desde el navegador, la **Cola** detiene ese destino para evitar duplicados. Elige **Buscar en X** para abrir el perfil de la cuenta que envió la publicación. Abre la publicación correspondiente en esa ventana. Vuelve a **Cola** y elige **Vincular publicación abierta en X**. Revisa el texto y las imágenes antes de confirmar. Una vez verificada, la publicación queda marcada como publicada en la **Cola**.

Para quitar una publicación enviada desde el navegador, abre su menú de acciones en la **Cola** y elige **Eliminar de X**. Confirma la cuenta y la publicación. Postline usa el menú de esa publicación en la ventana aislada de X. Si X confirma la eliminación, Postline conserva el historial en Cola y quita el enlace. Si X no confirma, abre la publicación en X para verificar si sigue disponible.

[Guía en inglés](../../networks/x.md)

</div>
