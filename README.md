# SelfRelay

SelfRelay reduce el costo de retomar trabajo interrumpido.

**contexto → salida → checkpoint → regreso → recuperación automática**

Este repositorio contiene el código fuente canónico del proyecto SelfRelay para CoderCup AI 2026. El ZIP automático del código fuente de GitHub **no es el producto que debe descargar un usuario**.

## Descargar SelfRelay

La distribución para usuarios se realiza mediante **GitHub Releases** y cada plataforma tiene su propio archivo:

| Producto | Archivo de distribución | Estado |
| --- | --- | --- |
| Extensión de Chrome | `SelfRelay-Chrome.zip` | Chrome v0.4.3 validada |
| SelfRelay para Windows | `SelfRelay-Setup.exe` | Candidata 0.2.1 en validación; se publicará como Release estable después de aprobación física |

Un usuario de Windows solo necesita el instalador. No necesita Node.js, npm, Git, PowerShell, terminal, claves API ni herramientas de desarrollo.

### Windows

1. Descargar `SelfRelay-Setup.exe` desde Releases cuando la versión haya sido aprobada.
2. Ejecutar el instalador normalmente.
3. Abrir SelfRelay desde Windows.
4. Elegir explícitamente qué aplicaciones quiere seguir.

SelfRelay permanece disponible desde el área de notificación. Cerrar la ventana principal la oculta; la salida completa se realiza desde el menú de SelfRelay en el tray.

### Chrome

1. Descargar `SelfRelay-Chrome.zip` desde Releases.
2. Extraer el ZIP.
3. Abrir `chrome://extensions`.
4. Activar **Modo de desarrollador**.
5. Elegir **Cargar descomprimida**.
6. Seleccionar la carpeta extraída de SelfRelay.

## Qué hace

SelfRelay está diseñado para el momento en que una interrupción corta un trabajo y, al volver, hay que reconstruir mentalmente qué se estaba haciendo y cuál era el siguiente paso.

En Windows el flujo central es:

1. el usuario elige una aplicación;
2. SelfRelay observa únicamente esa aplicación y sus contextos relevantes;
3. cuando ocurre una salida real del contexto —no una minimización ni un cambio de foco— se prepara un checkpoint;
4. el usuario puede dejar texto y/o una nota de voz;
5. al volver al mismo contexto, SelfRelay presenta los checkpoints que siguen pendientes, del más antiguo al más reciente;
6. **Lo veo después** conserva el checkpoint sin resolverlo y **Ya retomé** resuelve únicamente el momento elegido.

Los **Entornos** permiten agrupar varias aplicaciones que pertenecen al mismo trabajo. Un entorno continúa activo mientras al menos una de sus aplicaciones miembro siga activa.

## Privacidad y audio

El diseño es local-first. SelfRelay no necesita una cuenta ni un backend para guardar checkpoints.

Las aplicaciones seleccionadas, checkpoints, historial, audio y transcripciones permanecen en el equipo. La grabación de voz se conserva localmente. La transcripción no se ejecuta automáticamente al grabar, guardar o abrir un checkpoint: solo se inicia cuando el usuario pulsa explícitamente **Transcribir audio**, utilizando el runtime local de Whisper incluido con la aplicación.

## Arquitectura del repositorio

- `apps/extension` — extensión de Chrome. La versión 0.4.3 está congelada durante el trabajo Desktop.
- `apps/desktop` — aplicación Windows, frontend y núcleo Tauri/Rust.
- `apps/web` — superficie web opcional, actualmente diferida.
- `packages/shared` — modelos y semántica compartida del producto.
- `docs` — contratos de comportamiento, validación y distribución.
- `.github/workflows` — CI y empaquetado reproducible.

El producto Windows final se compila como `SelfRelay.exe` con subsistema gráfico de Windows y se distribuye mediante un instalador NSIS versionado. Los workflows validan frontend, Rust, lifecycle, fixture Win32, estados runtime, branding, Whisper local, upgrade, single-instance, instalación y desinstalación antes de producir una candidata.

## Desarrollo

Los comandos de desarrollo son únicamente para contribuidores y CI. No forman parte de la instalación del usuario.

La extensión y Desktop tienen pipelines independientes. Una build automatizada no se considera una versión pública aprobada hasta superar también la validación física correspondiente.
