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
  const [phase,          setPhase]          = useState<'intro' | 'search' | 'compass'>('intro');
  const [tapReady,       setTapReady]       = useState(false);
  const [isFading,       setIsFading]       = useState(false);
  const [compassFadeIn,  setCompassFadeIn]  = useState(false);
  const [introProgress,  setIntroProgress]  = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [vvOffsetTop,     setVvOffsetTop]     = useState(0);

  /* ── Search ── */
  const [inputCoords, setInputCoords] = useState('37.5344789 126.9993445');
  const [formError, setFormError] = useState('');

  /* ── Target ── */
  const [targetLat, setTargetLat] = useState(DEFAULT_LAT);
  const [targetLon, setTargetLon] = useState(DEFAULT_LON);

  /* ── Sensor ── */
  const [userLat,           setUserLat]           = useState<number | null>(null);
  const [userLon,           setUserLon]           = useState<number | null>(null);
  const [heading,           setHeading]           = useState<number | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [geoError,          setGeoError]          = useState<string | null>(null);

  /* ── Navigation ── */
  const [distance,  setDistance]  = useState<number | null>(null);
  const [bearing,   setBearing]   = useState<number | null>(null);
  const [isAligned, setIsAligned] = useState(false);
  const [isArrived, setIsArrived] = useState(false);

  /* ── Tilt (gyroscope) — 수평(flat) = beta:0, gamma:0 ── */
  const [tiltBeta,  setTiltBeta]  = useState(0);
  const [tiltGamma, setTiltGamma] = useState(0);

  /* ── Refs ── */
  const lastHRef         = useRef<number | null>(null);
  const cntRef           = useRef(0);
  const geoWatchRef      = useRef<number | null>(null);
  const manualArrivedRef = useRef(false);
  const flickerAudioRef   = useRef<HTMLAudioElement | null>(null);
  const compassBgAudioRef = useRef<HTMLAudioElement | null>(null);

  /* ── Audio helpers ── */
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

  /* ── Audio cleanup on unmount ── */
  useEffect(() => {
    return () => {
      flickerAudioRef.current?.pause();
      compassBgAudioRef.current?.pause();
    };
  }, []);

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
    getFlickerAudio().play().catch(() => {});
    setIsFading(true);
    setTimeout(() => { setPhase('search'); setIsFading(false); }, 60);
  }, [tapReady, getFlickerAudio]);

  /* ═══════════════════════════════════════════
     GEOLOCATION
  ═══════════════════════════════════════════ */
  const startGeo = useCallback(() => {
    if (!navigator.geolocation) { setGeoError('위치 서비스를 지원하지 않는 브라우저입니다.'); return; }
    if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current);
    geoWatchRef.current = navigator.geolocation.watchPosition(
      p => { setGeoError(null); setUserLat(p.coords.latitude); setUserLon(p.coords.longitude); },
      e => setGeoError(e.code === e.PERMISSION_DENIED
        ? '위치 권한이 거부되었습니다.\niOS: 설정 > 개인정보 > 위치서비스 > Safari'
        : '위치를 가져올 수 없습니다.'),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
    );
  }, []);

  useEffect(() => {
    startGeo();
    return () => { if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current); };
  }, [startGeo]);

  /* ═══════════════════════════════════════════
     SENSOR PERMISSION
  ═══════════════════════════════════════════ */
  const requestPermission = useCallback(async () => {
    if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function') {
      const r = await (DeviceOrientationEvent as any).requestPermission();
      if (r === 'granted') setPermissionGranted(true);
    } else {
      setPermissionGranted(true);
    }
  }, []);

  /* 도착 → 나침반 배경음 정지 */
  useEffect(() => {
    if (!isArrived) return;
    compassBgAudioRef.current?.pause();
  }, [isArrived]);

  /* compass 진입 시 권한 요청 + 위치 미허용이면 재요청 */
  useEffect(() => {
    if (phase === 'compass') {
      requestPermission();
      if (userLat === null) startGeo();
    }
  }, [phase, requestPermission]);

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
      if (e.beta  !== null) setTiltBeta(p  => p  + 0.25 * (e.beta!  - p));
      if (e.gamma !== null) setTiltGamma(p => p + 0.25 * (e.gamma! - p));
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
    setDistance(d);
    setIsAligned(Math.abs(angDiff(b, heading)) <= ALIGN_DEG);
    setIsArrived(d < ARRIVAL_KM || manualArrivedRef.current);
  }, [userLat, userLon, heading, targetLat, targetLon]);

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

    flickerAudioRef.current?.pause();
    getCompassBgAudio().play().catch(() => {});
    setTargetLat(lat);
    setTargetLon(lon);
    setPhase('compass');
  };

  /* ═══════════════════════════════════════════
     COMPASS GEOMETRY
  ═══════════════════════════════════════════ */
  const RING_R = 140;

  /* 사용자 원: 항상 12시(상단) 고정 */
  const userCircleX = 150;
  const userCircleY = 150 - RING_R;

  /* 목표 원: 사용자 heading 기준 상대 방위각 */
  const relAngle   = ((bearing ?? 0) - (heading ?? 0)) * Math.PI / 180;
  const tgtCircleX = 150 + Math.sin(relAngle) * RING_R;
  const tgtCircleY = 150 - Math.cos(relAngle) * RING_R;

  /* 내부작은십자가: 수평(beta=0, gamma=0)일 때 중앙 */
  const rawCrossX = 150 + tiltGamma * 2.5;
  const rawCrossY = 150 + tiltBeta  * 2.5;
  const crossDx = rawCrossX - 150, crossDy = rawCrossY - 150;
  const crossDist = Math.sqrt(crossDx * crossDx + crossDy * crossDy);
  const crossClamp = crossDist > 115 ? 115 / crossDist : 1;
  const smallCrossX = 150 + crossDx * crossClamp;
  const smallCrossY = 150 + crossDy * crossClamp;

  /* Distance progress */
  const distProgress = distance !== null
    ? Math.max(0, Math.min(1, 1 - distance / FILL_MAX_KM))
    : 0;

  const fmtDist = (d: number | null) =>
    d === null ? '---' : isArrived ? '0.00km' : `${d.toFixed(2)}km`;

  const turnDeg = bearing !== null && heading !== null
    ? Math.round(Math.abs(angDiff(bearing, heading))) : null;
  const turnDir = bearing !== null && heading !== null
    ? (angDiff(bearing, heading) > 0 ? 'right' : 'left') : null;

  /* 꼭지점 십자가 위치 */
  const corners = [[-5, -5], [305, -5], [-5, 305], [305, 305]] as const;

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
                placeholder="위도  경도"
                className={styles.coordInput}
                onKeyPress={e => e.key === 'Enter' && handleSearch()}
              />
              {formError && <p className={styles.errorText}>{formError}</p>}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          COMPASS SCREEN
      ══════════════════════════════════════ */}
      {phase === 'compass' && (
        <div className={`${styles.compassScreen} ${isArrived ? styles.arrivalMode : ''}`}>

          {!isArrived && <div className={styles.compassFlicker} aria-hidden="true" />}

          {/* 로고 */}
          <div className={styles.compassLogoBox}>
            <div className={styles.logoBox}>
              <img src="/MPa_LOGO.svg" alt="MPa Logo" className={styles.logoImg} />
            </div>
          </div>

          {/* 거리 바 */}
          <div className={styles.distBar}>
            <div className={styles.distTrack}>
              <div className={styles.distFill} style={{ width: `${distProgress * 100}%` }} />
              <div className={styles.distTextRow}>
                <span>Distance to destination</span>
                <span>{fmtDist(distance)}</span>
              </div>
            </div>
          </div>

          {/* 나침반 SVG */}
          <div className={styles.compassArea}>
            <div className={styles.compassSvgWrap}>
              <svg width="100%" height="100%" viewBox="-20 -20 340 340" overflow="visible">
                <defs>
                  <clipPath id="tgtClip">
                    <circle cx={tgtCircleX} cy={tgtCircleY} r="18" />
                  </clipPath>
                  <filter id="glowFilter" x="-150%" y="-150%" width="400%" height="400%">
                    <feGaussianBlur stdDeviation="10" result="blur1" />
                    <feGaussianBlur in="SourceGraphic" stdDeviation="20" result="blur2" />
                    <feMerge>
                      <feMergeNode in="blur2" />
                      <feMergeNode in="blur2" />
                      <feMergeNode in="blur1" />
                      <feMergeNode in="blur1" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* 꼭지점 십자가 */}
                {corners.map(([cx, cy], i) => (
                  <g key={i}>
                    <line x1={cx - 6} y1={cy}     x2={cx + 6} y2={cy}     stroke="#000" strokeWidth="2" />
                    <line x1={cx}     y1={cy - 6}  x2={cx}     y2={cy + 6} stroke="#000" strokeWidth="2" />
                  </g>
                ))}

                {/* 내부 큰 십자가 */}
                <line x1="90"  y1="150" x2="210" y2="150" stroke="#000" strokeWidth="1.5" />
                <line x1="150" y1="90"  x2="150" y2="210" stroke="#000" strokeWidth="1.5" />

                {/* 원 그룹 — 도착 시 fade out */}
                <g className={styles.compassCircles}>
                  {/* 외부 링 */}
                  <circle cx="150" cy="150" r="140" fill="none" stroke="#000" strokeWidth="1.7" />

                  {/* 글로우 레이어 */}
                  {isAligned && (
                    <circle cx={tgtCircleX} cy={tgtCircleY} r="18" fill="black" filter="url(#glowFilter)" />
                  )}

                  {/* 목표 원 — 항상 표시, 속 빈 원 */}
                  <circle cx={tgtCircleX} cy={tgtCircleY} r="18" fill="none" stroke="black" strokeWidth="2" />

                  {/* 사용자 헤딩 원 — 목표 원과 겹치는 부분만 표시 */}
                  <circle cx={userCircleX} cy={userCircleY} r="18" fill="black" clipPath="url(#tgtClip)" />
                </g>

                {/* 내부작은십자가 — 자이로스코프 수평 시 중앙 */}
                <line x1={smallCrossX - 8} y1={smallCrossY}     x2={smallCrossX + 8} y2={smallCrossY}     stroke="#000" strokeWidth="1.5" />
                <line x1={smallCrossX}     y1={smallCrossY - 8} x2={smallCrossX}     y2={smallCrossY + 8} stroke="#000" strokeWidth="1.5" />
              </svg>
            </div>
          </div>

          {/* 방향 안내 문구 */}
          <div className={styles.directionGuide}>
            Turn 127 degrees to the right...
          </div>

          {/* 하단 정보 */}
          <div className={styles.infoSection}>
            <div className={styles.infoGroup}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Current direction:</span>
                <span className={styles.infoVal}>{heading !== null ? `${heading.toFixed(0)}°` : '--'}</span>
              </div>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Destination direction:</span>
                <span className={styles.infoVal}>{bearing !== null ? `${bearing.toFixed(0)}°` : '--'}</span>
              </div>
            </div>


            {geoError && (
              <div className={styles.geoError}>
                <span>{geoError}</span>
                <button onClick={startGeo} className={styles.retryBtn}>재시도</button>
              </div>
            )}

            {/* 즉시 도착 버튼 */}
            <button
              className={styles.arrivalBtn}
              onClick={() => { manualArrivedRef.current = true; setIsArrived(true); }}
            >
              즉시 도착
            </button>
          </div>

        </div>
      )}

    </div>
  );
}
