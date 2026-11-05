// Cámara trasera + flash + MediaPipe Hand Landmarker (todo desde archivos locales del APK).
export class Tracker {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.track = null;
    this.landmarker = null;
    this.torchOn = false;
    this.torchSupported = false;
    this.delegate = '-';
    this.result = null;     // { image:[21], world:[21] } o null
    this.newResult = false;
    this.lastSeen = -1e9;
    this.lastDetect = 0;
    this.detectMs = 0;
    this.detFps = 0;
    this._lastVideoTime = -1;
    this._fpsCount = 0;
    this._fpsT = 0;
    this.aspect = 4 / 3;
  }

  async startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Este dispositivo no permite usar la cámara.');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { exact: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
    } catch (e) {
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
        throw new Error('Permiso de cámara denegado. Actívalo en Ajustes > Apps > Gestos Terror > Permisos.');
      }
      throw new Error('Se necesita la cámara trasera y no está disponible (' + (e && e.name) + ').');
    }
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    await new Promise((res) => {
      if (this.video.readyState >= 2) return res();
      this.video.onloadeddata = () => res();
      setTimeout(res, 3000);
    });
    this.aspect = (this.video.videoWidth || 640) / (this.video.videoHeight || 480);
    await this.setTorch(true);
    // Algunos móviles solo exponen el flash tras unos instantes
    if (!this.torchOn) setTimeout(() => this.setTorch(true), 800);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.torchOn) setTimeout(() => this.setTorch(true), 300);
    });
  }

  async setTorch(on) {
    if (!this.track) return false;
    try {
      const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
      this.torchSupported = !!(caps && caps.torch);
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      const st = this.track.getSettings ? this.track.getSettings() : {};
      this.torchOn = st.torch === undefined ? (this.torchSupported && on) : !!st.torch;
    } catch (e) {
      this.torchOn = false;
    }
    return this.torchOn;
  }

  async loadModel(onStatus) {
    onStatus && onStatus('Cargando detector de manos…');
    const vision = await import('../lib/vision_bundle.js');
    const { FilesetResolver, HandLandmarker } = vision;
    const fileset = await FilesetResolver.forVisionTasks('./mediapipe/wasm');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: './mediapipe/hand_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.45,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('GPU no disponible para MediaPipe, uso CPU', e);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
      this.delegate = 'CPU';
    }
  }

  update(nowMs) {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2) return;
    if (v.currentTime === this._lastVideoTime) return;
    this._lastVideoTime = v.currentTime;
    const t0 = performance.now();
    let res;
    try {
      res = this.landmarker.detectForVideo(v, nowMs);
    } catch (e) {
      return;
    }
    this.detectMs = performance.now() - t0;
    this._fpsCount++;
    if (nowMs - this._fpsT > 1000) { this.detFps = this._fpsCount; this._fpsCount = 0; this._fpsT = nowMs; }
    if (res && res.landmarks && res.landmarks.length && res.worldLandmarks && res.worldLandmarks.length) {
      this.result = {
        image: res.landmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z })),
        world: res.worldLandmarks[0].map((p) => ({ x: p.x, y: p.y, z: p.z })),
        score: res.handedness && res.handedness[0] && res.handedness[0][0] ? res.handedness[0][0].score : 0,
      };
      this.lastSeen = nowMs;
      this.newResult = true;
    }
    this.lastDetect = nowMs;
  }

  present(nowMs) {
    return nowMs - this.lastSeen < 280;
  }
}
