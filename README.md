# SelfRelay

SelfRelay ayuda a retomar una tarea interrumpida sin perder el contexto mental de lo que estabas haciendo.

**contexto → interrupción → checkpoint → regreso → recuperación automática**

Proyecto presentado a **CoderCup AI 2026**.

## Descargar y probar SelfRelay

SelfRelay puede probarse de dos formas. Ambas pertenecen al mismo proyecto y utilizan la misma idea central de checkpoints de contexto.

### Windows — aplicación de escritorio

[**⬇ Descargar SelfRelay para Windows (.exe)**](https://github.com/veltira/SelfRelay/releases/download/codercup-2026/SelfRelay-Setup.exe)

**Versión 0.2.2 — validada físicamente en Windows.**

SHA-256 del instalador validado:

`a12061a72981cfedfa33e723cb10d4abf668c289b4b74026e3009ccea31df0ce`

No requiere Node.js, npm, Git, terminal, API keys ni herramientas de desarrollo.

### Chrome — extensión

[**⬇ Descargar SelfRelay para Chrome (.zip)**](https://github.com/veltira/SelfRelay/releases/download/codercup-2026/SelfRelay-Chrome.zip)

**Versión 0.4.3 — validada.**

También se pueden consultar todos los archivos publicados en la [Release de CoderCup 2026](https://github.com/veltira/SelfRelay/releases/tag/codercup-2026).

> Los evaluadores no necesitan descargar el ZIP del código fuente de GitHub ni compilar el proyecto.

## Para el jurado de CoderCup

Cuando dejamos una tarea a medias, normalmente no perdemos el archivo: perdemos el contexto. Al volver horas o días después tenemos que reconstruir qué estábamos haciendo, qué habíamos pensado y cuál era el siguiente paso.

SelfRelay convierte esa interrupción en un punto de retorno. Al salir de un contexto de trabajo seguido por SelfRelay, el usuario puede dejar un checkpoint breve en texto o audio. Cuando vuelve al mismo contexto, SelfRelay recupera ese checkpoint para ayudarlo a continuar desde donde lo dejó.

El flujo principal es:

**seleccionar contexto → trabajar → salir → dejar checkpoint → regresar → recuperar el contexto pendiente**

No se necesita una cuenta, un backend externo, una API key ni un servicio de IA pago para utilizar el flujo principal.

## Probar SelfRelay en Windows

1. Descargar `SelfRelay-Setup.exe` usando el enlace de arriba.
2. Ejecutar el instalador.
3. Abrir SelfRelay y agregar una aplicación compatible.
4. Utilizar esa aplicación normalmente y luego cerrarla.
5. Guardar el checkpoint que presenta SelfRelay, mediante texto o audio.
6. Volver a abrir la misma aplicación o contexto.
7. Comprobar que SelfRelay ofrece automáticamente el checkpoint pendiente para retomarlo.

SelfRelay permanece disponible desde el área de notificación de Windows. Cerrar la ventana principal no necesariamente finaliza el proceso: puede seguir funcionando desde el tray para detectar correctamente la salida y el regreso a las aplicaciones seleccionadas.

## Probar SelfRelay en Chrome

1. Descargar `SelfRelay-Chrome.zip` usando el enlace de arriba.
2. Extraer el ZIP.
3. Abrir `chrome://extensions`.
4. Activar **Modo desarrollador**.
5. Elegir **Cargar descomprimida**.
6. Seleccionar la carpeta extraída de SelfRelay.
7. Abrir SelfRelay y seguir una pestaña, página o sitio.
8. Salir o cerrar ese contexto y guardar un checkpoint en texto o audio.
9. Volver al mismo contexto y comprobar que SelfRelay recupera el checkpoint pendiente.

## Privacidad y transcripción local

Los checkpoints se almacenan localmente. El audio permanece en el dispositivo y la transcripción se ejecuta de forma explícita y bajo demanda mediante un runtime local de Whisper, sin enviar el audio a una API remota de transcripción.

## Aviso de Windows SmartScreen

El instalador de Windows todavía no utiliza un certificado comercial de firma Authenticode. Por ese motivo, Microsoft Defender SmartScreen puede mostrar mensajes como **“Editor desconocido”** o **“Windows protegió su PC”** debido a la falta de reputación o firma del archivo.

Ese aviso de SmartScreen, por sí solo, **no significa que Windows haya detectado malware**. Para comprobar que se trata exactamente del instalador validado para esta entrega, puede verificarse que su SHA-256 sea:

`a12061a72981cfedfa33e723cb10d4abf668c289b4b74026e3009ccea31df0ce`

Una detección real de malware por parte del antivirus no debe ignorarse.

## Qué hay dentro del repositorio

El repositorio contiene el código fuente, pruebas y empaquetado reproducible del proyecto:

- `apps/extension` — extensión de Chrome.
- `apps/desktop` — aplicación de escritorio para Windows.
- `packages/shared` — modelos y semántica compartida de contextos y checkpoints.
- `docs` — documentación de comportamiento, distribución y validación.
- `.github/workflows` — validaciones y empaquetado automatizado.

## Desarrollo y validación

SelfRelay incluye pruebas automáticas para captura, recuperación, persistencia, audio, transcripción local y lifecycle. La versión de escritorio también incluye validaciones de instalación, upgrade, single-instance, WebView y comportamiento nativo de Windows. Estas herramientas están destinadas al desarrollo y CI; **no son necesarias para que un evaluador pruebe el producto**.
