/* Plain JavaScript on purpose: injected into the page as-is, so no transpiler helper can leak in. */
(() => {
  const w = window;
  w.__spoken = [];
  w.__faceFound = true;

  // ---- SpeechRecognition
  let active = null;
  class FakeRecognition {
    lang = "en-US";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onstart = null;
    onend = null;
    onerror = null;
    onresult = null;
    start() {
      active = this;
      setTimeout(() => this.onstart?.(), 0);
    }
    abort() {
      if (active === this) active = null;
      setTimeout(() => this.onend?.(), 0);
    }
  }
  w.SpeechRecognition = FakeRecognition;
  w.webkitSpeechRecognition = FakeRecognition;
  w.__hear = (text) => {
    const r = Object.assign([{ transcript: text }], { isFinal: true });
    const ear = active;
    if (!ear || !ear.onresult) return false;
    ear.onresult({ resultIndex: 0, results: [r] });
    return true;
  };

  // ---- speechSynthesis: each utterance "plays" for a short, text-proportional time
  class FakeUtterance {
          lang = "";
    rate = 1;
    pitch = 1;
    volume = 1;
    voice = null;
    onstart = null;
    onend = null;
    onerror = null;
    constructor(text) {
      this.text = text;
    }
  }
  const voices = [
    { name: "Test English", lang: "en-US", voiceURI: "test-en", localService: true, default: true },
    { name: "Test Hindi", lang: "hi-IN", voiceURI: "test-hi", localService: true, default: false },
  ];
  let speaking = false;
  const synth = {
    get speaking() {
      return speaking;
    },
    paused: false,
    pending: false,
    getVoices: () => voices,
    resume() {},
    pause() {},
    cancel() {
      speaking = false;
    },
    speak(u) {
      w.__spoken.push(u.text);
      speaking = true;
      setTimeout(() => u.onstart?.(), 5);
      setTimeout(() => {
        speaking = false;
        u.onend?.();
      }, 30);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  w.SpeechSynthesisUtterance = FakeUtterance;

  // ---- FaceDetector: one centred face when __faceFound is true
  class FakeFaceDetector {
    async detect(src) {
      if (!w.__faceFound) return [];
      const W = src.videoWidth ?? src.width ?? 640;
      const H = src.videoHeight ?? src.height ?? 480;
      const bw = W * 0.42;
      const bh = H * 0.58;
      return [{ boundingBox: { x: (W - bw) / 2, y: (H - bh) / 2, width: bw, height: bh, top: (H - bh) / 2, left: (W - bw) / 2, right: (W + bw) / 2, bottom: (H + bh) / 2 }, landmarks: [] }];
    }
  }
  w.FaceDetector = FakeFaceDetector;

})();
