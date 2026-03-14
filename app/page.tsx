'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import styles from './page.module.css';

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
const DEFAULT_LAT = 37.5344789;
const DEFAULT_LON = 126.9993445;
const ARRIVAL_KM  = 0.05;
const ALIGN_DEG   = 5;
const FILL_MAX_KM = 1;

/* ═══════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════ */
export default function CompassPage() {

  /* ── Phase ── */
  const [phase,             setPhase]             = useState<'intro' | 'search' | 'compass'>('intro');
  const [tapReady,          setTapReady]          = useState(false);
  const [isFading,          setIsFading]          = useState(false);
  const [compassFadeIn,     setCompassFadeIn]     = useState(false);
  const [introProgress,     setIntroProgress]     = useState(0);
  const [keyboardVisible,   setKeyboardVisible]   = useState(false);
  const [vvOffsetTop,       setVvOffsetTop]       = useState(0);

  /* ── Arrival ── */
  const [arrivedPending, setArrivedPending] = useState(false); // "Arrived." 텍스트 표시
  const [isArrived,      setIsArrived]      = useState(false); // 다크모드 전환

  /* ── Search ── */
  const [inputCoords, setInputCoords] = useState('37.5344789, 126.9993445');
  const [formError,   setFormError]   = useState('');

  /* ── Target ── */
  const [targetLat, setTargetLat] = useState(DEFAULT_LAT);
  const [targetLon, setTargetLon] = useState(DEFAULT_LON);

  /* ── Sensor ── */
  const [userLat,           setUserLat]           = useState<number | null>(null);
  const [userLon,           setUserLon]           = useState<number | null>(null);
  const [heading,           setHeading]           = useState<number | null>(null);
  const [permissionGranted,  setPermissionGranted]  = useState(false);
  const [geoDenied,          setGeoDenied]          = useState(false);
  const [orientationDenied,  setOrientationDenied]  = useState(false);
  const [geoError,           setGeoError]           = useState<string | null>(null);

  /* ── Navigation ── */
  const [distance,       setDistance]       = useState<number | null>(null);
  const [displayVolume,  setDisplayVolume]  = useState(0); // 나침반 배경음 음량 표시 (%)
  const [bearing,   setBearing]   = useState<number | null>(null);
  const [isAligned, setIsAligned] = useState(false);

  /* ── Tilt (gyroscope) ── */
  const [tiltBeta,  setTiltBeta]  = useState(0);
  const [tiltGamma, setTiltGamma] = useState(0);

  /* ── Refs ── */
  const lastHRef              = useRef<number | null>(null);
  const cntRef                = useRef(0);
  const geoWatchRef           = useRef<number | null>(null);
  const arrivedTriggeredRef   = useRef(false);
  const arrivalTimerRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const compassFadeInDoneRef  = useRef(false);
  const compassFadeInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDistanceRef    = useRef<number | null>(null);
  const simulatingRef           = useRef(false);
  const simulationTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const simulationStartDistRef  = useRef<number>(1.0);

  /* ── Audio refs ── */
  const flickerAudioRef   = useRef<HTMLAudioElement | null>(null);
  const compassBgAudioRef = useRef<HTMLAudioElement | null>(null);
  const poweroffAudioRef  = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef       = useRef<AudioContext | null>(null);
  const compassGainRef    = useRef<GainNode | null>(null);
  const poweroffGainRef   = useRef<GainNode | null>(null);

  /* ── Audio helpers (엘리먼트 생성만, AudioContext 없음) ── */
  const getFlickerAudio = useCallback(() => {
    if (!flickerAudioRef.current) {
      flickerAudioRef.current = new Audio('/flicker.wav');
      flickerAudioRef.current.loop = true;
    }
    return flickerAudioRef.current;
  }, []);

  const getCompassBgAudio = useCallback(() => {
    if (!compassBgAudioRef.current) {
      compassBgAudioRef.current = new Audio('/compass-bg.wav');
      compassBgAudioRef.current.loop = true;
    }
    return compassBgAudioRef.current;
  }, []);

  const getPoweroffAudio = useCallback(() => {
    if (!poweroffAudioRef.current) {
      poweroffAudioRef.current = new Audio('/poweroff.wav');
    }
    return poweroffAudioRef.current;
  }, []);

  /* ── AudioContext + GainNode 연결 — 반드시 유저 제스처 후 호출 ── */
  const initAudioCtx = useCallback(() => {
    if (audioCtxRef.current) { audioCtxRef.current.resume(); return; }
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    ctx.resume();

    const connect = (el: HTMLAudioElement, initialGain: number): GainNode => {
      const src  = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = initialGain;
      src.connect(gain);
      gain.connect(ctx.destination);
      return gain;
    };

    connect(getFlickerAudio(), 1.5); // 150% 고정, ref 불필요

    /* poweroff: 유저 제스처 컨텍스트 내에서 play+pause로 iOS unlock
       gain=0 유지 → pause 후에 2.0 설정 (unlock 중 소리 방지) */
    const poGain = connect(getPoweroffAudio(), 0);
    poweroffGainRef.current = poGain;
    const poEl = getPoweroffAudio();
    poEl.play()
      .then(() => { poEl.pause(); poEl.currentTime = 0; poGain.gain.value = 2.0; })
      .catch(() => { poGain.gain.value = 2.0; });

    requestAnimationFrame(() => {
      compassGainRef.current = connect(getCompassBgAudio(), 0); // 0 → 나침반 진입 시 페이드인
    });
  }, [getFlickerAudio, getCompassBgAudio, getPoweroffAudio]);

  /* ── Audio preload on mount (AudioContext 없이 파일만 로드) ── */
  useEffect(() => {
    getFlickerAudio().load();
    getCompassBgAudio().load();
    getPoweroffAudio().load();
    return () => {
      flickerAudioRef.current?.pause();
      compassBgAudioRef.current?.pause();
      poweroffAudioRef.current?.pause();
      audioCtxRef.current?.close();
      if (compassFadeInTimerRef.current) clearTimeout(compassFadeInTimerRef.current);
      if (simulationTimerRef.current)    clearInterval(simulationTimerRef.current);
    };
  }, [getFlickerAudio, getCompassBgAudio, getPoweroffAudio]);

  /* ── 나침반 음량 실시간 폴링 (rAF로 실제 gain 값 추적) ── */
  useEffect(() => {
    if (phase !== 'compass') return;
    let rafId: number;
    let lastVal = -1;
    const poll = () => {
      if (compassGainRef.current) {
        const v = Math.round(compassGainRef.current.gain.value * 100);
        if (v !== lastVal) { lastVal = v; setDisplayVolume(v); }
      }
      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [phase]);

  /* ── 거리 기반 나침반 음량 조절 (페이드인 완료 후) ── */
  useEffect(() => {
    if (!compassFadeInDoneRef.current) return;
    if (!compassGainRef.current || !audioCtxRef.current) return;
    if (distance === null || arrivedPending || isArrived) return;

    /* 초기 거리 기록 */
    if (initialDistanceRef.current === null) {
      initialDistanceRef.current = distance;
      return;
    }

    const DIST_START = initialDistanceRef.current; // 진입 시 거리 = 150% 기준점
    const DIST_END   = 0;                          // 0km = 200%
    const GAIN_MIN   = 1.5;
    const GAIN_MAX   = 2.0;

    const t = DIST_START <= 0 ? 1 : Math.max(0, Math.min(1, (DIST_START - distance) / DIST_START));
    const g = GAIN_MIN + (GAIN_MAX - GAIN_MIN) * t;

    const ctx = audioCtxRef.current;
    compassGainRef.current.gain.cancelScheduledValues(ctx.currentTime);
    compassGainRef.current.gain.setValueAtTime(g, ctx.currentTime);
  }, [distance, arrivedPending, isArrived]);

  /* ═══════════════════════════════════════════
     INTRO
  ═══════════════════════════════════════════ */
  useEffect(() => {
    if (phase !== 'intro') return;
    const start = Date.now();
    const duration = 3000;
    const id = setInterval(() => {
      const pct = Math.min(100, Math.floor((Date.now() - start) / duration * 100));
      setIntroProgress(pct);
      if (pct >= 100) { clearInterval(id); setTapReady(true); }
    }, 30);
    return () => clearInterval(id);
  }, [phase]);

  /* ── 키보드 감지 + iOS 스크롤 오프셋 추적 (search 화면에서만) ── */
  useEffect(() => {
    if (phase !== 'search') {
      setKeyboardVisible(false);
      setVvOffsetTop(0);
      return;
    }
    const vv = (window as any).visualViewport;
    if (!vv) return;
    const handler = () => {
      setKeyboardVisible(vv.height < window.innerHeight - 100);
      setVvOffsetTop(vv.offsetTop ?? 0);
    };
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
    };
  }, [phase]);

  const handleTapStart = useCallback(() => {
    if (!tapReady) return;
    initAudioCtx();
    getFlickerAudio().play().catch(() => {});
    setIsFading(true);
    setTimeout(() => { setPhase('search'); setIsFading(false); }, 60);
  }, [tapReady, getFlickerAudio, initAudioCtx]);

  /* ═══════════════════════════════════════════
     GEOLOCATION
  ═══════════════════════════════════════════ */
  const startGeo = useCallback(() => {
    if (!navigator.geolocation) { setGeoError('위치 서비스를 지원하지 않는 브라우저입니다.'); return; }
    if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current);
    geoWatchRef.current = navigator.geolocation.watchPosition(
      p => { setGeoError(null); setUserLat(p.coords.latitude); setUserLon(p.coords.longitude); },
      e => {
        if (e.code === e.PERMISSION_DENIED) {
          setGeoDenied(true);
          setGeoError(null);
        } else {
          setGeoError('위치를 가져올 수 없습니다.');
        }
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
    );
  }, []);

  useEffect(() => {
    return () => { if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current); };
  }, []);

  /* ═══════════════════════════════════════════
     SENSOR PERMISSION
  ═══════════════════════════════════════════ */
  const requestPermission = useCallback(async () => {
    if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function') {
      const r = await (DeviceOrientationEvent as any).requestPermission();
      if (r === 'granted') { setPermissionGranted(true); setOrientationDenied(false); }
      else setOrientationDenied(true);
    } else {
      setPermissionGranted(true);
    }
  }, []);

  /* search 진입 시 모든 권한 요청 */
  useEffect(() => {
    if (phase === 'search') {
      startGeo();
      requestPermission();
    }
  }, [phase, startGeo, requestPermission]);

  /* ═══════════════════════════════════════════
     ARRIVAL
  ═══════════════════════════════════════════ */
  const triggerArrival = useCallback(() => {
    if (arrivedTriggeredRef.current) return;
    arrivedTriggeredRef.current = true;
    setArrivedPending(true);

    /* 5초 후 다크모드 전환 — 그동안 나침반 음원 유지 */
    if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    arrivalTimerRef.current = setTimeout(() => {
      /* 5초 시점에 나침반 배경음 페이드아웃 */
      if (compassGainRef.current && audioCtxRef.current) {
        const ctx = audioCtxRef.current;
        compassGainRef.current.gain.cancelScheduledValues(ctx.currentTime);
        compassGainRef.current.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
      }
      /* 나침반 배경음 페이드아웃 완료 후 pause (끊김 방지) */
      setTimeout(() => { compassBgAudioRef.current?.pause(); }, 850);

      /* 파워오프 재생 — AudioContext resume 완료 후 play */
      if (poweroffGainRef.current) poweroffGainRef.current.gain.value = 2.0;
      const playPoweroff = () => {
        const po = getPoweroffAudio();
        po.currentTime = 0;
        po.play().catch(() => {});
      };
      if (audioCtxRef.current) {
        audioCtxRef.current.resume().then(playPoweroff).catch(playPoweroff);
      } else {
        playPoweroff();
      }
      setIsArrived(true);
    }, 5000);
  }, [getPoweroffAudio]);

  /* 과녁 클릭 — 5초 거리 감소 시뮬레이션 → 도착 전환 / 재클릭 시 리셋 */
  const handleTestClick = useCallback(() => {
    /* 리셋: 시뮬 중이거나 도착 상태면 초기화 */
    if (simulatingRef.current || arrivedTriggeredRef.current) {
      if (simulationTimerRef.current) { clearInterval(simulationTimerRef.current); simulationTimerRef.current = null; }
      if (arrivalTimerRef.current)    { clearTimeout(arrivalTimerRef.current);     arrivalTimerRef.current = null; }
      simulatingRef.current        = false;
      arrivedTriggeredRef.current  = false;
      initialDistanceRef.current   = null;
      compassFadeInDoneRef.current = true;
      setArrivedPending(false);
      setIsArrived(false);
      setDistance(null);
      if (compassGainRef.current && audioCtxRef.current) {
        compassGainRef.current.gain.cancelScheduledValues(audioCtxRef.current.currentTime);
        compassGainRef.current.gain.setValueAtTime(1.5, audioCtxRef.current.currentTime);
      }
      compassBgAudioRef.current?.play().catch(() => {});
      return;
    }

    /* 시뮬 시작 */
    const startDist = distance ?? 1.0;
    initialDistanceRef.current      = startDist;
    simulationStartDistRef.current  = startDist;
    compassFadeInDoneRef.current = true;
    simulatingRef.current        = true;
    const startTime = Date.now();

    if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
    simulationTimerRef.current = setInterval(() => {
      const t       = Math.min(1, (Date.now() - startTime) / 5000);
      const newDist = startDist * (1 - t);
      setDistance(newDist);

      if (newDist < ARRIVAL_KM && !arrivedTriggeredRef.current) {
        clearInterval(simulationTimerRef.current!);
        simulationTimerRef.current = null;
        setDistance(0);
        triggerArrival();
      }
      if (t >= 1) {
        clearInterval(simulationTimerRef.current!);
        simulationTimerRef.current = null;
      }
    }, 50);
  }, [distance, triggerArrival]);

  /* ═══════════════════════════════════════════
     HEADING SENSOR
  ═══════════════════════════════════════════ */
  const mod360  = (d: number) => ((d % 360) + 360) % 360;
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

  useEffect(() => {
    if (!permissionGranted) return;
    let lastT = 0;
    const THROTTLE = 80;

    if (typeof (window as any).AbsoluteOrientationSensor !== 'undefined') {
      try {
        const sensor = new (window as any).AbsoluteOrientationSensor({ frequency: 60 });
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

  /* ── Tilt (gyroscope beta/gamma) ── */
  useEffect(() => {
    if (!permissionGranted) return;
    const handler = (e: DeviceOrientationEvent) => {
      if (e.beta  !== null) { const b = Math.max(-90, Math.min(90, e.beta));  setTiltBeta(p  => p  + 0.25 * (b - p)); }
      if (e.gamma !== null) { const g = Math.max(-90, Math.min(90, e.gamma)); setTiltGamma(p => p + 0.25 * (g - p)); }
    };
    window.addEventListener('deviceorientation', handler, true);
    return () => window.removeEventListener('deviceorientation', handler, true);
  }, [permissionGranted]);

  /* ═══════════════════════════════════════════
     NAVIGATION MATH
  ═══════════════════════════════════════════ */
  const calcBearing = (la1: number, lo1: number, la2: number, lo2: number): number => {
    const r = Math.PI / 180, dl = (lo2 - lo1) * r;
    return (Math.atan2(
      Math.sin(dl) * Math.cos(la2 * r),
      Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos(dl)
    ) * 180 / Math.PI + 360) % 360;
  };

  const calcDist = (la1: number, lo1: number, la2: number, lo2: number): number => {
    const r = Math.PI / 180, R = 6371;
    const a = Math.sin(((la2 - la1) * r) / 2) ** 2
            + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  useEffect(() => {
    if (userLat === null || userLon === null || heading === null) return;
    const b = calcBearing(userLat, userLon, targetLat, targetLon);
    const d = calcDist(userLat, userLon, targetLat, targetLon);
    setBearing(b);
    if (!simulatingRef.current) {
      setDistance(d);
      if (d < ARRIVAL_KM && !arrivedTriggeredRef.current) triggerArrival();
    }
    setIsAligned(Math.abs(angDiff(b, heading)) <= ALIGN_DEG);
  }, [userLat, userLon, heading, targetLat, targetLon, triggerArrival]);

  /* ═══════════════════════════════════════════
     SEARCH SUBMIT
  ═══════════════════════════════════════════ */
  const handleSearch = () => {
    setFormError('');
    const parts = inputCoords.trim().split(/[\s,]+/);
    if (parts.length !== 2) { setFormError('위도와 경도를 공백으로 구분하여 입력하세요'); return; }
    const lat = parseFloat(parts[0]), lon = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lon)) { setFormError('올바른 좌표를 입력하세요'); return; }
    if (lat < -90  || lat > 90)   { setFormError('위도: -90 ~ +90'); return; }
    if (lon < -180 || lon > 180)  { setFormError('경도: -180 ~ +180'); return; }

    /* 검색화면 음 정지 */
    flickerAudioRef.current?.pause();

    /* 나침반 배경음: 0→1s 무음, 1→4s 0%→150% 페이드인 */
    const audio = getCompassBgAudio();
    audio.currentTime = 0;
    audio.play().catch(() => {});

    if (compassGainRef.current && audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      const g   = compassGainRef.current.gain;
      g.cancelScheduledValues(ctx.currentTime);
      g.setValueAtTime(0, ctx.currentTime);               // 0s: 0%
      g.linearRampToValueAtTime(1.5, ctx.currentTime + 5); // 5s: 150%

      compassFadeInDoneRef.current = false;
      if (compassFadeInTimerRef.current) clearTimeout(compassFadeInTimerRef.current);
      compassFadeInTimerRef.current = setTimeout(() => {
        compassFadeInDoneRef.current = true;
      }, 5100);
    }

    setTargetLat(lat);
    setTargetLon(lon);
    arrivedTriggeredRef.current  = false;
    initialDistanceRef.current   = null;
    setArrivedPending(false);
    setIsArrived(false);
    setPhase('compass');
  };

  /* ═══════════════════════════════════════════
     COMPASS GEOMETRY
  ═══════════════════════════════════════════ */
  const RING_R = 124;

  const userCircleX = 150;
  const userCircleY = 150 - RING_R;

  const relAngle   = ((bearing ?? 0) - (heading ?? 0)) * Math.PI / 180;
  const tgtCircleX = 150 + Math.sin(relAngle) * RING_R;
  const tgtCircleY = 150 - Math.cos(relAngle) * RING_R;

  const rawCrossX  = 150 + tiltGamma * (60 / 90);
  const rawCrossY  = 150 + tiltBeta  * (60 / 90);
  const crossDx    = rawCrossX - 150, crossDy = rawCrossY - 150;
  const crossDist  = Math.sqrt(crossDx * crossDx + crossDy * crossDy);
  const crossClamp = crossDist > 60 ? 60 / crossDist : 1;
  const smallCrossX = 150 + crossDx * crossClamp;
  const smallCrossY = 150 + crossDy * crossClamp;

  const fillMax = simulatingRef.current
    ? simulationStartDistRef.current
    : FILL_MAX_KM;
  const distProgress = distance !== null
    ? Math.max(0, Math.min(1, 1 - distance / fillMax))
    : 0;

  const fmtDist = (d: number | null) =>
    d === null ? '---' : (isArrived || arrivedPending) ? '0.00km' : `${d.toFixed(2)}km`;

  const turnDeg = bearing !== null && heading !== null
    ? Math.round(Math.abs(angDiff(bearing, heading))) : null;
  const turnDir = bearing !== null && heading !== null
    ? (angDiff(bearing, heading) > 0 ? 'right' : 'left') : null;

  const corners = [[15, 15], [285, 15], [15, 285], [285, 285]] as const;

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  return (
    <div className={styles.root}>

      {isFading      && <div className={styles.fadeOverlay}   aria-hidden="true" />}
      {compassFadeIn && <div className={styles.fadeOverlayIn} aria-hidden="true" />}

      {/* ══════════════════════════════════════
          INTRO SCREEN
      ══════════════════════════════════════ */}
      {phase === 'intro' && (
        <div
          className={`${styles.introScreen} ${tapReady ? styles.introReady : ''}`}
          onClick={handleTapStart}
        >
          <div className={styles.introContent}>
            <div className={styles.logoBox}>
              <img src="/MPa_LOGO.svg" alt="MPa Logo" className={styles.logoImg} />
            </div>
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${introProgress}%` }} />
              <span className={styles.progressText}>
                {tapReady ? 'Tap to search' : `Loading ${introProgress}%`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          SEARCH SCREEN
      ══════════════════════════════════════ */}
      {phase === 'search' && (
        <div
          className={`${styles.searchScreen} ${keyboardVisible ? styles.searchKeyboard : ''}`}
          style={keyboardVisible ? { transform: `translateY(${vvOffsetTop}px)` } : undefined}
        >
          <div className={styles.tvBg} aria-hidden="true" />
          <div className={styles.searchLogoLayer}>
            <div className={styles.logoBox}>
              <img src="/MPa_LOGO.svg" alt="MPa Logo" className={styles.logoImg} />
            </div>
          </div>
          <div className={styles.searchInputLayer}>
            <div className={styles.inputBox}>
              <input
                type="text"
                value={inputCoords}
                onChange={e => setInputCoords(e.target.value)}
                placeholder="위도, 경도"
                className={styles.coordInput}
                onKeyPress={e => e.key === 'Enter' && handleSearch()}
              />
              {formError && <p className={styles.errorText}>{formError}</p>}
            </div>
            {(geoDenied || orientationDenied) && (
              <div className={styles.permissionWarning}>
                {geoDenied && (
                  <p>위치 권한 필요: 설정 &gt; 개인정보 &gt; 위치서비스 &gt; Safari</p>
                )}
                {orientationDenied && (
                  <p>나침반 권한 필요: 설정 &gt; Safari &gt; 동작 및 방향</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          COMPASS SCREEN
      ══════════════════════════════════════ */}
      {phase === 'compass' && (
        <div className={`${styles.compassScreen} ${isArrived ? styles.arrivalMode : ''}`}>

          {!isArrived && !arrivedPending && <div className={styles.compassFlicker} aria-hidden="true" />}

          {/* 로고 — 과녁(좌측 원형) 클릭 시 도착 처리 */}
          <div className={styles.compassLogoBox}>
            <div className={styles.logoBox} style={{ position: 'relative' }}>
              <img src="/MPa_LOGO.svg" alt="MPa Logo" className={styles.logoImg} />
              {/* 과녁 클릭 영역: 로고 좌측 원 부분 (viewBox 기준 ~18.3%) */}
              <div
                style={{ position: 'absolute', left: 0, top: 0, width: '18.3%', height: '100%', cursor: 'pointer' }}
                onClick={handleTestClick}
              />
            </div>
          </div>

          {/* 거리 바 — distBar 클릭으로 도착 테스트 */}
          <div className={styles.distBar}>
            <div className={styles.distTrack}>
              <div className={styles.distFill} style={{ width: `${distProgress * 100}%` }} />
            </div>
            <div className={styles.distTextRow}>
              <span>Distance to destination</span>
              <span>{fmtDist(distance)}</span>
            </div>
          </div>


          {/* 나침반 SVG */}
          <div className={styles.compassArea}>
            <div className={styles.compassSvgWrap}>
              <svg width="100%" height="100%" viewBox="-20 -20 340 340" overflow="visible">
                <defs>
                  <clipPath id="tgtClip">
                    <circle cx={tgtCircleX} cy={tgtCircleY} r="12" />
                  </clipPath>
                  <filter id="glowFilter" x="-150%" y="-150%" width="400%" height="400%">
                    <feGaussianBlur stdDeviation="5" result="blur1" />
                    <feGaussianBlur in="SourceGraphic" stdDeviation="11" result="blur2" />
                    <feMerge>
                      <feMergeNode in="blur2" />
                      <feMergeNode in="blur1" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* 꼭지점 십자가 */}
                {corners.map(([cx, cy], i) => (
                  <g key={i}>
                    <line x1={cx - 6} y1={cy}     x2={cx + 6} y2={cy}     stroke="#000" strokeWidth="1.95" />
                    <line x1={cx}     y1={cy - 6}  x2={cx}     y2={cy + 6} stroke="#000" strokeWidth="1.95" />
                  </g>
                ))}

                {/* 내부 큰 십자가 */}
                <line x1="90"  y1="150" x2="210" y2="150" stroke="#000" strokeWidth="1.5" />
                <line x1="150" y1="90"  x2="150" y2="210" stroke="#000" strokeWidth="1.5" />

                {/* 원 그룹 — 도착 시 fade out */}
                <g className={styles.compassCircles}>
                  <circle cx="150" cy="150" r={RING_R} fill="none" stroke="#000" strokeWidth="1.95" />

                  {isAligned && (
                    <circle cx={tgtCircleX} cy={tgtCircleY} r="12" fill="black" filter="url(#glowFilter)" className={styles.glowCircle} />
                  )}

                  <circle cx={tgtCircleX} cy={tgtCircleY} r="12" fill="none" stroke="black" strokeWidth="1.95" />
                  <circle cx={userCircleX} cy={userCircleY} r="12" fill="black" clipPath="url(#tgtClip)" />
                </g>

                {/* 내부작은십자가 — 도착 시 자연스럽게 fade out */}
                {!isArrived && (
                  <g className={arrivedPending ? styles.svgFadeOut : undefined}>
                    <line x1={smallCrossX - 12} y1={smallCrossY}      x2={smallCrossX + 12} y2={smallCrossY}      stroke="#000" strokeWidth="2.2" />
                    <line x1={smallCrossX}      y1={smallCrossY - 12} x2={smallCrossX}      y2={smallCrossY + 12} stroke="#000" strokeWidth="2.2" />
                  </g>
                )}
              </svg>
            </div>
          </div>

          {/* 방향 안내 문구 */}
          <div className={styles.directionGuide}>
            {(isArrived || arrivedPending)
              ? 'Arrived.'
              : isAligned
                ? 'Direction to destination. Go straight.'
                : turnDeg !== null
                  ? `Turn ${turnDeg} degrees to the ${turnDir}...`
                  : '--'}
          </div>

          {/* 하단 정보 */}
          <div className={styles.infoSection}>
            <div className={styles.infoGroup}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Current Tilt:</span>
                <span className={styles.infoVal}>{tiltBeta.toFixed(0)}°</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Current direction:</span>
                <span className={styles.infoVal}>{heading !== null ? `${heading.toFixed(0)}°` : '--'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Destination direction:</span>
                <span className={styles.infoVal}>{bearing !== null ? `${bearing.toFixed(0)}°` : '--'}</span>
              </div>
            </div>

            <div className={styles.infoGroup}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Current location:</span>
                <span className={styles.infoVal}>
                  {userLat !== null ? userLat.toFixed(5) : '--'},&nbsp;
                  {userLon !== null ? userLon.toFixed(5) : '--'}
                </span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Destination location:</span>
                <span className={styles.infoVal}>{targetLat.toFixed(5)},&nbsp;{targetLon.toFixed(5)}</span>
              </div>
            </div>

            {geoError && (
              <div className={styles.geoError}>
                <span>{geoError}</span>
                <button onClick={startGeo} className={styles.retryBtn}>재시도</button>
              </div>
            )}

          </div>

        </div>
      )}

    </div>
  );
}
