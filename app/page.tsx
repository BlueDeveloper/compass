'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
const DEFAULT_LAT = 37.5547;
const DEFAULT_LON = 126.9708;
const ARRIVAL_KM  = 0.05;   // 50m → 도착 판정
const ALIGN_DEG   = 15;     // ±15° → 방향 맞음 판정

/* ═══════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════ */
export default function CompassPage() {

  /* ── UI Phase ── */
  const [phase,          setPhase]          = useState<'search' | 'compass'>('search');
  const [compassVisible, setCompassVisible] = useState(false);
  const [isShaking,      setIsShaking]      = useState(false);

  /* ── Search Form ── */
  const [inputLat,  setInputLat]  = useState('');
  const [inputLon,  setInputLon]  = useState('');
  const [formError, setFormError] = useState('');

  /* ── Target ── */
  const [targetLat, setTargetLat] = useState(DEFAULT_LAT);
  const [targetLon, setTargetLon] = useState(DEFAULT_LON);

  /* ── Sensor ── */
  const [userLat,          setUserLat]          = useState<number | null>(null);
  const [userLon,          setUserLon]          = useState<number | null>(null);
  const [heading,          setHeading]          = useState<number | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);

  /* ── Navigation ── */
  const [distance,  setDistance]  = useState<number | null>(null);
  const [bearing,   setBearing]   = useState<number | null>(null);
  const [rotAngle,  setRotAngle]  = useState(0);   // 화살표 회전 (0 = 정면)
  const [isAligned, setIsAligned] = useState(false);
  const [isArrived, setIsArrived] = useState(false);

  /* ── Refs ── */
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const noiseSrcRef   = useRef<AudioBufferSourceNode | null>(null);
  const gainRef       = useRef<GainNode | null>(null);
  const lastHRef      = useRef<number | null>(null);
  const cntRef        = useRef(0);
  const absSensorRef  = useRef<any>(null);

  /* ═══════════════════════════════════════════
     AUDIO
  ═══════════════════════════════════════════ */
  const initAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  }, []);

  const makeBuf = useCallback(() => {
    const ctx = audioCtxRef.current!;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    // Brown noise
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.8;
    }
    return buf;
  }, []);

  const startNoise = useCallback((vol: number) => {
    if (!audioCtxRef.current) return;
    try {
      if (noiseSrcRef.current) { try { noiseSrcRef.current.stop(); } catch {} noiseSrcRef.current = null; }
      const ctx  = audioCtxRef.current;
      const src  = ctx.createBufferSource();
      src.buffer = makeBuf();
      src.loop   = true;

      const gain = ctx.createGain();
      gain.gain.value = vol;

      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 180;

      src.connect(hp);
      hp.connect(gain);
      gain.connect(ctx.destination);
      src.start();

      noiseSrcRef.current = src;
      gainRef.current     = gain;
    } catch {}
  }, [makeBuf]);

  const stopNoise = useCallback(() => {
    if (noiseSrcRef.current) {
      try { noiseSrcRef.current.stop(); } catch {}
      noiseSrcRef.current = null;
    }
  }, []);

  const setNoiseVol = useCallback((vol: number) => {
    if (gainRef.current && audioCtxRef.current) {
      gainRef.current.gain.setTargetAtTime(vol, audioCtxRef.current.currentTime, 0.08);
    }
  }, []);

  /* ═══════════════════════════════════════════
     GEOLOCATION
  ═══════════════════════════════════════════ */
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      pos => { setUserLat(pos.coords.latitude); setUserLon(pos.coords.longitude); },
      err  => console.error(err),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  /* ═══════════════════════════════════════════
     HEADING SENSOR
  ═══════════════════════════════════════════ */
  const mod360 = (d: number) => ((d % 360) + 360) % 360;
  const angDiff = (a: number, b: number) => {
    let d = a - b;
    while (d >  180) d -= 360;
    while (d < -180) d += 360;
    return d;
  };

  const smoothH = (h: number): number => {
    const last = lastHRef.current;
    if (last === null) { lastHRef.current = h; return h; }
    if (Math.abs(angDiff(h, last)) > 60 && cntRef.current > 10) return last;
    const s = mod360(last + 0.25 * angDiff(h, last));
    lastHRef.current = s;
    return s;
  };

  const requestPermission = useCallback(async () => {
    initAudio();
    if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function') {
      const r = await (DeviceOrientationEvent as any).requestPermission();
      if (r === 'granted') setPermissionGranted(true);
    } else {
      setPermissionGranted(true);
    }
  }, [initAudio]);

  useEffect(() => {
    if (!permissionGranted) return;
    let lastT = 0;
    const THROTTLE = 80;

    // AbsoluteOrientationSensor (Android Chrome)
    if (typeof (window as any).AbsoluteOrientationSensor !== 'undefined') {
      try {
        const sensor = new (window as any).AbsoluteOrientationSensor({ frequency: 60 });
        absSensorRef.current = sensor;
        sensor.addEventListener('reading', () => {
          const now = Date.now();
          if (now - lastT < THROTTLE) return;
          lastT = now; cntRef.current++;
          const [x, y, z, w] = sensor.quaternion;
          const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
          setHeading(smoothH(mod360(yaw * 180 / Math.PI)));
        });
        sensor.start();
        return () => { try { sensor.stop(); } catch {} };
      } catch {}
    }

    // DeviceOrientation fallback (iOS + others)
    const handler = (e: DeviceOrientationEvent) => {
      const now = Date.now();
      if (now - lastT < THROTTLE) return;
      lastT = now; cntRef.current++;
      let raw: number | null = null;
      if ((e as any).webkitCompassHeading != null) raw = mod360((e as any).webkitCompassHeading);
      else if (e.alpha != null) raw = mod360(e.absolute ? e.alpha : 360 - e.alpha);
      if (raw !== null) setHeading(smoothH(raw));
    };

    window.addEventListener('deviceorientationabsolute', handler as any, true);
    window.addEventListener('deviceorientation', handler, true);
    return () => {
      window.removeEventListener('deviceorientationabsolute', handler as any);
      window.removeEventListener('deviceorientation', handler);
    };
  }, [permissionGranted]);

  /* ═══════════════════════════════════════════
     NAVIGATION MATH
  ═══════════════════════════════════════════ */
  const calcBearing = (la1: number, lo1: number, la2: number, lo2: number): number => {
    const r  = Math.PI / 180;
    const dl = (lo2 - lo1) * r;
    return (
      Math.atan2(
        Math.sin(dl) * Math.cos(la2 * r),
        Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos(dl)
      ) * 180 / Math.PI + 360
    ) % 360;
  };

  const calcDist = (la1: number, lo1: number, la2: number, lo2: number): number => {
    const r = Math.PI / 180, R = 6371;
    const dp = (la2 - la1) * r, dl = (lo2 - lo1) * r;
    const a  = Math.sin(dp / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dl / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  useEffect(() => {
    if (userLat === null || userLon === null || heading === null) return;
    const b   = calcBearing(userLat, userLon, targetLat, targetLon);
    const d   = calcDist(userLat, userLon, targetLat, targetLon);
    const rot = mod360(angDiff(b, heading));
    setBearing(b);
    setDistance(d);
    setRotAngle(rot);
    setIsAligned(Math.abs(angDiff(b, heading)) <= ALIGN_DEG);
    setIsArrived(d < ARRIVAL_KM);
  }, [userLat, userLon, heading, targetLat, targetLon]);

  /* ═══════════════════════════════════════════
     NOISE EFFECT
  ═══════════════════════════════════════════ */
  useEffect(() => {
    if (!permissionGranted || phase !== 'compass') return;
    if (isArrived) {
      if (noiseSrcRef.current) setNoiseVol(0.55);
      else startNoise(0.55);
    } else if (!isAligned) {
      if (noiseSrcRef.current) setNoiseVol(0.09);
      else startNoise(0.09);
    } else {
      stopNoise();
    }
  }, [isAligned, isArrived, permissionGranted, phase, startNoise, stopNoise, setNoiseVol]);

  /* ═══════════════════════════════════════════
     SEARCH SUBMIT
  ═══════════════════════════════════════════ */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const lat = parseFloat(inputLat);
    const lon = parseFloat(inputLon);

    if (isNaN(lat) || isNaN(lon))           { setFormError('유효한 좌표를 입력하세요'); return; }
    if (lat < -90  || lat > 90)             { setFormError('위도: -90 ~ +90 범위'); return; }
    if (lon < -180 || lon > 180)            { setFormError('경도: -180 ~ +180 범위'); return; }

    // 지진 흔들기 + 플리커 + 노이즈
    initAudio();
    startNoise(0.38);
    setIsShaking(true);

    setTimeout(() => {
      stopNoise();
      setIsShaking(false);
      setTargetLat(lat);
      setTargetLon(lon);
      setPhase('compass');
      requestPermission();
      setTimeout(() => setCompassVisible(true), 250);
    }, 1050);
  };

  /* ═══════════════════════════════════════════
     FORMATTERS
  ═══════════════════════════════════════════ */
  const fmtDist  = (d: number | null) =>
    d === null ? '---' : d < 1 ? `${(d * 1000).toFixed(0)}m` : `${d.toFixed(2)}km`;
  const fmtCoord = (v: number | null) =>
    v === null ? '---.-----' : v.toFixed(5);
  const fmtDeg   = (v: number | null) =>
    v === null ? '---.-°' : `${v.toFixed(1)}°`;

  /* ═══════════════════════════════════════════
     SPIRIT LEVEL BUBBLE POSITION
  ═══════════════════════════════════════════ */
  const signedA      = rotAngle > 180 ? rotAngle - 360 : rotAngle;
  const bubbleFactor = Math.min(Math.abs(signedA) / 90, 1);
  const bubbleRad    = rotAngle * Math.PI / 180;
  const BX           = 150 + Math.sin(bubbleRad) * 44 * bubbleFactor;
  const BY           = 150 - Math.cos(bubbleRad) * 44 * bubbleFactor;

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  return (
    <div
      className="min-h-screen bg-black text-green-400 overflow-hidden select-none"
      style={{ fontFamily: 'var(--font-geist-mono), "Courier New", monospace' }}
    >
      <style>{`
        /* ─ Shake: earthquake ─ */
        @keyframes shake {
          0%,100% { transform: translate(0,0) rotate(0deg); }
          7%   { transform: translate(-7px,-4px) rotate(-1.5deg); }
          14%  { transform: translate(10px, 6px) rotate( 1.2deg); }
          21%  { transform: translate(-9px, 7px) rotate(-2deg); }
          28%  { transform: translate(7px,-8px)  rotate( 1.8deg); }
          35%  { transform: translate(-6px, 5px) rotate(-1.2deg); }
          42%  { transform: translate(9px,-6px)  rotate( 2.2deg); }
          49%  { transform: translate(-11px,7px) rotate(-1.8deg); }
          56%  { transform: translate(6px,-5px)  rotate( 1.2deg); }
          63%  { transform: translate(-5px, 9px) rotate(-2.5deg); }
          70%  { transform: translate(8px,-4px)  rotate( 1.5deg); }
          77%  { transform: translate(-4px, 6px) rotate(-1deg); }
          84%  { transform: translate(5px,-7px)  rotate( 1.2deg); }
          91%  { transform: translate(-3px, 4px) rotate(-0.8deg); }
        }

        /* ─ Background flicker (misaligned) ─ */
        @keyframes bgFlicker {
          0%,100% { opacity:0; }
          6%   { opacity:0.20; }
          12%  { opacity:0; }
          22%  { opacity:0.14; }
          30%  { opacity:0; }
          40%  { opacity:0.25; }
          52%  { opacity:0; }
          60%  { opacity:0.10; }
          72%  { opacity:0; }
          82%  { opacity:0.18; }
          92%  { opacity:0; }
        }

        /* ─ Background flicker (arrived) ─ */
        @keyframes bgArrived {
          0%   { opacity:0.35; filter:invert(0); }
          5%   { opacity:0.95; filter:invert(1); }
          10%  { opacity:0.15; filter:invert(0); }
          15%  { opacity:1;    filter:invert(1); }
          20%  { opacity:0.08; filter:invert(0); }
          25%  { opacity:0.85; filter:invert(1); }
          30%  { opacity:0.25; filter:invert(0); }
          35%  { opacity:0.98; filter:invert(1); }
          40%  { opacity:0.12; filter:invert(0); }
          45%  { opacity:0.80; filter:invert(1); }
          50%  { opacity:0.40; filter:invert(0); }
          55%  { opacity:0.90; filter:invert(1); }
          60%  { opacity:0.05; filter:invert(0); }
          65%  { opacity:0.88; filter:invert(1); }
          70%  { opacity:0.45; filter:invert(0); }
          75%  { opacity:0.75; filter:invert(1); }
          80%  { opacity:0.18; filter:invert(0); }
          85%  { opacity:0.92; filter:invert(1); }
          90%  { opacity:0.30; filter:invert(0); }
          95%  { opacity:0.82; filter:invert(1); }
          100% { opacity:0.35; filter:invert(0); }
        }

        /* ─ Compass fade-in ─ */
        @keyframes compassAppear {
          from { opacity:0; transform:scale(0.90) translateY(12px); }
          to   { opacity:1; transform:scale(1)    translateY(0); }
        }

        /* ─ Scanline pulse ─ */
        @keyframes scanPulse {
          0%,100% { opacity:0.045; }
          50%     { opacity:0.09; }
        }

        /* ─ Pulse ring on alignment ─ */
        @keyframes pulseRing {
          0%,100% { stroke-opacity:0.65; stroke-width:2; r:127; }
          50%     { stroke-opacity:0.20; stroke-width:5; r:130; }
        }

        /* ─ Arrived ring pulse ─ */
        @keyframes arrivedRing {
          0%,100% { stroke-opacity:0.9; stroke-width:3; }
          50%     { stroke-opacity:0.3; stroke-width:7; }
        }

        /* ─ Applied classes ─ */
        .shaking        { animation: shake 1.05s cubic-bezier(.36,.07,.19,.97) both; }
        .compass-appear { animation: compassAppear 1.8s ease-out forwards; }

        .flicker-overlay {
          position:fixed; inset:0; pointer-events:none; z-index:100;
          background:rgba(200,255,200,0.18);
        }
        .flicker-overlay.active  { animation: bgFlicker 0.20s steps(1) infinite; }
        .flicker-overlay.arrived { animation: bgArrived 0.10s steps(1) infinite; background:rgba(255,255,255,0.55); }

        .scanlines {
          position:absolute; inset:0; pointer-events:none;
          background: repeating-linear-gradient(
            0deg, transparent, transparent 3px,
            rgba(0,0,0,0.14) 3px, rgba(0,0,0,0.14) 4px
          );
          animation: scanPulse 3.5s ease-in-out infinite;
        }

        .pulse-ring-el   { animation: pulseRing  1.6s ease-in-out infinite; }
        .arrived-ring-el { animation: arrivedRing 0.5s ease-in-out infinite; }

        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; }
        input[type=number] { -moz-appearance:textfield; }
      `}</style>

      {/* ── Flicker overlay ── */}
      <div className={`flicker-overlay ${
        isArrived ? 'arrived' : (!isAligned && phase === 'compass') ? 'active' : ''
      }`} />

      {/* ══════════════════════════════════════════════
          SEARCH PHASE
      ══════════════════════════════════════════════ */}
      {phase === 'search' && (
        <div
          className={`min-h-screen flex flex-col items-center justify-center p-6 relative${isShaking ? ' shaking' : ''}`}
        >
          <div className="scanlines" />

          {/* Header */}
          <div className="mb-10 text-center z-10">
            <div className="text-[10px] tracking-[0.35em] text-green-800 mb-2">
              ◈ &nbsp; NAVIGATION SYSTEM v1.0 &nbsp; ◈
            </div>
            <div
              className="text-5xl font-bold tracking-[0.12em] text-green-400 mb-2"
              style={{ textShadow: '0 0 22px #00ff4190, 0 0 45px #00ff4135' }}
            >
              COMPASS
            </div>
            <div className="text-[10px] tracking-[0.25em] text-green-900">
              // TARGET_COORDINATE_INPUT_REQUIRED //
            </div>
          </div>

          {/* Terminal Form */}
          <form onSubmit={handleSearch} className="w-full max-w-xs z-10">
            <div
              className="border border-green-900 p-6 relative"
              style={{ background: 'rgba(0,8,0,0.85)', boxShadow: '0 0 24px #00ff4112, inset 0 0 24px #00000050' }}
            >
              <div
                className="absolute top-0 left-5 -translate-y-1/2 bg-black px-2 text-[10px] tracking-[0.25em] text-green-800"
              >
                TARGET_COORD
              </div>

              {/* Latitude */}
              <div className="mb-5">
                <div className="text-[9px] tracking-[0.2em] text-green-800 mb-1.5">
                  LAT &nbsp;/&nbsp; 위도 &nbsp;&nbsp;[ -90 ~ +90 ]
                </div>
                <div className="flex items-center border-b border-green-900 pb-1.5">
                  <span className="text-green-700 mr-2 text-sm">&gt;</span>
                  <input
                    type="number" step="any"
                    value={inputLat}
                    onChange={e => setInputLat(e.target.value)}
                    placeholder="37.55470"
                    className="flex-1 bg-transparent text-green-400 outline-none text-sm placeholder-green-950"
                  />
                </div>
              </div>

              {/* Longitude */}
              <div className="mb-7">
                <div className="text-[9px] tracking-[0.2em] text-green-800 mb-1.5">
                  LON &nbsp;/&nbsp; 경도 &nbsp;&nbsp;[ -180 ~ +180 ]
                </div>
                <div className="flex items-center border-b border-green-900 pb-1.5">
                  <span className="text-green-700 mr-2 text-sm">&gt;</span>
                  <input
                    type="number" step="any"
                    value={inputLon}
                    onChange={e => setInputLon(e.target.value)}
                    placeholder="126.97080"
                    className="flex-1 bg-transparent text-green-400 outline-none text-sm placeholder-green-950"
                  />
                </div>
              </div>

              {formError && (
                <div className="text-red-500 text-[10px] mb-4 tracking-wide">
                  &gt;&gt; ERR: {formError}
                </div>
              )}

              <button
                type="submit"
                className="w-full border border-green-800 text-green-400 py-3 text-sm tracking-[0.22em] transition-all duration-200 hover:border-green-500 hover:bg-green-950"
                style={{ boxShadow: '0 0 12px #00ff4118' }}
              >
                [ &nbsp; EXECUTE &nbsp; ]
              </button>
            </div>
          </form>

          {/* Status */}
          <div className="mt-10 text-[9px] tracking-[0.2em] text-green-900 text-center space-y-1 z-10">
            <div>GPS_STATUS: {userLat !== null ? `LOCK_ACQUIRED ✓` : 'SEARCHING_SIGNAL...'}</div>
            <div>SYSTEM: ■■■■■■■■░░ READY</div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          COMPASS PHASE
      ══════════════════════════════════════════════ */}
      {phase === 'compass' && (
        <div className="min-h-screen flex flex-col items-center justify-center py-6 px-4 relative">
          <div className="scanlines" />

          <div
            className={`flex flex-col items-center w-full ${compassVisible ? 'compass-appear' : 'opacity-0'}`}
          >
            {/* Header */}
            <div className="text-[9px] tracking-[0.3em] text-green-900 mb-4 text-center">
              ◈ &nbsp; COMPASS NAVIGATION SYSTEM &nbsp; ◈
            </div>

            {/* Sensor init button */}
            {!permissionGranted && (
              <button
                onClick={requestPermission}
                className="mb-5 border border-green-800 text-green-500 text-[11px] px-6 py-2.5 tracking-[0.2em] hover:border-green-500 transition-colors"
              >
                [ INITIALIZE SENSOR ]
              </button>
            )}

            {/* ─────────────────────────────────
                SVG SPIRIT-LEVEL COMPASS
            ───────────────────────────────── */}
            <div className="relative" style={{ width: 300, height: 300 }}>
              <svg width="300" height="300" viewBox="0 0 300 300">
                <defs>
                  {/* Glow filter */}
                  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="2.5" result="blur"/>
                    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                  <filter id="glowStrong" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="5" result="blur"/>
                    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>
                  <filter id="glowRed" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3" result="blur"/>
                    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                  </filter>

                  {/* Clip paths for road visualization intersection */}
                  <clipPath id="cpCircleA">
                    <circle cx="114" cy="150" r="112"/>
                  </clipPath>
                  <clipPath id="cpCircleB">
                    <circle cx="186" cy="150" r="112"/>
                  </clipPath>

                  {/* Radial gradient for intersection glow */}
                  <radialGradient id="roadGradA" cx="65%" cy="50%" r="50%">
                    <stop offset="0%"   stopColor="#00ff41" stopOpacity="0.6"/>
                    <stop offset="60%"  stopColor="#00ff41" stopOpacity="0.25"/>
                    <stop offset="100%" stopColor="#00ff41" stopOpacity="0"/>
                  </radialGradient>
                  <radialGradient id="roadGradB" cx="35%" cy="50%" r="50%">
                    <stop offset="0%"   stopColor="#00ff41" stopOpacity="0.6"/>
                    <stop offset="60%"  stopColor="#00ff41" stopOpacity="0.25"/>
                    <stop offset="100%" stopColor="#00ff41" stopOpacity="0"/>
                  </radialGradient>
                </defs>

                {/* ── 도로 시각화: 겹쳐지는 원 (그라데이션 교차선) ── */}
                {/* Ghost rings (almost invisible) */}
                <circle cx="114" cy="150" r="112" fill="none" stroke="#00ff41" strokeWidth="0.7" strokeOpacity="0.05"/>
                <circle cx="186" cy="150" r="112" fill="none" stroke="#00ff41" strokeWidth="0.7" strokeOpacity="0.05"/>

                {/* Circle A's stroke visible ONLY inside Circle B → intersection highlight */}
                <g clipPath="url(#cpCircleB)">
                  <circle cx="114" cy="150" r="112" fill="none" stroke="url(#roadGradA)" strokeWidth="18" strokeOpacity="0.35"/>
                  <circle cx="114" cy="150" r="112" fill="none" stroke="#00ff41" strokeWidth="1.8" strokeOpacity="0.50" filter="url(#glow)"/>
                </g>

                {/* Circle B's stroke visible ONLY inside Circle A → intersection highlight */}
                <g clipPath="url(#cpCircleA)">
                  <circle cx="186" cy="150" r="112" fill="none" stroke="url(#roadGradB)" strokeWidth="18" strokeOpacity="0.35"/>
                  <circle cx="186" cy="150" r="112" fill="none" stroke="#00ff41" strokeWidth="1.8" strokeOpacity="0.50" filter="url(#glow)"/>
                </g>

                {/* ── Outer compass housing ── */}
                <circle cx="150" cy="150" r="132" fill="#030703" stroke="#0f1f0f" strokeWidth="2"/>
                <circle cx="150" cy="150" r="130" fill="none" stroke="#00ff41" strokeWidth="0.6" strokeOpacity="0.22"/>
                <circle cx="150" cy="150" r="127" fill="none" stroke="#00ff41" strokeWidth="0.3" strokeOpacity="0.12"/>

                {/* ── Rotating compass disk (heading-based) ── */}
                <g transform={`rotate(${heading !== null ? -heading : 0}, 150, 150)`}>

                  {/* Spirit-level concentric rings */}
                  {[104, 84, 64, 44, 26].map((r, i) => (
                    <circle key={r} cx="150" cy="150" r={r}
                      fill="none" stroke="#00ff41"
                      strokeWidth="0.5"
                      strokeOpacity={0.06 + i * 0.025}
                    />
                  ))}

                  {/* Disk crosshairs */}
                  <line x1="150" y1="48"  x2="150" y2="252" stroke="#00ff41" strokeWidth="0.35" strokeOpacity="0.10"/>
                  <line x1="48"  y1="150" x2="252" y2="150" stroke="#00ff41" strokeWidth="0.35" strokeOpacity="0.10"/>

                  {/* Degree tick marks (72 × 5°) */}
                  {Array.from({ length: 72 }, (_, i) => {
                    const a    = i * 5;
                    const rad  = a * Math.PI / 180;
                    const isN  = a % 90 === 0;
                    const is45 = a % 45 === 0;
                    const is10 = a % 10 === 0;
                    const r1   = isN ? 105 : is45 ? 108 : is10 ? 112 : 116;
                    return (
                      <line key={i}
                        x1={150 + r1 * Math.sin(rad)} y1={150 - r1 * Math.cos(rad)}
                        x2={150 + 123 * Math.sin(rad)} y2={150 - 123 * Math.cos(rad)}
                        stroke="#00ff41"
                        strokeWidth={isN ? 2.2 : is45 ? 1.5 : is10 ? 1 : 0.5}
                        strokeOpacity={isN ? 0.90 : is45 ? 0.70 : is10 ? 0.45 : 0.22}
                      />
                    );
                  })}

                  {/* Cardinal direction labels */}
                  {[
                    { l: 'N', a: 0,   c: '#ff3333', sz: 14, fw: 'bold' },
                    { l: 'E', a: 90,  c: '#00ff41', sz: 10, fw: 'normal' },
                    { l: 'S', a: 180, c: '#00cc33', sz: 10, fw: 'normal' },
                    { l: 'W', a: 270, c: '#00ff41', sz: 10, fw: 'normal' },
                  ].map(({ l, a, c, sz, fw }) => {
                    const rad = a * Math.PI / 180;
                    return (
                      <text key={l}
                        x={150 + 95 * Math.sin(rad)}
                        y={150 - 95 * Math.cos(rad) + 4}
                        textAnchor="middle" fill={c} fontSize={sz}
                        fontFamily="monospace" fontWeight={fw}
                        style={{ filter: l === 'N' ? 'drop-shadow(0 0 5px #ff333388)' : undefined }}
                      >{l}</text>
                    );
                  })}
                </g>

                {/* ── Target direction arrow ── */}
                <g transform={`rotate(${rotAngle}, 150, 150)`} opacity={heading !== null ? 1 : 0.25}>
                  <line x1="150" y1="150" x2="150" y2="68"
                    stroke="#ff6600" strokeWidth="2" strokeOpacity="0.88"
                    filter="url(#glow)"/>
                  <polygon points="150,53 142,75 158,75"
                    fill="#ff6600" opacity="0.90" filter="url(#glow)"/>
                  <circle cx="150" cy="53" r="3"
                    fill="none" stroke="#ff6600" strokeWidth="1.5" strokeOpacity="0.7"/>
                  {/* Tail */}
                  <line x1="145" y1="172" x2="155" y2="172"
                    stroke="#ff6600" strokeWidth="1.5" strokeOpacity="0.45"/>
                </g>

                {/* ── Spirit level bubble ── */}
                {/* Target ring (center zone indicator) */}
                <circle cx="150" cy="150" r="16"
                  fill="none" stroke="#00ff41" strokeWidth="0.8" strokeOpacity="0.28"
                  strokeDasharray="4,4"/>

                {heading !== null && (
                  <>
                    {/* Outer bubble ring */}
                    <circle cx={BX} cy={BY} r={isAligned ? 10 : 11}
                      fill="rgba(0,8,0,0.6)"
                      stroke={isAligned ? '#00ff41' : '#ff7700'}
                      strokeWidth="1.8"
                      filter={isAligned ? 'url(#glowStrong)' : undefined}
                    />
                    {/* Inner bubble dot */}
                    <circle cx={BX} cy={BY} r={isAligned ? 5 : 4.5}
                      fill={isAligned ? '#00ff41' : '#ff7700'}
                      fillOpacity={isAligned ? 0.85 : 0.55}
                      filter={isAligned ? 'url(#glowStrong)' : undefined}
                    />
                  </>
                )}

                {/* ── Center reticle ── */}
                <circle cx="150" cy="150" r="6"
                  fill="#030703" stroke="#00ff41" strokeWidth="1.5" strokeOpacity="0.80"/>
                <circle cx="150" cy="150" r="1.8" fill="#00ff41"/>
                {/* Reticle cross lines */}
                {[0, 90, 180, 270].map(a => {
                  const rad = a * Math.PI / 180;
                  return (
                    <line key={a}
                      x1={150 + 9  * Math.sin(rad)} y1={150 - 9  * Math.cos(rad)}
                      x2={150 + 18 * Math.sin(rad)} y2={150 - 18 * Math.cos(rad)}
                      stroke="#00ff41" strokeWidth="1.2" strokeOpacity="0.65"
                    />
                  );
                })}

                {/* ── Alignment glow ring (on course) ── */}
                {isAligned && !isArrived && (
                  <circle cx="150" cy="150" r="127"
                    fill="none" stroke="#00ff41" strokeWidth="2"
                    className="pulse-ring-el"
                    style={{ filter: 'drop-shadow(0 0 9px #00ff41)' }}
                  />
                )}

                {/* ── Arrival indicator ── */}
                {isArrived && (
                  <>
                    <circle cx="150" cy="150" r="127"
                      fill="none" stroke="#ff0000" strokeWidth="3"
                      className="arrived-ring-el"
                      style={{ filter: 'drop-shadow(0 0 12px #ff0000)' }}
                    />
                    <text x="150" y="38"
                      textAnchor="middle" fill="#ff3333" fontSize="8"
                      fontFamily="monospace" fontWeight="bold"
                      style={{ filter: 'drop-shadow(0 0 5px #ff000080)' }}
                    >
                      ▲ DESTINATION_REACHED ▲
                    </text>
                  </>
                )}
              </svg>
            </div>

            {/* ─── Distance ─── */}
            <div className="text-center mt-2 mb-5">
              <div
                className="text-[42px] font-bold tracking-widest leading-none"
                style={{
                  color: isArrived ? '#ff3333' : '#00ff41',
                  textShadow: isArrived
                    ? '0 0 20px #ff333380'
                    : '0 0 18px #00ff4160',
                }}
              >
                {fmtDist(distance)}
              </div>
              <div className="text-[9px] tracking-[0.3em] text-green-900 mt-1">
                DISTANCE_TO_TARGET
              </div>
            </div>

            {/* ─── Data readouts ─── */}
            <div className="grid grid-cols-2 gap-2 w-full max-w-[290px]">
              {[
                { label: 'HEADING',  value: fmtDeg(heading),   sub: '현재 방향각', rt: true  },
                { label: 'BEARING',  value: fmtDeg(bearing),   sub: '목표 방향각', rt: false },
                { label: 'CUR_LAT',  value: fmtCoord(userLat), sub: '현재 위도',   rt: true  },
                { label: 'CUR_LON',  value: fmtCoord(userLon), sub: '현재 경도',   rt: true  },
                { label: 'TGT_LAT',  value: fmtCoord(targetLat), sub: '목표 위도', rt: false },
                { label: 'TGT_LON',  value: fmtCoord(targetLon), sub: '목표 경도', rt: false },
              ].map(item => (
                <div
                  key={item.label}
                  className="border border-green-950 p-2.5"
                  style={{ background: 'rgba(0,12,0,0.6)' }}
                >
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-[9px] tracking-[0.15em] text-green-800">{item.label}</span>
                    {item.rt && <span className="text-[7px] text-green-800 animate-pulse">●LIVE</span>}
                  </div>
                  <div className="text-green-400 text-[11px] font-bold tabular-nums">{item.value}</div>
                  <div className="text-[8px] text-green-950 mt-0.5">{item.sub}</div>
                </div>
              ))}
            </div>

            {/* ─── Status line ─── */}
            <div className="text-center mt-4">
              {isArrived ? (
                <div className="text-[11px] tracking-[0.22em]"
                  style={{ color: '#ff3333', textShadow: '0 0 12px #ff333380' }}>
                  ■ &nbsp; DESTINATION_REACHED &nbsp; ■
                </div>
              ) : isAligned ? (
                <div className="text-[11px] tracking-[0.22em]"
                  style={{ color: '#00ff41', textShadow: '0 0 10px #00ff4180' }}>
                  ◆ &nbsp; ON_COURSE &nbsp; ◆
                </div>
              ) : (
                <div className="text-[11px] tracking-[0.22em] text-orange-600">
                  ◇ &nbsp; RECALIBRATING &nbsp; ◇
                </div>
              )}
            </div>

            {/* ─── Reset ─── */}
            <button
              onClick={() => { stopNoise(); setPhase('search'); setCompassVisible(false); }}
              className="mt-6 text-[9px] tracking-[0.2em] text-green-950 hover:text-green-800 transition-colors"
            >
              [ RESET / 좌표 재입력 ]
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
