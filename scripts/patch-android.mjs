// Ajusta el proyecto Android generado por `npx cap add android`:
//  - Permiso CAMERA + cámara trasera obligatoria (uses-feature required=true)
//  - Flash opcional, VIBRATE para la vibración
//  - Orientación vertical, pantalla siempre encendida y modo inmersivo
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const appDir = path.join(root, 'android', 'app', 'src', 'main');
const manifestPath = path.join(appDir, 'AndroidManifest.xml');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));

if (!fs.existsSync(manifestPath)) {
  console.error('[patch] No existe android/. Ejecuta antes: npx cap add android');
  process.exit(1);
}

let m = fs.readFileSync(manifestPath, 'utf8');

const extra = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.VIBRATE" />',
  '<uses-feature android:name="android.hardware.camera" android:required="true" />',
  '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera.flash" android:required="false" />',
  '<uses-feature android:name="android.hardware.sensor.gyroscope" android:required="false" />',
];
for (const line of extra) {
  const name = line.match(/android:name="([^"]+)"/)[1];
  if (!m.includes(`"${name}"`)) {
    m = m.replace('</manifest>', `    ${line}\n</manifest>`);
  }
}

if (!m.includes('android:screenOrientation')) {
  m = m.replace(
    'android:name=".MainActivity"',
    'android:name=".MainActivity"\n            android:screenOrientation="portrait"'
  );
}
if (!m.includes('android:hardwareAccelerated')) {
  m = m.replace('<application', '<application\n        android:hardwareAccelerated="true"');
}
fs.writeFileSync(manifestPath, m);
console.log('[patch] AndroidManifest.xml actualizado');

// Versión: versionCode = número de compilación, para que cada APK se instale encima del anterior
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
const build = parseInt(process.env.BUILD_NUMBER || '1', 10);
if (fs.existsSync(gradlePath)) {
  let gr = fs.readFileSync(gradlePath, 'utf8');
  gr = gr.replace(/versionCode\s+\d+/, `versionCode ${build}`).replace(/versionName\s+"[^"]*"/, `versionName "1.0.${build}"`);
  fs.writeFileSync(gradlePath, gr);
  console.log(`[patch] versionCode ${build}, versionName 1.0.${build}`);
}

// MainActivity: pantalla encendida + barras del sistema ocultas
const pkg = cfg.appId;
const javaDir = path.join(appDir, 'java', ...pkg.split('.'));
fs.mkdirSync(javaDir, { recursive: true });
const activity = `package ${pkg};

import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
`;
fs.writeFileSync(path.join(javaDir, 'MainActivity.java'), activity);
console.log('[patch] MainActivity.java escrito en', path.relative(root, javaDir));
