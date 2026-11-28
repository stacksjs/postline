<div lang="es">

# LinkedIn

**Necesitas** una aplicación de desarrollador de LinkedIn. LinkedIn exige asociarla a una página que administres. El registro es gratuito.

1. Abre [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) y crea una aplicación asociada a una página que administres. Cualquier página de la que seas administrador puede validar la aplicación.
2. En **Products**, añade **Sign In with LinkedIn using OpenID Connect** y **Share on LinkedIn**. Ambos productos se conceden de inmediato.
3. En **Auth**, añade como **Authorized redirect URL** la dirección que aparece en **Configuración > Canales** de Postline.
4. Copia **Client ID** y **Primary Client Secret** en **Configuración > Canales > Tus aplicaciones de redes sociales > LinkedIn**. Guarda y elige **Conectar LinkedIn**.

Postline solicita `openid`, `profile` y `w_member_social` para identificarte y publicar desde tu perfil.

## Publicar como página de empresa

Añade **Community Management API** a la misma aplicación y solicita la revisión de LinkedIn. Después, marca **Conectar también las páginas de empresa que administro** antes de iniciar sesión. Postline solicitará `w_organization_social` y `r_organization_admin`, y añadirá una cuenta por cada página en la que puedas publicar. Activa esta opción cuando LinkedIn apruebe el producto, porque sin él LinkedIn rechaza el inicio de sesión.

- **Límites.** Hasta 3.000 caracteres y cuatro imágenes. Postline conserva las etiquetas con `#`.
- **Caducidad.** Las sesiones de LinkedIn caducan después de 60 días, salvo que LinkedIn haya habilitado los tokens de renovación para tu aplicación. Postline indica cuándo debes volver a conectar la cuenta.
- **Limpieza.** Puedes eliminar las publicaciones que enviaste desde Postline. Para listar publicaciones anteriores, necesitas un permiso de socio que LinkedIn concede en casos limitados.

## Métricas de interacción

Cuando habilitas las páginas de empresa, **Consultar métricas de interacción** solicita `r_organization_social_feed`. Para perfiles personales solicita `r_member_social_feed`, un permiso que LinkedIn reserva para ciertos desarrolladores. Activa la opción después de obtener el permiso correspondiente y conecta la cuenta de nuevo. [Documentación de LinkedIn](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/social-metadata-api).

## Primeros comentarios

Selecciona LinkedIn en el editor y abre **Primeros comentarios**. Postline envía el comentario después de que se publique el primer mensaje, desde el mismo perfil o página de empresa. Si LinkedIn rechaza el comentario, puedes reintentarlo en **Cola > Requieren atención**. Si el resultado es incierto, abre la publicación y comprueba si el comentario aparece. [API de comentarios de LinkedIn](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/comments-api#create-a-comment).

[Guía en inglés](../../networks/linkedin.md)

</div>
