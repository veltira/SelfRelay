# SelfRelay

SelfRelay ayuda a retomar una tarea interrumpida sin perder el contexto mental de lo que estabas haciendo.

**contexto → interrupción → checkpoint → regreso → recuperación automática**

Proyecto presentado a **CoderCup AI 2026**.

## Para el jurado de CoderCup

Cuando dejamos una tarea a medias, normalmente no perdemos el archivo: perdemos el contexto. Al volver horas o días después tenemos que reconstruir qué estábamos haciendo, qué habíamos pensado y cuál era el siguiente paso.

SelfRelay convierte esa interrupción en un punto de retorno. Al salir de un contexto de trabajo seguido por SelfRelay, el usuario puede dejar un checkpoint breve en texto o audio. Cuando vuelve al mismo contexto, SelfRelay recupera ese checkpoint para ayudarlo a continuar desde donde lo dejó.

La forma más rápida de probarlo es:

1. Descargar la versión correspondiente desde **GitHub Releases**.
2. Instalarla siguiendo las instrucciones de esta página.
3. Seleccionar o seguir un contexto de trabajo.
4. Salir de ese contexto y guardar un checkpoint.
5. Volver al mismo contexto y comprobar la recuperación automática.

No se necesita compilar el proyecto, usar terminal, configurar API keys ni contratar servicios de IA pagos.

## Privacidad

Los checkpoints se almacenan localmente. El audio permanece en el dispositivo y la transcripción se ejecuta de forma explícita y bajo demanda mediante un runtime local de Whisper, sin enviar el audio a una API remota de transcripción.

## Descargar SelfRelay

Los usuarios y evaluadores **no deben descargar el ZIP del código fuente ni compilar el proyecto**. Las versiones preparadas para probar SelfRelay se distribuyen mediante **GitHub Releases**.

| Versión | Archivo | Estado |
| --- | --- | --- |
| Extensión para Chrome | `SelfRelay-Chrome.zip` | v0.4.3 validada |
| Aplicación para Windows | `SelfRelay-Setup.exe` | Se publica cuando la candidata actual complete la validación física final |

### Probar SelfRelay en Chrome

1. Descargar `SelfRelay-Chrome.zip` desde Releases.
2. Extraer el ZIP.
3. Abrir `chrome://extensions`.
4. Activar **Modo desarrollador**.
5. Elegir **Cargar descomprimida**.
6. Seleccionar la carpeta extraída de SelfRelay.
7. Abrir SelfRelay y seguir una pestaña, página o sitio.
8. Salir o cerrar ese contexto y guardar un checkpoint en texto o audio.
9. Volver al mismo contexto y comprobar que SelfRelay recupera el checkpoint pendiente.

### Probar SelfRelay en Windows

Cuando `SelfRelay-Setup.exe` esté disponible en la Release estable:

1. Descargar `SelfRelay-Setup.exe` desde la Release oficial.
2. Ejecutar el instalador.
3. Abrir SelfRelay y agregar una aplicación compatible.
4. Utilizar esa aplicación normalmente y luego cerrarla.
5. Guardar el checkpoint que presenta SelfRelay.
6. Volver a abrir la misma aplicación o contexto.
7. Comprobar que SelfRelay ofrece automáticamente el checkpoint pendiente para retomarlo.

## Aviso de Windows SmartScreen

El instalador de Windows todavía no utiliza un certificado comercial de firma Authenticode. Por ese motivo, Microsoft Defender SmartScreen puede mostrar mensajes como **“Editor desconocido”** o **“Windows protegió su PC”** debido a la falta de reputación o firma del archivo.

Ese aviso de SmartScreen, por sí solo, **no significa que Windows haya detectado malware**. Para probar la aplicación, el instalador debe descargarse únicamente desde la Release oficial de `veltira/SelfRelay` y comprobarse el SHA-256 publicado cuando corresponda. Una detección real de malware por parte del antivirus no debe ignorarse.

## Qué hay dentro del repositorio

El repositorio contiene el código fuente y las pruebas del proyecto:

- `apps/extension` — extensión de Chrome.
- `apps/desktop` — aplicación de escritorio para Windows.
- `packages/shared` — modelos y semántica compartida de contextos y checkpoints.
- `docs` — documentación de comportamiento, distribución y validación.

La versión validada actualmente de la extensión de Chrome es **0.4.3**.

## Desarrollo y validación

El proyecto incluye pruebas automáticas, empaquetado reproducible y validaciones específicas para los flujos principales de captura, recuperación y transcripción local. Los comandos y workflows de desarrollo están dentro del repositorio, pero **no son necesarios para que un evaluador pruebe SelfRelay**.
