# SelfRelay

SelfRelay ayuda a retomar una tarea interrumpida sin perder el contexto mental de lo que estabas haciendo.

**contexto → interrupción → checkpoint → regreso → recuperación automática**

Proyecto presentado a **CoderCup AI 2026**.

> **Enlace único del proyecto para CoderCup:** esta misma página (`https://github.com/veltira/SelfRelay`). Desde aquí el jurado puede entender el proyecto, descargar la aplicación nativa para Windows o la extensión de Chrome y consultar las instrucciones de prueba. No hace falta entregar un enlace distinto por plataforma.

## Windows — SelfRelay Desktop 0.2.3

[**⬇ Descargar SelfRelay para Windows (.zip)**](https://github.com/veltira/SelfRelay/releases/download/codercup-2026/SelfRelay-Windows-0.2.3.zip)

[Descarga directa del instalador `.exe`](https://github.com/veltira/SelfRelay/releases/download/codercup-2026/SelfRelay-Setup.exe)

La aplicación de escritorio lleva el concepto de SelfRelay a aplicaciones nativas de Windows. Permite elegir qué aplicaciones seguir, detectar cuándo se abandona el último contexto de una aplicación, guardar un checkpoint en texto o audio y recuperarlo cuando el usuario vuelve.

La versión **0.2.3** incluye:

- selección y seguimiento de aplicaciones Win32 mediante ejecutable, accesos directos y discovery de Windows;
- seguimiento de Google Chrome, Microsoft Edge, Firefox, Brave y otras aplicaciones elegidas por el usuario;
- selección manual de `.exe` o `.lnk` cuando una aplicación no aparece automáticamente;
- checkpoints durables almacenados en SQLite con identidad estable;
- recuperación automática al volver al contexto seguido;
- corrección del ciclo de vida de la ventana de recuperación para que una recuperación ya resuelta no deje una WebView vacía;
- checkpoints de voz y reproducción del audio original;
- **transcripción local con Whisper**, automática al recuperar una nota de voz y con reintento manual si hiciera falta;
- transcripción fuera del hilo de interfaz para no bloquear la ventana mientras Whisper procesa el audio;
- funcionamiento local sin cuentas, API keys ni servicios de IA pagos.

El instalador 0.2.3 publicado fue construido e instalado por la validación de Windows en GitHub Actions. El pipeline comprobó frontend, Rust, captura multi-app, fixture Win32 real, Tauri, discovery, WebViews instaladas, upgrade desde 0.2.1, single-instance y desinstalación antes de publicar el artifact.

SHA-256 del instalador público verificado:

`0e5ac37d05e719df464928c1a9b2da9aed26c429deca39d541397bc67bb8d91c`

La captura de escritorio utiliza una breve ventana de estabilización antes de considerar que una aplicación realmente terminó. Esa demora evita confundir recreaciones internas de ventanas con cierres reales.

## Chrome — SelfRelay 0.4.3

[**⬇ Descargar SelfRelay para Chrome (.zip)**](https://github.com/veltira/SelfRelay/releases/download/codercup-2026/SelfRelay-Chrome.zip)

1. Descargar y extraer `SelfRelay-Chrome.zip`.
2. Abrir `chrome://extensions`.
3. Activar **Modo desarrollador**.
4. Elegir **Cargar descomprimida**.
5. Seleccionar la carpeta extraída de SelfRelay.
6. Abrir SelfRelay y seguir una pestaña, página o sitio.
7. Salir o cerrar ese contexto y guardar un checkpoint en texto o audio.
8. Volver al mismo contexto y comprobar que SelfRelay recupera el checkpoint pendiente.

No requiere una cuenta, backend externo, API keys ni servicios de IA pagos.

También se pueden consultar todos los archivos publicados en la [Release de CoderCup 2026](https://github.com/veltira/SelfRelay/releases/tag/codercup-2026).

> Los evaluadores no necesitan descargar el código fuente ni compilar el proyecto.

## Para el jurado de CoderCup

Cuando dejamos una tarea a medias, normalmente no perdemos el archivo: perdemos el contexto. Al volver horas o días después tenemos que reconstruir qué estábamos haciendo, qué habíamos pensado y cuál era el siguiente paso.

SelfRelay convierte esa interrupción en un punto de retorno. Al salir de un contexto de trabajo seguido por SelfRelay, el usuario puede dejar un checkpoint breve en texto o audio. Cuando vuelve al mismo contexto, SelfRelay recupera ese checkpoint para ayudarlo a continuar desde donde lo dejó.

El flujo principal es:

**seleccionar contexto → trabajar → salir → dejar checkpoint → regresar → recuperar el contexto pendiente**

## Privacidad y transcripción local

Los checkpoints se almacenan localmente. El audio permanece en el dispositivo y la transcripción se ejecuta mediante un runtime local de Whisper incluido con SelfRelay. En Desktop 0.2.3, una nota de voz pendiente intenta transcribirse automáticamente durante la recuperación y conserva una acción de reintento manual.

SelfRelay no envía el audio a una API remota de transcripción y no necesita tokens de un proveedor de IA.

## Sobre Windows SmartScreen y antivirus

El instalador de Windows todavía no utiliza un certificado comercial de firma Authenticode. Microsoft Defender SmartScreen o el navegador pueden advertir que se trata de una aplicación o descarga no reconocida porque un binario sin firma no dispone de una identidad de editor con reputación transferible entre versiones.

Por ese motivo se ofrece como descarga principal un ZIP y se publica el SHA-256 exacto del instalador. El ZIP no sustituye una firma de código: al ejecutar el `.exe`, Windows todavía puede mostrar una advertencia de aplicación no reconocida.

Una advertencia de reputación o **“Editor desconocido”** no es, por sí sola, una detección de malware. Si un producto de seguridad identifica explícitamente una amenaza concreta en lugar de una advertencia de reputación/firma, no se recomienda ignorar esa detección.

## Qué hay dentro del repositorio

- `apps/extension` — extensión de Chrome.
- `apps/desktop` — aplicación nativa para Windows, frontend y núcleo Tauri/Rust.
- `packages/shared` — modelos y semántica compartida de contextos y checkpoints.
- `docs` — documentación de comportamiento, distribución y validación.
- `.github/workflows` — pruebas y empaquetado reproducible.

## Desarrollo y validación

SelfRelay incluye pruebas automáticas para captura, recuperación, persistencia, audio, transcripción local y lifecycle. Desktop 0.2.3 añade validaciones de Windows para discovery de aplicaciones, observador Win32, instalación real, WebViews, upgrade, single-instance y desinstalación. El estado de los assets públicos verificados queda registrado en `docs/CODERCUP_RELEASE_STATUS.md`.