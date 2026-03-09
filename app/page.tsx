'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import styles from './page.module.css';

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
const DEFAULT_LAT = 37.2164659;
const DEFAULT_LON = 127.0351454;
const ARRIVAL_KM  = 0.05;   // 50m → arrival threshold
const ALIGN_DEG   = 5;      // ±5° → aligned threshold
const FILL_MAX_KM = 1;      // 1km 이내부터 distance bar 채우기 시작

/* ═══════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════ */
export default function CompassPage() {

  /* ── Phase ── */
  const [phase,    setPhase]    = useState<'intro' | 'search' | 'compass'>('intro');
  const [tapReady,      setTapReady]      = useState(false);   // "tap to start" 표시
  const [isFading,      setIsFading]      = useState(false);   // 블랙 페이드 오버레이 (페이드아웃)
  const [compassFadeIn, setCompassFadeIn] = useState(false);   // 나침반 진입 시 페이드인
  const [arrivalDark,   setArrivalDark]   = useState(false);   // 도착 암전
  const [introProgress, setIntroProgress] = useState(0); // 0~100

  /* ── Search ── */
  const [inputCoords, setInputCoords] = useState(() => {
    const lat = (Math.random() * 180 - 90).toFixed(7);
    const lon = (Math.random() * 360 - 180).toFixed(7);
    return `${lat} ${lon}`;
  });
  const [formError,   setFormError]   = useState('');

  /* ── Target ── */
  const [targetLat, setTargetLat] = useState(DEFAULT_LAT);
  const [targetLon, setTargetLon] = useState(DEFAULT_LON);

  /* ── Sensor ── */
  const [userLat,          setUserLat]          = useState<number | null>(null);
  const [userLon,          setUserLon]          = useState<number | null>(null);
  const [heading,          setHeading]          = useState<number | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [geoError,         setGeoError]         = useState<string | null>(null);

  /* ── Navigation ── */
  const [distance, setDistance] = useState<number | null>(null);
  const [bearing,  setBearing]  = useState<number | null>(null);
  const [isAligned, setIsAligned] = useState(false);
  const [isArrived, setIsArrived] = useState(false);

  /* ── Tilt (gyroscope) ── */
  const [tiltBeta,  setTiltBeta]  = useState(90);
  const [tiltGamma, setTiltGamma] = useState(0);

  /* ── Refs ── */
  const lastHRef    = useRef<number | null>(null);
  const cntRef      = useRef(0);
  const geoWatchRef = useRef<number | null>(null);

  /* ═══════════════════════════════════════════
     INTRO: 3초 카운터 → 100% 도달 시 tap to start
  ═══════════════════════════════════════════ */
  useEffect(() => {
    if (phase !== 'intro') return;
    const start = Date.now();
    const duration = 3000;
    const id = setInterval(() => {
      const pct = Math.min(100, Math.floor((Date.now() - start) / duration * 100));
      setIntroProgress(pct);
      if (pct >= 100) {
        clearInterval(id);
        setTapReady(true);
      }
    }, 30);
    return () => clearInterval(id);
  }, [phase]);

  const handleTapStart = useCallback(() => {
    if (!tapReady) return;
    setIsFading(true);
    setTimeout(() => {
      setPhase('search');
      setIsFading(false);
    }, 60);
  }, [tapReady]);

  /* ═══════════════════════════════════════════
     GEOLOCATION
  ═══════════════════════════════════════════ */
  const startGeo = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('위치 서비스를 지원하지 않는 브라우저입니다.');
      return;
    }
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

  /* 도착 → 3초 후 암전 */
  useEffect(() => {
    if (!isArrived) { setArrivalDark(false); return; }
    const t = setTimeout(() => setArrivalDark(true), 3000);
    return () => clearTimeout(t);
  }, [isArrived]);

  /* compass 진입 시 권한 요청 */
  useEffect(() => {
    if (phase === 'compass') requestPermission();
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
    setIsArrived(d < ARRIVAL_KM);
  }, [userLat, userLon, heading, targetLat, targetLon]);

  /* ═══════════════════════════════════════════
     SEARCH SUBMIT
  ═══════════════════════════════════════════ */
  const handleSearch = () => {
    setFormError('');
    const parts = inputCoords.trim().split(/\s+/);
    if (parts.length !== 2) { setFormError('위도와 경도를 공백으로 구분하여 입력하세요'); return; }
    const lat = parseFloat(parts[0]), lon = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lon)) { setFormError('올바른 좌표를 입력하세요'); return; }
    if (lat < -90  || lat > 90)   { setFormError('위도: -90 ~ +90'); return; }
    if (lon < -180 || lon > 180)  { setFormError('경도: -180 ~ +180'); return; }

    setTargetLat(lat);
    setTargetLon(lon);
    setPhase('compass');
  };

  /* ═══════════════════════════════════════════
     COMPASS GEOMETRY
  ═══════════════════════════════════════════ */
  const RING_R      = 140;
  const userAngle   = (heading ?? 0) * Math.PI / 180;
  const userCircleX = 150 + Math.sin(userAngle) * RING_R;
  const userCircleY = 150 - Math.cos(userAngle) * RING_R;

  const tgtAngle    = (bearing ?? 0) * Math.PI / 180;
  const tgtCircleX  = 150 + Math.sin(tgtAngle) * RING_R;
  const tgtCircleY  = 150 - Math.cos(tgtAngle) * RING_R;


  const outerTiltX  = (tiltBeta  - 90) * -0.6;
  const outerTiltY  =  tiltGamma       *  0.6;

  /* Distance progress: 0(멀리) → 1(도착) */
  const distProgress = distance !== null
    ? Math.max(0, Math.min(1, 1 - distance / FILL_MAX_KM))
    : 0;

  const fmtDist = (d: number | null) =>
    d === null ? '---' : isArrived ? '0.00km' : `${d.toFixed(2)}km`;

  const turnDeg = bearing !== null && heading !== null
    ? Math.round(Math.abs(angDiff(bearing, heading))) : null;
  const turnDir = bearing !== null && heading !== null
    ? (angDiff(bearing, heading) > 0 ? 'right' : 'left') : null;

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  return (
    <div className={styles.root}>

      {/* ── 블랙 페이드 오버레이 (페이드아웃) ── */}
      {isFading      && <div className={styles.fadeOverlay}   aria-hidden="true" />}
      {/* ── 블랙 페이드 오버레이 (나침반 진입 페이드인) ── */}
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
            {/* 로고 */}
            <div className={styles.logoBox}>
              <img src="/MPa_LOGO.svg" alt="MPa Logo" className={styles.logoImg} />
            </div>

            {/* 프로그레스 바 (텍스트 내부 표기) — JS state로 너비와 숫자 동기화 */}
            <div className={styles.progressTrack}>
              <div className={styles.progressFill} style={{ width: `${introProgress}%` }} />
              <span className={styles.progressText}>
                {tapReady ? 'Tap to start' : `Loading ${introProgress}%`}
              </span>
            </div>

            {/* ── border 테스트 박스 (1.8 ~ 2.0) ── */}
            {([1.8, 1.85, 1.9, 1.95, 2.0] as const).map(b => (
              <div key={b} style={{ width: '100%', height: 34, border: `${b}px solid #000`, boxSizing: 'border-box', position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ paddingLeft: '0.6rem', fontSize: 13, lineHeight: 1, letterSpacing: '0.02em', color: '#666', fontWeight: 500 }}>
                  Tap to start — {b}px
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          SEARCH SCREEN
      ══════════════════════════════════════ */}
      {phase === 'search' && (
        <div className={styles.searchScreen}>

          {/* 화면 깜박임 레이어 */}
          <div className={styles.tvBg} aria-hidden="true" />

          {/* 로고 — TV 간섭 효과에 노출됨 */}
          <div className={styles.searchLogoLayer}>
            <div className={styles.logoBox}>
              <img src="/MPa_LOGO.svg" alt="MPa Logo" className={styles.logoImg} />
            </div>
          </div>

          {/* 검색 인풋 — 플리커 영향 없음 (z-index 10) */}
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
        <div className={`${styles.compassScreen} ${arrivalDark ? styles.arrivalDarkMode : ''}`}>

          {/* 약한 플리커 — 도착 암전 전까지 유지 */}
          {!arrivalDark && <div className={styles.compassFlicker} aria-hidden="true" />}

          {/* 도착 암전 오버레이 */}
          {arrivalDark && <div className={styles.arrivalOverlay} aria-hidden="true" />}

          {/* 최상단 로고 */}
          <div className={styles.compassLogoBox}>
            <div className={styles.logoBox}>
              <img src="/MPa_LOGO.svg" alt="MPa Logo" className={styles.logoImg} />
            </div>
          </div>

          {/* 남은거리 프로그레스 바 */}
          <div className={styles.distBar}>
            <div className={styles.distTrack}>
              <div className={styles.distFill} style={{ width: `${distProgress * 100}%` }} />
              <div className={styles.distTextRow}>
                <span>Distance to destination</span>
                <span>{fmtDist(distance)}</span>
              </div>
            </div>
          </div>

          {/* 나침반 SVG — 암전 시 비표시 (공간 유지) */}
          <div className={`${styles.compassArea} ${arrivalDark ? styles.compassHidden : ''}`}>
            <div
              className={styles.compassSvgWrap}
              style={{
                transform: `perspective(600px) rotateX(${outerTiltX}deg) rotateY(${outerTiltY}deg)`,
              }}
            >
              <svg width="100%" height="100%" viewBox="-20 -20 340 340">
                <defs>
                  {/* 사용자 원 영역을 클립으로 정의 */}
                  <clipPath id="userClip">
                    <circle cx={userCircleX} cy={userCircleY} r="18" />
                  </clipPath>
                </defs>

                {/* 외부 링 */}
                <circle cx="150" cy="150" r="140"
                  fill="none" stroke="#000" strokeWidth="1.7" />

                {/* 목표 원 — 사용자 원과 겹치는 부분만 검은색으로 표시 */}
                <circle
                  cx={tgtCircleX}
                  cy={tgtCircleY}
                  r="18"
                  fill="black"
                  clipPath="url(#userClip)"
                  className={isAligned ? styles.tgtCircleAligned : ''}
                />

                {/* 사용자 헤딩 원 — 속 빈 원 */}
                <circle
                  cx={userCircleX}
                  cy={userCircleY}
                  r="18"
                  fill="none"
                  stroke="black"
                  strokeWidth="2"
                  className={isAligned ? styles.userCircleAligned : ''}
                />
              </svg>
            </div>
          </div>

          {/* 방향 안내 문구 */}
          <div className={`${styles.directionGuide} ${isArrived ? styles.arrivalText : ''}`}>
            Turn 127 degrees to the right...
          </div>

          {/* 하단 정보 */}
          <div className={styles.infoSection}>
            <div className={styles.infoGroup}>
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Current Tilt:</span>
                <span className={styles.infoVal}>{Math.round(tiltBeta)}°</span>
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
