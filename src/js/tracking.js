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

  // Imagen ajustada para el detector: en la oscuridad la mano sale negra y con el flash muy cerca sale
  // quemada; en los dos casos MediaPipe falla. Se mide el brillo y se corrige antes de detectar.
  _initEnhance() {
    this.proc = document.createElement('canvas');
    this.pctx = this.proc.getContext('2d', { willReadFrequently: false });
    this.lum = document.createElement('canvas');
    this.lum.width = 24; this.lum.height = 32;
    this.lctx = this.lum.getContext('2d', { willReadFrequently: true });
    this.gain = 1;
    this.meanLum = 0;
    this._lumN = 0;
    this.enhance = true;
  }

  _measure(v) {
    try {
      this.lctx.drawImage(v, 0, 0, 24, 32);
      const d = this.lctx.getImageData(0, 0, 24, 32).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      this.meanLum = s / (d.length / 4);
      const target = Math.max(0.55, Math.min(3.2, 105 / Math.max(8, this.meanLum)));
      this.gain += (target - this.gain) * 0.35;
    } catch (e) { this.enhance = false; }
  }

  _source(v) {
    if (!this.enhance) return v;
    if (++this._lumN % 12 === 1) this._measure(v);
    if (Math.abs(this.gain - 1) < 0.1) return v;            // imagen correcta: tal cual
    const w = v.videoWidth, h = v.videoHeight;
    if (this.proc.width !== w || this.proc.height !== h) { this.proc.width = w; this.proc.height = h; }
    this.pctx.filter = `brightness(${this.gain.toFixed(2)})`;
    this.pctx.drawImage(v, 0, 0, w, h);
    return this.proc;
  }

  // Bajar un poco la exposición (si el móvil lo permite) para que el flash no queme la mano cerca
  async _exposure() {
    this.exposureInfo = 'no ajustable';
    try {
      const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
      const adv = {};
      if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.exposureMode = 'continuous';
      if (caps.exposureCompensation) {
        const c = caps.exposureCompensation;
        adv.exposureCompensation = Math.max(c.min, Math.min(c.max, -0.7));
      }
      if (Object.keys(adv).length) {
        await this.track.applyConstraints({ advanced: [adv] });
        this.exposureInfo = adv.exposureCompensation !== undefined ? `comp ${adv.exposureCompensation.toFixed(1)} EV` : 'auto';
      }
    } catch (e) { /* sin control de exposición */ }
  }

  async startCamera({ hd = false } = {}) {
    if (!this.proc) this._initEnhance();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Este dispositivo no permite usar la cámara.');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { exact: 'environment' },
          width: { ideal: hd ? 720 : 480 },
          height: { ideal: hd ? 960 : 640 },
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
    let wantTorch = true;
    try { wantTorch = localStorage.getItem('gt_flash') !== '0'; } catch (e) { /* nada */ }
    this.torchWanted = wantTorch;
    if (wantTorch) {
      await this.setTorch(true);
      // Algunos móviles solo exponen el flash tras unos instantes
      if (!this.torchOn) setTimeout(() => this.setTorch(true), 800);
    }
    await this._exposure();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.torchWanted) setTimeout(() => this.setTorch(true), 300);
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

  async toggleTorch() {
    this.torchWanted = !this.torchWanted;
    try { localStorage.setItem('gt_flash', this.torchWanted ? '1' : '0'); } catch (e) { /* nada */ }
    await this.setTorch(this.torchWanted);
    return this.torchWanted;
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
      minHandDetectionConfidence: 0.35,
      minHandPresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
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
    if (v.videoWidth && v.videoHeight) this.aspect = v.videoWidth / v.videoHeight;
    this._lastVideoTime = v.currentTime;
    const t0 = performance.now();
    let res;
    try {
      res = this.landmarker.detectForVideo(this._source(v), nowMs);
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
    return nowMs - this.lastSeen < 400;   // fallos de detección muy cortos no hacen desaparecer la mano
  }
}
