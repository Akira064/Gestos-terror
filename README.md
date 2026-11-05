# Gestos Terror

Escape room de terror con estética PS1 para Android. Sujetas el móvil con una mano y pones la otra **detrás**, delante de la cámara trasera: una mano 3D low poly (con manga) aparece en el juego donde está tu mano real. La pantalla nunca muestra la cámara.

**Tecnología:** HTML/JavaScript + three.js + MediaPipe Hands (Tasks Vision), empaquetado con Capacitor 7. Todo va dentro del APK (three.js, wasm de MediaPipe y el modelo `hand_landmarker.task`); el juego no usa internet al jugar.

## Compilar (automático)

Cada `push` a `main` ejecuta `.github/workflows/android.yml`:

1. `npm install`
2. `npm run build` → crea `www/` con el juego, three.js, MediaPipe y el modelo (descargado una vez al compilar)
3. `npx cap add android` + `npm run android:patch` (permiso CAMERA, cámara trasera obligatoria, VIBRATE, vertical, pantalla completa)
4. `./gradlew assembleDebug`
5. Publica `gestos-terror-N.apk` en **Releases** (tag `build-N`) y como artefacto.

En el repo: **Settings → Actions → General → Workflow permissions → Read and write** (necesario para crear la Release).

## Controles

| Acción | Cómo |
|---|---|
| Mirar | Mueve el móvil (giroscopio). Arrastrar en pantalla ajusta el giro. ⟲ recentra. |
| Moverse | Joystick abajo a la izquierda (con inercia) |
| Agacharse | Botón AGACHAR junto al joystick (pulsa otra vez para levantarte) |
| Encender luz | Mano en la cuerda · pinza pulgar-índice y baja |
| Romper vitrina | Puño y golpe rápido |
| Coger la caja | Mano abierta que se cierra en puño |
| Cortar la corriente | Puño sobre la palanca y baja |
| Abrir la puerta | Con la llave, gira la muñeca en la cerradura |

Cada objeto solo acepta su gesto. La mano no atraviesa paredes ni objetos: se queda apoyada, vibra al tocar y suena al arrastrarla.

**Puzzle:** luz → romper vitrina → coger la caja (llave) → palanca (si no, la cerradura da calambre) → abrir puerta → pasillo → salida. El cronómetro guarda tu mejor tiempo.

## Modelos de Blender

Puedes sustituir los modelos hechos por código por los tuyos: pon archivos `.glb` en `src/models/` con el nombre del objeto (`peluche.glb`, `caja.glb`, `puerta.glb`, `monstruo.glb`…). Tamaños, orígenes y cómo exportar en [src/models/LEEME.md](src/models/LEEME.md). Al hacer push se genera un APK con ellos.

## Debug

Botón **DEBUG**: esqueleto de la mano (sin imagen de cámara), valores en vivo (pinza, apertura, velocidad, bajada, giro, profundidad, contacto, objeto) y deslizadores para todos los umbrales. Se guardan en el móvil; "Restaurar umbrales" vuelve a los de fábrica.

Ajustes típicos: si la mano queda muy lejos/cerca, toca **Prof. ganancia/offset**; si no llega a los bordes, **Alcance**; si el puño no se detecta, sube **Puño**.

## Estructura

```
src/index.html, src/style.css
src/js/main.js        bucle, UI, colisión de la mano
src/js/ps1.js         baja resolución, vertex snap, dithering, texturas
src/js/world.js       nivel, objetos y puzzle
src/js/handModel.js   mano low poly con manga
src/js/tracking.js    cámara trasera, flash, MediaPipe
src/js/gestures.js    filtros, profundidad y gestos (umbrales)
src/js/controls.js    giroscopio, joystick, inercia
src/js/audio.js       sonido procedural y vibración
src/js/debug.js       panel de depuración
scripts/build-www.mjs     arma www/
scripts/patch-android.mjs ajusta el proyecto Android
```

Notas: el flash usa la restricción `torch` de la cámara web; casi todos los Android la admiten, pero si tu móvil no, el juego avisa. El APK es de depuración (firmado con la clave debug), instalable directamente.
