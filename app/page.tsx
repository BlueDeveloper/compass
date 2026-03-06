'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import styles from './page.module.css';

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
const DEFAULT_LAT = 37.5547;
const DEFAULT_LON = 126.9708;
const ARRIVAL_KM  = 0.1;    // 100m → arrival threshold
const ALIGN_DEG   = 15;     // ±15° → aligned threshold
const FILL_MAX_KM = 1;      // 1km 이내부터 distance bar 채우기 시작

/* ═══════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════ */
export default function CompassPage() {

  /* ── Phase ── */
  const [phase,    setPhase]    = useState<'intro' | 'search' | 'compass'>('intro');
  const [tapReady, setTapReady] = useState(false);   // "tap to start" 표시
  const [isFading, setIsFading] = useState(false);   // 블랙 페이드 오버레이

  /* ── Search ── */
  const [inputCoords, setInputCoords] = useState('37.2996 127.1123');
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
     INTRO: 3초 후 "tap to start" 표시
  ═══════════════════════════════════════════ */
  useEffect(() => {
    if (phase !== 'intro') return;
    const t = setTimeout(() => setTapReady(true), 3000);
    return () => clearTimeout(t);
  }, [phase]);

  const handleTapStart = useCallback(() => {
    if (!tapReady) return;
    setIsFading(true);
    setTimeout(() => {
      setPhase('search');
      setIsFading(false);
    }, 800);
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
    requestPermission();
    setTargetLat(lat);
    setTargetLon(lon);
    setPhase('compass');
  };

  /* ═══════════════════════════════════════════
     COMPASS GEOMETRY
  ═══════════════════════════════════════════ */
  const RING_R      = 130;
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
    d === null ? '---' : d < 1 ? `${(d * 1000).toFixed(0)}m` : `${d.toFixed(2)}km`;

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  return (
    <div className={styles.root}>

      {/* ── 블랙 페이드 오버레이 (intro → search 전환) ── */}
      {isFading && <div className={styles.fadeOverlay} aria-hidden="true" />}

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
              <img src="/MPa_LOGO.png" alt="MPa Logo" className={styles.logoImg} />
            </div>

            {/* 프로그레스 바 + tap to start */}
            <div className={styles.introBottom}>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} />
              </div>
              {tapReady && (
                <p className={styles.tapLabel}>tap to start</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════
          SEARCH SCREEN
      ══════════════════════════════════════ */}
      {phase === 'search' && (
        <div className={styles.searchScreen}>

          {/* TV 간섭 배경 레이어들 (z-index 0~3) */}
          <div className={styles.tvBg}        aria-hidden="true" />
          <div className={styles.tvScanlines} aria-hidden="true" />
          <div className={styles.tvBand1}     aria-hidden="true" />
          <div className={styles.tvBand2}     aria-hidden="true" />

          {/* 콘텐츠 (z-index 10 — 플리커 영향 없음) */}
          <div className={styles.searchContent}>
            <div className={styles.logoBox}>
              <img src="/MPa_LOGO.png" alt="MPa Logo" className={styles.logoImg} />
            </div>
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
        <div className={styles.compassScreen}>

          {/* 도착 플리커 오버레이 */}
          {isArrived && <div className={styles.arrivalFlicker} aria-hidden="true" />}

          {/* 최상단 로고 */}
          <div className={styles.compassLogoBox}>
            <div className={styles.logoBox}>
              <img src="/MPa_LOGO.png" alt="MPa Logo" className={styles.logoImg} />
            </div>
          </div>

          {/* 남은거리 프로그레스 바 */}
          <div className={styles.distBar}>
            <span className={styles.distValue}>{fmtDist(distance)}</span>
            <div className={styles.distTrack}>
              <div className={styles.distFill} style={{ width: `${distProgress * 100}%` }} />
            </div>
          </div>

          {/* 나침반 SVG */}
          <div className={styles.compassArea}>
            <div
              className={styles.compassSvgWrap}
              style={{
                transform: `perspective(600px) rotateX(${outerTiltX}deg) rotateY(${outerTiltY}deg)`,
              }}
            >
              <svg width="100%" height="100%" viewBox="-30 -30 360 360">
                {/* 외부 링 */}
                <circle cx="150" cy="150" r="140"
                  fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
                {/* 12시 방향 하이라이트 반사광 */}
                <circle cx="150" cy="150" r="140"
                  fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2"
                  strokeDasharray="90 785" strokeDashoffset="280" />

                {/* 목표 방향 마커 */}
                {bearing !== null && (
                  <circle cx={tgtCircleX} cy={tgtCircleY} r="18"
                    fill="rgba(255,255,255,0.08)"
                    stroke="rgba(255,255,255,0.65)"
                    strokeWidth="1.5" />
                )}

                {/* 사용자 헤딩 원 — 방향 일치 시 번쩍임 */}
                <circle
                  cx={userCircleX}
                  cy={userCircleY}
                  r="18"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  className={isAligned ? styles.userCircleAligned : ''}
                />
              </svg>
            </div>
          </div>

          {/* 하단 방위각 + 좌표 정보 */}
          <div className={styles.infoSection}>
            <div className={styles.infoRow}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>목적지 방위각</span>
                <span className={styles.infoVal}>{bearing !== null ? `${bearing.toFixed(0)}°` : '--'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>현재 방향</span>
                <span className={styles.infoVal}>{heading !== null ? `${heading.toFixed(0)}°` : '--'}</span>
              </div>
            </div>

            <div className={styles.coordsSection}>
              <div className={styles.coordRow}>
                <span className={styles.infoLabel}>목적지</span>
                <span className={styles.coordVal}>{targetLat.toFixed(5)},&nbsp;{targetLon.toFixed(5)}</span>
              </div>
              <div className={styles.coordRow}>
                <span className={styles.infoLabel}>현재 위치</span>
                <span className={styles.coordVal}>
                  {userLat !== null ? userLat.toFixed(5) : '--'},&nbsp;
                  {userLon !== null ? userLon.toFixed(5) : '--'}
                </span>
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
