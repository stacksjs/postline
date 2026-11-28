<div lang="es">

# Conectar redes sociales

Postline publica desde tus cuentas. Para conectar una red que usa OAuth, registra una aplicación de desarrollador con esa red e introduce su ID y su secreto en **Configuración > Canales**. Las condiciones y los costos de la aplicación dependen de cada red.

| Red | Qué necesitas |
| --- | --- |
| [Bluesky](./bluesky.md) | Tu identificador y una contraseña de aplicación |
| [Mastodon](./mastodon.md) | Tu instancia y un token de acceso |
| [LinkedIn](./linkedin.md) | Una aplicación de desarrollador de LinkedIn |
| [Threads](./threads.md) | Una aplicación de Meta con la API de Threads |
| [Instagram](./instagram.md) | Una aplicación de Meta, una cuenta profesional y una página de Facebook |
| [X](./x.md) | Una aplicación de desarrollador para publicar mediante OAuth 2.0, o una sesión de tu cuenta en el Mac |

La dirección de redirección que pide cada red aparece junto a sus campos en **Configuración > Canales**. En un servidor tiene el formato `https://<tu-dirección>/api/postline/<red>/callback`. Para X, usa `twitter` como nombre de red en esa dirección. En la aplicación para Mac, Postline muestra la dirección local que debes copiar.

Después de guardar una aplicación OAuth, elige **Probar conexión** y completa el inicio de sesión en la red. Cuando la prueba termine, selecciona **Conectar** en la tarjeta de su canal para poder publicar. La prueba de X consulta tu perfil y se descuenta del presupuesto diario de lecturas.

En el Mac, la [sesión de X en el navegador](./x.md#sesion-x-mac) también permite importar publicaciones visibles a **Escucha social** y actualizar interacciones de publicaciones que ya están en Postline. Puedes usar esa sesión y la API en el mismo espacio de trabajo.

[Funciones y límites de todas las redes, en inglés](../../networks/index.md)

</div>
