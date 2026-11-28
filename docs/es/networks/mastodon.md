<div lang="es">

# Mastodon

**Necesitas** la dirección de tu instancia y un token de acceso.

1. En tu instancia, abre **Preferences > Development > New application**. Llama a la aplicación «Postline», concédele los permisos `read` y `write` y guárdala.
2. Abre la aplicación y copia el valor de **Your access token**.
3. En Postline, abre **Configuración > Canales > Mastodon**. Introduce la dirección de tu instancia (`https://mastodon.social`, por ejemplo) y el token. Luego conecta la cuenta.

- **Límites.** La mayoría de las instancias permiten 500 caracteres. Postline acepta hasta cuatro imágenes o un vídeo MP4, según los límites de tu instancia. Ajusta la visibilidad y las advertencias de contenido en el editor.
- **Encuestas y citas.** Abre las opciones de encuestas y citas de Mastodon en el editor. Tu instancia fija los límites de las encuestas. Para citar, la instancia debe admitir publicaciones con citas y el token necesita el permiso `read:search`, incluido en `read`. Elige una encuesta, una cita o un archivo adjunto por publicación. En un hilo, la encuesta o la cita va en la primera publicación.
- **Bandeja de entrada.** Las publicaciones visibles solo para las personas mencionadas aparecen en **Mensajes directos**. Las respuestas públicas y menciones usan el permiso `read:notifications`, incluido en `read`. Elige **Responder** en **Respuestas y menciones** para contestar desde la cuenta que recibió la publicación. Las respuestas a publicaciones sin listar siguen sin listar.
- **Estadísticas.** Postline consulta los favoritos, las republicaciones y las respuestas desde la cuenta que publicó cada mensaje. Las publicaciones privadas requieren permiso de lectura. [API de estados de Mastodon](https://docs.joinmastodon.org/methods/statuses/#get).
- Para revocar el acceso, elimina la aplicación en tu instancia.

[Guía en inglés](../../networks/mastodon.md)

</div>
