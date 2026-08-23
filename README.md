# SelfRelay

SelfRelay ayuda a retomar una tarea interrumpida sin perder el contexto mental de lo que estabas haciendo.

**contexto → interrupción → checkpoint → regreso → recuperación automática**

Proyecto presentado a **CoderCup AI 2026**.

> **Enlace único del proyecto para CoderCup:** esta misma página (`https://github.com/veltira/SelfRelay`). Desde aquí el jurado puede entender el proyecto, descargar la versión estable de Chrome o consultar la preview nativa para Windows. No hace falta entregar un enlace distinto por plataforma.

## Ruta recomendada para evaluar SelfRelay

### Chrome — versión estable recomendada

[**⬇ Descargar SelfRelay para Chrome (.zip)**](https://github.com/veltira/SelfRelay/releases/download/codercup-2026/SelfRelay-Chrome.zip)

**Versión 0.4.3 — validada y recomendada para la evaluación principal.**

1. Descargar y extraer `SelfRelay-Chrome.zip`.
2. Abrir `chrome://extensions`.
3. Activar **Modo desarrollador**.
4. Elegir **Cargar descomprimida**.
5. Seleccionar la carpeta extraída de SelfRelay.
6. Abrir SelfRelay y seguir una pestaña, página o sitio.
7. Salir o cerrar ese contexto y guardar un checkpoint en texto o audio.
8. Volver al mismo contexto y comprobar que SelfRelay recupera el checkpoint pendiente.

No requiere una cuenta, backend externo, API keys ni servicios de IA pagos.

## Windows — preview nativa 0.2.2

[**⬇ Descargar SelfRelay para Windows (.exe)**](https://github.com/veltira/SelfRelay/releases/download/codercup-2026/SelfRelay-Setup.exe)

La aplicación de escritorio demuestra la extensión del concepto de SelfRelay desde el navegador hacia aplicaciones nativas de Windows: observación del contexto, proceso residente en system tray, checkpoints de texto/audio, recuperación y transcripción local.

**Estado:** preview funcional, no es la ruta recomendada para la evaluación principal. Durante las últimas pruebas físicas se detectaron incompatibilidades intermitentes que todavía están en investigación, entre ellas comportamiento no esperado al observar Google Chrome y bloqueos de inicio por algunos productos de seguridad en una build sin firma Authenticode.

No desactives ni ignores una detección real de tu antivirus para ejecutar SelfRelay. Si el software de seguridad impide abrir la preview, utilizá la versión estable de Chrome para evaluar el flujo principal.

El instalador publicado corresponde exactamente a la build 0.2.2 probada físicamente. SHA-256:

`a12061a72981cfedfa33e723cb10d4abf668c289b4b74026e3009ccea31df0ce`

La captura de escritorio utiliza una breve ventana de estabilización antes de considerar que una aplicación realmente terminó; por eso el aviso de checkpoint puede aparecer con una pequeña demora. Esa espera evita confundir recreaciones internas de ventanas con cierres reales.

También se pueden consultar todos los archivos publicados en la [Release de CoderCup 2026](https://github.com/veltira/SelfRelay/releases/tag/codercup-2026).

> Los evaluadores no necesitan descargar el ZIP del código fuente de GitHub ni compilar el proyecto.

## Para el jurado de CoderCup

Cuando dejamos una tarea a medias, normalmente no perdemos el archivo: perdemos el contexto. Al volver horas o días después tenemos que reconstruir qué estábamos haciendo, qué habíamos pensado y cuál era el siguiente paso.

SelfRelay convierte esa interrupción en un punto de retorno. Al salir de un contexto de trabajo seguido por SelfRelay, el usuario puede dejar un checkpoint breve en texto o audio. Cuando vuelve al mismo contexto, SelfRelay recupera ese checkpoint para ayudarlo a continuar desde donde lo dejó.

El flujo principal es:

**seleccionar contexto → trabajar → salir → dejar checkpoint → regresar → recuperar el contexto pendiente**

## Privacidad y transcripción local

Los checkpoints se almacenan localmente. El audio permanece en el dispositivo y la transcripción se ejecuta de forma explícita y bajo demanda mediante un runtime local de Whisper, sin enviar el audio a una API remota de transcripción.

## Sobre Windows SmartScreen y antivirus

La preview de Windows todavía no utiliza un certificado comercial de firma Authenticode. Microsoft Defender SmartScreen puede mostrar mensajes como **“Editor desconocido”** o **“Windows protegió su PC”** por la falta de reputación o firma del archivo. Ese aviso, por sí solo, no equivale a una detección de malware.

Algunos productos de seguridad también pueden restringir una aplicación no firmada que observa eventos de ventanas de Windows. SelfRelay no debe requerir que un evaluador desactive su antivirus; por eso la extensión de Chrome es la ruta estable recomendada para esta entrega.

## Qué hay dentro del repositorio

- `apps/extension` — extensión de Chrome estable para la entrega.
- `apps/desktop` — preview nativa para Windows, frontend y núcleo Tauri/Rust.
- `packages/shared` — modelos y semántica compartida de contextos y checkpoints.
- `docs` — documentación de comportamiento, distribución y validación.
- `.github/workflows` — pruebas y empaquetado reproducible.

## Desarrollo y validación

SelfRelay incluye pruebas automáticas para captura, recuperación, persistencia, audio, transcripción local y lifecycle. La preview de escritorio también incluye validaciones de instalación, upgrade, single-instance, WebView y comportamiento nativo de Windows. La build 0.2.2 sigue disponible para demostrar el alcance Desktop, mientras continúan las correcciones de compatibilidad detectadas en pruebas físicas.