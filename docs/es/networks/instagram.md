<div lang="es">

# Instagram

**Necesitas** una cuenta profesional de empresa o creador, una página de Facebook vinculada y una aplicación de Meta con **Facebook Login for Business**. El registro es gratuito.

1. En Instagram, cambia a una cuenta profesional (de empresa o de creador) y vincúlala a una página de Facebook que administres.
2. Abre [developers.facebook.com/apps](https://developers.facebook.com/apps), crea una aplicación de tipo **Business** y añade **Facebook Login for Business** e **Instagram Graph API**.
3. En la configuración de Facebook Login, registra como **Valid OAuth Redirect URI** la dirección de redirección que muestra Postline en **Configuración > Canales**.
4. En **App settings > Basic**, copia **App ID** y **App Secret**. Introdúcelos en **Configuración > Canales > Tus aplicaciones de redes sociales > Instagram**. Guarda y conecta tu cuenta.
5. Cuando Meta te devuelva a Postline, selecciona la página de Facebook vinculada a la cuenta de Instagram que quieres usar. Luego elige **Conectar cuenta**.

Postline solicita `instagram_basic`, `instagram_content_publish`, `pages_show_list` y `pages_read_engagement`.

- **Cada publicación requiere una imagen.** Instagram la descarga desde una dirección pública. Si usas un portátil o la aplicación para Mac, activa **Configuración > General > Compartir imágenes mediante un enlace temporal**. Un servidor Postline público genera un enlace firmado al publicar. Usa la misma `APP_KEY` generada en la API y el proceso de publicación para verificarlo.
- **Revisión de Meta.** Se requiere para publicar en cuentas ajenas. Tu propia cuenta funciona en modo de desarrollo si tienes un rol en la aplicación. Meta pide una URL de política de privacidad antes de permitir que la aplicación pase a producción.
- **Bandeja de entrada.** Los mensajes de Instagram requieren acceso avanzado y revisión de Meta, fuera del alcance de una aplicación para uso personal.
- **Eliminación.** La API de Instagram no permite eliminar publicaciones.
- **Límites.** Hasta 2.200 caracteres por pie de foto y cuatro imágenes.

## Métricas de interacción

Concede `instagram_manage_insights`, marca **Consultar métricas de interacción** en la configuración de la aplicación de Instagram en Postline y vuelve a conectar la cuenta. La cuenta de Facebook conectada necesita permiso para analizar la página vinculada.

Postline guarda el token de usuario de Facebook para estadísticas separado del token de página que usa para publicar. Si configuras un token de página en `.env`, añade el token de usuario en `INSTAGRAM_INSIGHTS_ACCESS_TOKEN`. [Documentación de Meta](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights).

## Primeros comentarios

Concede `instagram_manage_comments` a la aplicación de Meta, habilita **Publicar el primer comentario** en Postline y vuelve a conectar Instagram. Si configuraste un token de página en `.env`, establece `INSTAGRAM_FIRST_COMMENTS=true` y añade el token de usuario de Facebook con permiso para comentar en `INSTAGRAM_COMMENTS_ACCESS_TOKEN`.

Selecciona Instagram en el editor y abre **Primeros comentarios**. Postline envía el comentario después de que se publique el primer mensaje. Si Instagram lo rechaza, puedes reintentarlo en **Cola > Requieren atención**. Si el resultado es incierto, abre la publicación y comprueba si el comentario aparece. [API de comentarios de Meta](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-media/comments#creating).

[Guía en inglés](../../networks/instagram.md)

</div>
