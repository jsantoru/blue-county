import type { Vehicle } from "./vehicle";
export class Sound {
  context: AudioContext | null = null;
  master?: GainNode;
  engine?: OscillatorNode;
  harmonic?: OscillatorNode;
  engineGain?: GainNode;
  windGain?: GainNode;
  tireGain?: GainNode;
  boostGain?: GainNode;
  muted = false;
  lastGear = 1;
  private lastStep = 0;
  start() {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const c = (this.context = new AudioContext());
    this.master = c.createGain();
    this.master.gain.value = 0.22;
    this.master.connect(c.destination);
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1000;
    filter.connect(this.master);
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0.2;
    this.engineGain.connect(filter);
    this.engine = c.createOscillator();
    this.engine.type = "sawtooth";
    this.engine.frequency.value = 55;
    this.engine.connect(this.engineGain);
    this.engine.start();
    this.harmonic = c.createOscillator();
    this.harmonic.type = "triangle";
    this.harmonic.frequency.value = 110;
    this.harmonic.connect(this.engineGain);
    this.harmonic.start();
    const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate),
      data = buffer.getChannelData(0);
    let seed = 442;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    const noise = () => {
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.start();
      return src;
    };
    this.windGain = c.createGain();
    this.windGain.gain.value = 0;
    const wf = c.createBiquadFilter();
    wf.type = "lowpass";
    wf.frequency.value = 450;
    noise().connect(wf);
    wf.connect(this.windGain);
    this.windGain.connect(this.master);
    this.tireGain = c.createGain();
    this.tireGain.gain.value = 0;
    const tf = c.createBiquadFilter();
    tf.type = "bandpass";
    tf.frequency.value = 1700;
    tf.Q.value = 4;
    noise().connect(tf);
    tf.connect(this.tireGain);
    this.tireGain.connect(this.master);
    this.boostGain = c.createGain();
    this.boostGain.gain.value = 0;
    const bf = c.createBiquadFilter();
    bf.type = "bandpass";
    bf.frequency.value = 500;
    noise().connect(bf);
    bf.connect(this.boostGain);
    this.boostGain.connect(this.master);
  }
  update(
    v: Vehicle,
    throttle: number,
    paused: boolean,
    foot?: { distance: number; speed: number; grounded: boolean; time: number },
  ) {
    if (!this.context || !this.master) return;
    const t = this.context.currentTime;
    this.master.gain.setTargetAtTime(paused ? 0 : 0.22, t, 0.08);
    this.engine!.frequency.setTargetAtTime(v.rpm / 22, t, 0.06);
    this.harmonic!.frequency.setTargetAtTime(v.rpm / 11, t, 0.06);
    this.engineGain!.gain.setTargetAtTime(
      foot ? 0.035 / (1 + foot.distance * 0.3) : 0.09 + throttle * 0.2,
      t,
      0.12,
    );
    this.windGain!.gain.setTargetAtTime(
      foot ? 0.018 : Math.min(0.4, v.speed / 180),
      t,
      0.08,
    );
    this.tireGain!.gain.setTargetAtTime(
      !foot && v.grounded > 1 ? Math.max(0, Math.abs(v.slip) - 0.09) * 1.8 : 0,
      t,
      0.035,
    );
    this.boostGain!.gain.setTargetAtTime(
      !foot && v.boosting ? 0.4 : 0,
      t,
      0.05,
    );
    if (
      foot &&
      !paused &&
      foot.grounded &&
      foot.speed > 0.3 &&
      foot.time - this.lastStep > (foot.speed > 3.4 ? 0.28 : 0.43)
    ) {
      this.lastStep = foot.time;
      this.footstep(foot.speed > 3.4);
    }
    if (v.gear !== this.lastGear) {
      this.tone(90, 0.04, 0.12);
      this.lastGear = v.gear;
    }
  }
  tone(freq: number, duration = 0.1, volume = 0.2) {
    if (!this.context || !this.master) return;
    const c = this.context,
      o = c.createOscillator(),
      g = c.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    g.gain.setValueAtTime(volume, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(c.currentTime + duration);
  }
  impact(strength: number) {
    this.tone(45 + strength * 2, 0.18, Math.min(1, strength / 8));
  }
  private footstep(running: boolean) {
    if (!this.context || !this.master) return;
    const c = this.context,
      count = Math.round(c.sampleRate * 0.085);
    const buffer = c.createBuffer(1, count, c.sampleRate),
      data = buffer.getChannelData(0);
    for (let i = 0; i < count; i++)
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (count * 0.2));
    const source = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      gain = c.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = running ? 900 : 650;
    gain.gain.value = running ? 0.2 : 0.12;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }
}
