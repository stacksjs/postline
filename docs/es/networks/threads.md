<div lang="es">

# Threads

**Necesitas** una aplicación de Meta con la API de Threads y tu cuenta de Threads registrada como cuenta de prueba. El registro es gratuito.

1. Abre [developers.facebook.com/apps](https://developers.facebook.com/apps) y crea una aplicación con el caso de uso **Access the Threads API**.
2. En la configuración de la API de Threads, añade como **Redirect Callback URL** la dirección de redirección que muestra Postline en **Configuración > Canales**.
3. En **App roles**, añade tu cuenta de Threads como **Threads tester**. Acepta la invitación en la aplicación de Threads bajo **Settings > Account > Website permissions**.
4. Copia **Threads App ID** y **Threads App Secret** en **Configuración > Canales > Tus aplicaciones de redes sociales > Threads**. Guarda y conecta tu cuenta.

Postline solicita `threads_basic` y `threads_content_publish`. En modo de desarrollo, la aplicación publica solo para las cuentas de prueba. Para una instalación con un solo propietario basta con tu propia cuenta de prueba, sin revisión.

- **Límites.** Cada publicación admite 500 caracteres y hasta cuatro imágenes. Threads descarga las imágenes desde una dirección pública. Si usas un portátil o la aplicación para Mac, activa **Configuración > General > Compartir imágenes mediante un enlace temporal**.
- **Eliminación.** Threads permite 100 eliminaciones al día por perfil. Limpieza se detiene al llegar al límite y te informa.
- **Bandeja de entrada.** Threads carece de una API de mensajería.

## Métricas de interacción

Concede `threads_manage_insights`, marca **Consultar métricas de interacción** en la configuración de la aplicación de Threads en Postline y vuelve a conectar la cuenta. [Documentación de Threads](https://developers.facebook.com/docs/threads/insights/).

[Guía en inglés](../../networks/threads.md)

</div>
