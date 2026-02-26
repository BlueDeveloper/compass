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
  const [flickerIntensity, setFlickerIntensity] = useState(0.15);

  /* ── Search Form ── */
  const [inputCoords, setInputCoords] = useState('');
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
     ARRIVAL SOUND
  ═══════════════════════════════════════════ */
  const playArrivalSound = useCallback(() => {
    if (!audioCtxRef.current) return;
    try {
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {}
  }, []);

  /* ═══════════════════════════════════════════
     RANDOM FLICKER INTENSITY
  ═══════════════════════════════════════════ */
  useEffect(() => {
    const interval = setInterval(() => {
      setFlickerIntensity(0.1 + Math.random() * 0.25);
    }, 150);
    return () => clearInterval(interval);
  }, []);

  /* ═══════════════════════════════════════════
     INITIAL NOISE ON SEARCH SCREEN
  ═══════════════════════════════════════════ */
  useEffect(() => {
    if (phase === 'search') {
      initAudio();
      startNoise(0.15);
    }
    return () => {
      if (phase === 'search') {
        stopNoise();
      }
    };
  }, [phase, initAudio, startNoise, stopNoise]);

  /* ═══════════════════════════════════════════
     ARRIVAL DETECTION & SOUND
  ═══════════════════════════════════════════ */
  const arrivedRef = useRef(false);
  useEffect(() => {
    if (isArrived && !arrivedRef.current) {
      arrivedRef.current = true;
      playArrivalSound();
    } else if (!isArrived) {
      arrivedRef.current = false;
    }
  }, [isArrived, playArrivalSound]);

  /* ═══════════════════════════════════════════
     NOISE EFFECT
  ═══════════════════════════════════════════ */
  useEffect(() => {
    if (!permissionGranted || phase !== 'compass') return;
    if (isArrived) {
      if (noiseSrcRef.current) setNoiseVol(0.55);
      else startNoise(0.55);
    } else if (!isAligned) {
      const angleDifference = Math.abs(rotAngle > 180 ? 360 - rotAngle : rotAngle);
      const noiseVol = 0.05 + (angleDifference / 180) * 0.25;
      if (noiseSrcRef.current) setNoiseVol(noiseVol);
      else startNoise(noiseVol);
    } else {
      stopNoise();
    }
  }, [isAligned, isArrived, permissionGranted, phase, rotAngle, startNoise, stopNoise, setNoiseVol]);

  /* ═══════════════════════════════════════════
     SEARCH SUBMIT
  ═══════════════════════════════════════════ */
  const handleSearch = () => {
    setFormError('');

    const parts = inputCoords.trim().split(/\s+/);
    if (parts.length !== 2) {
      setFormError('위도와 경도를 공백으로 구분하여 입력하세요');
      return;
    }

    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lon))           { setFormError('유효한 좌표를 입력하세요'); return; }
    if (lat < -90  || lat > 90)             { setFormError('위도: -90 ~ +90 범위'); return; }
    if (lon < -180 || lon > 180)            { setFormError('경도: -180 ~ +180 범위'); return; }

    stopNoise();
    setIsShaking(true);
    startNoise(0.38);

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

  const getDirectionText = () => {
    if (heading === null || bearing === null) return 'Initializing...';

    const diff = Math.abs(angDiff(bearing, heading));
    const direction = angDiff(bearing, heading) > 0 ? 'right' : 'left';

    if (diff < 15) return 'Go straight ahead';
    if (diff < 45) return `Turn ${Math.round(diff)} degrees to the ${direction}...`;
    if (diff < 90) return `Turn ${Math.round(diff)} degrees to the ${direction}...`;
    return `Turn around (${Math.round(diff)}° to the ${direction})`;
  };

  /* ═══════════════════════════════════════════
     COMPASS BUBBLE POSITIONS
  ═══════════════════════════════════════════ */
  const targetAngle = rotAngle * Math.PI / 180;
  const targetX = 150 + Math.sin(targetAngle) * 100;
  const targetY = 150 - Math.cos(targetAngle) * 100;

  const currentAngle = 0;
  const currentX = 150 + Math.sin(currentAngle) * 50;
  const currentY = 150 - Math.cos(currentAngle) * 50;

  // Eclipse effect
  const eclipseProgress = Math.abs(rotAngle > 180 ? 360 - rotAngle : rotAngle) / 180;

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  return (
    <div
      className="min-h-screen text-black overflow-hidden select-none"
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        backgroundColor: `rgba(255, 255, 255, ${1 - flickerIntensity * 0.5})`,
        transition: 'background-color 0.1s ease-out'
      }}
    >
      <style>{`
        @keyframes backgroundFlicker {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(${1 - flickerIntensity * 0.3}); }
        }
      `}</style>

      {/* ══════════════════════════════════════════════
          SEARCH PHASE - 메인화면.png 스타일
      ══════════════════════════════════════════════ */}
      {phase === 'search' && (
        <div className="min-h-screen flex flex-col">
          <div className="flex-1 flex items-start pt-12 px-8">
            <div className="w-full max-w-2xl">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputCoords}
                  onChange={e => setInputCoords(e.target.value)}
                  placeholder="Ex: 37.5344789 126.9993445"
                  className="flex-1 px-4 py-3 border-2 border-gray-300 text-base focus:outline-none focus:border-gray-500"
                  onKeyPress={e => e.key === 'Enter' && handleSearch()}
                />
                <button
                  onClick={handleSearch}
                  className="px-8 py-3 border-2 border-black hover:bg-black hover:text-white transition-colors text-base whitespace-nowrap"
                >
                  확인
                </button>
              </div>
              {formError && (
                <div className="mt-2 text-sm text-red-600">{formError}</div>
              )}
            </div>
          </div>

          <div className="w-full bg-gray-100 py-8 flex justify-center items-center overflow-hidden">
            <img src="/MPa_LOGO.png" alt="MPa Logo" className="w-full h-20 object-cover" />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          COMPASS PHASE - 메인화면2.png 스타일
      ══════════════════════════════════════════════ */}
      {phase === 'compass' && (
        <div className="min-h-screen flex flex-col items-center justify-start p-8 pt-12">
          {!permissionGranted && (
            <button
              onClick={requestPermission}
              className="mb-8 px-6 py-3 border-2 border-black hover:bg-black hover:text-white transition-colors"
            >
              Enable Sensor
            </button>
          )}

          {/* Direction instruction */}
          <div className="mb-8 text-center">
            <p className="text-lg">{getDirectionText()}</p>
          </div>

          {/* Compass circles */}
          <div className="relative mb-8" style={{ width: 300, height: 300 }}>
            <svg width="300" height="300" viewBox="0 0 300 300">
              <defs>
                <mask id="eclipseMask">
                  <rect width="300" height="300" fill="white"/>
                  <circle
                    cx={150 + eclipseProgress * 135}
                    cy="150"
                    r="142"
                    fill="black"
                  />
                </mask>
              </defs>

              {/* Outer circle */}
              <circle cx="150" cy="150" r="140" fill="none" stroke="black" strokeWidth="2"/>

              {/* Eclipse effect */}
              <circle
                cx="150"
                cy="150"
                r="140"
                fill="black"
                mask="url(#eclipseMask)"
                opacity="0.8"
              />

              {/* Inner circle */}
              <circle cx="150" cy="150" r="70" fill="none" stroke="black" strokeWidth="2"/>

              {/* Current position (center) */}
              <circle cx={currentX} cy={currentY} r="8" fill="none" stroke="black" strokeWidth="2"/>
              <circle cx={currentX} cy={currentY} r="4" fill="black"/>

              {/* Target position */}
              <circle cx={targetX} cy={targetY} r="8" fill="none" stroke="black" strokeWidth="2"/>
              <circle cx={targetX} cy={targetY} r="4" fill="black"/>
            </svg>
          </div>

          {/* Distance */}
          <div className="text-center mb-8">
            <div className="text-4xl font-bold mb-2">{fmtDist(distance)}</div>
            <div className="text-sm text-gray-600">Distance to the destination</div>
          </div>

          {/* Info */}
          <div className="w-full max-w-sm text-sm space-y-1 border-t pt-4">
            <div className="flex justify-between">
              <span>Destination direction:</span>
              <span className="font-mono">{bearing !== null ? `${bearing.toFixed(0)}°` : '--'}</span>
            </div>
            <div className="flex justify-between">
              <span>Current direction:</span>
              <span className="font-mono">{heading !== null ? `${heading.toFixed(0)}°` : '--'}</span>
            </div>
            <div className="flex justify-between">
              <span>Destination location:</span>
              <span className="font-mono text-xs">{targetLat.toFixed(5)}, {targetLon.toFixed(5)}</span>
            </div>
            <div className="flex justify-between">
              <span>Current location:</span>
              <span className="font-mono text-xs">
                {userLat !== null ? userLat.toFixed(5) : '--'}, {userLon !== null ? userLon.toFixed(5) : '--'}
              </span>
            </div>
          </div>

          <button
            onClick={() => { stopNoise(); setPhase('search'); setCompassVisible(false); }}
            className="mt-8 text-sm text-gray-500 hover:text-black"
          >
            ← Back to search
          </button>
        </div>
      )}
    </div>
  );
}
