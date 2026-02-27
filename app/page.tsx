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
  const [audioStarted, setAudioStarted] = useState(false);

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
     DIRECTION-BASED FLICKER INTENSITY
  ═══════════════════════════════════════════ */
  useEffect(() => {
    const interval = setInterval(() => {
      let baseIntensity = 0.2;
      let randomRange = 0.5;

      if (phase === 'compass' && heading !== null && bearing !== null) {
        // 방향이 일치할수록 플리커 약함
        const angleDiff = Math.abs(angDiff(bearing, heading));
        const alignmentFactor = angleDiff / 180; // 0도 = 0, 180도 = 1

        baseIntensity = 0.05 + alignmentFactor * 0.15;
        randomRange = 0.1 + alignmentFactor * 0.4;
      }

      setFlickerIntensity(baseIntensity + Math.random() * randomRange);
    }, 80);
    return () => clearInterval(interval);
  }, [heading, bearing, phase]);

  /* ═══════════════════════════════════════════
     INITIAL NOISE ON SEARCH SCREEN
  ═══════════════════════════════════════════ */
  const handleScreenInteraction = useCallback(() => {
    if (!audioStarted && phase === 'search') {
      initAudio();
      startNoise(0.25);
      setAudioStarted(true);
    }
  }, [audioStarted, phase, initAudio, startNoise]);

  useEffect(() => {
    if (phase !== 'search') {
      setAudioStarted(false);
    }
    return () => {
      if (phase === 'search') {
        stopNoise();
      }
    };
  }, [phase, stopNoise]);

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
     DIRECTION-BASED NOISE EFFECT
  ═══════════════════════════════════════════ */
  useEffect(() => {
    if (!permissionGranted || phase !== 'compass') return;

    if (isArrived) {
      // 도착 시 특별한 사운드
      if (noiseSrcRef.current) setNoiseVol(0.55);
      else startNoise(0.55);
    } else if (heading !== null && bearing !== null) {
      // 방향 차이에 따라 노이즈 볼륨 조절 (일치할수록 약함)
      const angleDiff = Math.abs(angDiff(bearing, heading));
      const alignmentFactor = angleDiff / 180; // 0도 = 0, 180도 = 1
      const noiseVol = 0.05 + alignmentFactor * 0.35;

      if (noiseSrcRef.current) setNoiseVol(noiseVol);
      else startNoise(noiseVol);
    } else {
      stopNoise();
    }
  }, [heading, bearing, isArrived, permissionGranted, phase, startNoise, stopNoise, setNoiseVol]);

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
     COMPASS POSITIONS
  ═══════════════════════════════════════════ */
  // 사용자 위치 - heading 방향 (바깥쪽, 안쪽 원)
  const userHeading = heading !== null ? heading : 0;
  const userAngle = userHeading * Math.PI / 180;
  const userOuterX = 150 + Math.sin(userAngle) * 140;
  const userOuterY = 150 - Math.cos(userAngle) * 140;
  const userInnerX = 150 + Math.sin(userAngle) * 70;
  const userInnerY = 150 - Math.cos(userAngle) * 70;

  // 목표 지점 - bearing 방향 (바깥쪽 원)
  const targetBearing = bearing !== null ? bearing : 0;
  const targetAngle = targetBearing * Math.PI / 180;
  const targetX = 150 + Math.sin(targetAngle) * 140;
  const targetY = 150 - Math.cos(targetAngle) * 140;

  // Eclipse 효과 계산 (방향 차이 기반)
  const calculateEclipseEffect = () => {
    if (heading === null || bearing === null) return 0;

    // heading과 bearing의 차이 계산 (0~180도)
    const diff = Math.abs(angDiff(bearing, heading));

    // 차이가 0에 가까울수록 1에 가까운 값 (0도 = 1, 180도 = 0)
    const progress = Math.max(0, 1 - (diff / 180));

    return progress;
  };

  const eclipseProgress = calculateEclipseEffect();

  // 그라데이션 방향 계산 (목표 방향에서 사용자 원으로)
  const targetBearingRad = targetBearing * Math.PI / 180;
  const gradientX1 = userOuterX - Math.sin(targetBearingRad) * 6;
  const gradientY1 = userOuterY + Math.cos(targetBearingRad) * 6;
  const gradientX2 = userOuterX + Math.sin(targetBearingRad) * 6;
  const gradientY2 = userOuterY - Math.cos(targetBearingRad) * 6;

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  return (
    <div
      className="min-h-screen text-black overflow-hidden select-none"
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        backgroundColor: `rgba(255, 255, 255, ${1 - flickerIntensity * 0.9})`,
        transition: 'background-color 0.05s ease-out'
      }}
    >
      <style>{`
        @keyframes backgroundFlicker {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(${1 - flickerIntensity * 0.3}); }
        }
      `}</style>

      {/* Start overlay */}
      {phase === 'search' && !audioStarted && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center cursor-pointer"
          style={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}
          onClick={handleScreenInteraction}
        >
          <div className="text-center">
            <p className="text-lg text-gray-800">Tap to start</p>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          SEARCH PHASE - 메인화면.png 스타일
      ══════════════════════════════════════════════ */}
      {phase === 'search' && (
        <div className="min-h-screen flex flex-col">
          <div className="flex-1 flex items-start pt-8 px-4">
            <div className="w-full">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputCoords}
                  onChange={e => setInputCoords(e.target.value)}
                  placeholder="Ex: 37.2996 127.1123"
                  className="flex-1 px-3 py-2 border-2 border-gray-300 text-sm focus:outline-none focus:border-gray-500"
                  onKeyPress={e => e.key === 'Enter' && handleSearch()}
                />
                <button
                  onClick={handleSearch}
                  className="px-4 py-2 border-2 border-black hover:bg-black hover:text-white transition-colors text-sm whitespace-nowrap"
                >
                  확인
                </button>
              </div>
              {formError && (
                <div className="mt-2 text-xs text-red-600">{formError}</div>
              )}
            </div>
          </div>

          <div className="w-full bg-gray-100 py-6 flex justify-center items-center overflow-hidden">
            <img src="/MPa_LOGO.png" alt="MPa Logo" className="w-full h-16 object-cover" />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          COMPASS PHASE - 메인화면2.png 스타일
      ══════════════════════════════════════════════ */}
      {phase === 'compass' && (
        <div className="min-h-screen flex flex-col items-center justify-start p-4 pt-8">
          {!permissionGranted && (
            <button
              onClick={requestPermission}
              className="mb-6 px-5 py-2 border-2 border-black hover:bg-black hover:text-white transition-colors text-sm"
            >
              Enable Sensor
            </button>
          )}

          {/* Direction instruction */}
          <div className="mb-6 text-center px-2">
            <p className="text-base">{getDirectionText()}</p>
            <p className="text-xs text-gray-500 mt-2">
              Heading: {heading !== null ? `${heading.toFixed(1)}°` : 'No sensor data'}
            </p>
          </div>

          {/* Compass circles */}
          <div className="relative mb-6" style={{ width: 280, height: 280 }}>
            <svg width="280" height="280" viewBox="0 0 300 300">
              <defs>
                {/* 목표 방향에서 시작하는 그라데이션 */}
                <linearGradient
                  id="userFillGradient"
                  x1={gradientX1}
                  y1={gradientY1}
                  x2={gradientX2}
                  y2={gradientY2}
                  gradientUnits="userSpaceOnUse"
                >
                  <stop offset="0%" stopColor="black" stopOpacity="1" />
                  <stop offset={`${eclipseProgress * 100}%`} stopColor="black" stopOpacity="1" />
                  <stop offset={`${eclipseProgress * 100}%`} stopColor="black" stopOpacity="0" />
                  <stop offset="100%" stopColor="black" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* 고정된 나침반 원들 */}
              {/* Outer circle */}
              <circle cx="150" cy="150" r="140" fill="none" stroke="black" strokeWidth="2"/>

              {/* Inner circle */}
              <circle cx="150" cy="150" r="70" fill="none" stroke="black" strokeWidth="2"/>

              {/* 북쪽 방향 표시 (12시 방향 고정) */}
              <circle cx="150" cy="10" r="4" fill="gray"/>
              <text x="150" y="32" textAnchor="middle" fontSize="12" fill="gray">N</text>

              {/* 사용자 위치 (heading 방향에 따라 움직임) */}
              {/* 바깥쪽 원 위의 사용자 위치 - 목표 방향에서부터 채워짐 */}
              <circle cx={userOuterX} cy={userOuterY} r="6" fill="url(#userFillGradient)"/>
              <circle cx={userOuterX} cy={userOuterY} r="6" fill="none" stroke="black" strokeWidth="2"/>

              {/* 안쪽 원 위의 사용자 위치 */}
              <circle cx={userInnerX} cy={userInnerY} r="6" fill="none" stroke="black" strokeWidth="2"/>

              {/* 목표 지점 (개발용 - 임시 표시) */}
              <circle cx={targetX} cy={targetY} r="8" fill="none" stroke="red" strokeWidth="2"/>
              <circle cx={targetX} cy={targetY} r="4" fill="red"/>
            </svg>
          </div>

          {/* Distance */}
          <div className="text-center mb-6">
            <div className="text-3xl font-bold mb-2">{fmtDist(distance)}</div>
            <div className="text-xs text-gray-600">Distance to the destination</div>
          </div>

          {/* Info */}
          <div className="w-full px-4 text-xs space-y-1 border-t pt-3">
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
            className="mt-6 text-xs text-gray-500 hover:text-black"
          >
            ← Back to search
          </button>
        </div>
      )}
    </div>
  );
}
