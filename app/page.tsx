'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import styles from './page.module.css';

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */
const DEFAULT_LAT = 37.5547;
const DEFAULT_LON = 126.9708;
const ARRIVAL_KM  = 0.05;   // 50m → arrival threshold
const ALIGN_DEG   = 15;     // ±15° → aligned threshold
const FILL_MAX_KM = 1;      // 1km 이내부터 근접원 채우기 시작

/* ═══════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════ */
export default function CompassPage() {

  /* ── UI Phase ── */
  const [phase,          setPhase]          = useState<'search' | 'compass'>('search');
  const [compassVisible, setCompassVisible] = useState(false);
  const [isShaking,      setIsShaking]      = useState(false);
  /* ── Search Form ── */
  const [inputCoords, setInputCoords] = useState('37.2996 127.1123');
  const [formError, setFormError] = useState('');

  /* ── Target ── */
  const [targetLat, setTargetLat] = useState(DEFAULT_LAT);
  const [targetLon, setTargetLon] = useState(DEFAULT_LON);

  /* ── Sensor ── */
  const [userLat,          setUserLat]          = useState<number | null>(null);
  const [userLon,          setUserLon]          = useState<number | null>(null);
  const [heading,          setHeading]          = useState<number | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [geoError,         setGeoError]         = useState<string | null>(null);

  /* ── Audio / Flicker ── */
  const [audioStarted,    setAudioStarted]    = useState(false);
  const [flickerIntensity, setFlickerIntensity] = useState(0);

  /* ── Navigation ── */
  const [distance,  setDistance]  = useState<number | null>(null);
  const [bearing,   setBearing]   = useState<number | null>(null);
  const [rotAngle,  setRotAngle]  = useState(0);   // arrow rotation (0 = front)
  const [isAligned, setIsAligned] = useState(false);
  const [isArrived, setIsArrived] = useState(false);

  /* ── Refs ── */
  const lastHRef      = useRef<number | null>(null);
  const cntRef        = useRef(0);
  const absSensorRef  = useRef<any>(null);
  const geoWatchRef   = useRef<number | null>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const analyserRef   = useRef<AnalyserNode | null>(null);
  const audioElRef    = useRef<HTMLAudioElement | null>(null);
  const rafRef        = useRef<number | null>(null);

  /* ═══════════════════════════════════════════
     GEOLOCATION
  ═══════════════════════════════════════════ */
  const startGeo = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('위치 서비스를 지원하지 않는 브라우저입니다.');
      return;
    }
    if (geoWatchRef.current !== null) {
      navigator.geolocation.clearWatch(geoWatchRef.current);
    }

    const onSuccess = (pos: GeolocationPosition) => {
      setGeoError(null);
      setUserLat(pos.coords.latitude);
      setUserLon(pos.coords.longitude);
    };

    const onError = (err: GeolocationPositionError) => {
      if (err.code === err.PERMISSION_DENIED) {
        setGeoError('위치 권한 거부됨\niOS: 설정 > 개인정보 > 위치서비스 > Safari');
      } else if (err.code === err.TIMEOUT) {
        navigator.geolocation.getCurrentPosition(onSuccess, () => {
          setGeoError('위치 수신 실패. 아래 버튼을 눌러 재시도하세요.');
        }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 });
      } else {
        setGeoError('위치를 가져올 수 없습니다.');
      }
    };

    geoWatchRef.current = navigator.geolocation.watchPosition(
      onSuccess,
      onError,
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 }
    );
  }, []);

  useEffect(() => {
    startGeo();
    return () => {
      if (geoWatchRef.current !== null) navigator.geolocation.clearWatch(geoWatchRef.current);
    };
  }, [startGeo]);

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
    if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function') {
      const r = await (DeviceOrientationEvent as any).requestPermission();
      if (r === 'granted') setPermissionGranted(true);
    } else {
      setPermissionGranted(true);
    }
  }, []);

  /* ═══════════════════════════════════════════
     AUDIO + FLICKER
     - fluorescent.mp3 재생
     - AnalyserNode 주파수 데이터 → 랜덤 플리커
     - 음량 클수록 플래시 빈도 증가, 항상 고대비(켜짐/꺼짐)
  ═══════════════════════════════════════════ */
  const initAudio = useCallback(() => {
    if (audioCtxRef.current) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      const audio = new Audio('/fluorescent.mp3');
      audio.loop = true;
      audio.crossOrigin = 'anonymous';
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audio.play();

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      audioElRef.current  = audio;

      // 플리커 루프: 주파수 평균 → 랜덤 고대비 플래시
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;

        // 음량 기반 확률로 ON/OFF 결정 → 고대비
        const flashProb = avg * 0.55 + 0.12;
        const intensity = Math.random() < flashProb
          ? 0.55 + Math.random() * 0.45   // ON: 0.55~1.0
          : 0;                             // OFF: 완전 꺼짐

        setFlickerIntensity(intensity);
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);

      setAudioStarted(true);
    } catch {
      setAudioStarted(true);
    }
  }, []);

  const handleTap = useCallback(() => {
    initAudio();
  }, [initAudio]);

  // cleanup
  useEffect(() => {
    return () => {
      if (rafRef.current)      cancelAnimationFrame(rafRef.current);
      if (audioElRef.current)  { audioElRef.current.pause(); audioElRef.current = null; }
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

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
     SEARCH SUBMIT
  ═══════════════════════════════════════════ */
  const handleSearch = () => {
    setFormError('');

    const parts = inputCoords.trim().split(/\s+/);
    if (parts.length !== 2) {
      setFormError('Please enter latitude and longitude separated by space');
      return;
    }

    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lon))           { setFormError('Please enter valid coordinates'); return; }
    if (lat < -90  || lat > 90)             { setFormError('Latitude: -90 to +90 range'); return; }
    if (lon < -180 || lon > 180)            { setFormError('Longitude: -180 to +180 range'); return; }

    setIsShaking(true);

    setTimeout(() => {
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
  // User position - heading direction (outer, inner circles)
  const userHeading = heading !== null ? heading : 0;
  const userAngle = userHeading * Math.PI / 180;
  const userOuterX = 150 + Math.sin(userAngle) * 140;
  const userOuterY = 150 - Math.cos(userAngle) * 140;
  const userInnerX = 150 + Math.sin(userAngle) * 50;
  const userInnerY = 150 - Math.cos(userAngle) * 50;


  // 근접원 fill progress (왼→오, 1km 이내부터)
  const fillProgress = distance !== null ? Math.max(0, Math.min(1, 1 - distance / FILL_MAX_KM)) : 0;

  // 목표 방향 마커 위치 (실제 bearing 기반)
  const targetAngle = (bearing !== null ? bearing : 0) * Math.PI / 180;
  const targetMarkerX = 150 + Math.sin(targetAngle) * 140;
  const targetMarkerY = 150 - Math.cos(targetAngle) * 140;

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  return (
    <div className={styles.mainContainer}>
      {/* tap... 시작 오버레이 - 앱 최초 진입 시 가장 먼저 */}
      {!audioStarted && (
        <div className={styles.startOverlay} onClick={handleTap}>
          <span>Tap to start MPa Navigation</span>
        </div>
      )}

      {/* 플리커 오버레이 */}
      {audioStarted && (
        <div className={styles.flickerOverlay} style={{ opacity: flickerIntensity * 0.7 }} />
      )}

      {/* ══════════════════════════════════════════════
          SEARCH PHASE - Main screen style
      ══════════════════════════════════════════════ */}
      {audioStarted && phase === 'search' && (
        <div className={styles.searchContainer}>
          <div className={styles.searchGroup}>
            <div className={styles.logoContainer}>
              <img src="/MPa_LOGO.png" alt="MPa Logo" className={styles.logoImage} />
            </div>
            <div className={styles.inputWrapper}>
              <input
                type="text"
                value={inputCoords}
                onChange={e => setInputCoords(e.target.value)}
                placeholder=""
                className={styles.inputField}
                onKeyPress={e => e.key === 'Enter' && handleSearch()}
                onBlur={handleSearch}
              />
              {formError && (
                <div className={styles.errorText}>{formError}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          COMPASS PHASE - Compass screen style
      ══════════════════════════════════════════════ */}
      {audioStarted && phase === 'compass' && (
        <div className={`${styles.compassContainer} responsive-container`}>
          {/* Direction instruction */}
          <div className={styles.directionWrapper}>
            <p className={styles.directionText}>{getDirectionText()}</p>
            <p className={styles.headingText}>
              Heading: {heading !== null ? `${heading.toFixed(1)}°` : 'No sensor data'}
            </p>
          </div>

          {/* Compass + Distance grouped */}
          <div className={styles.compassGroup}>
            <div className={`${styles.compassWrapper} responsive-compass`}>
              <svg width="100%" height="100%" viewBox="-30 -30 360 360">
                <defs>
                  {/* 사용자 원 모양으로 클리핑 → 목표와 겹친 영역만 보임 */}
                  <clipPath id="userCircleClip">
                    <circle cx={userOuterX} cy={userOuterY} r="22"/>
                  </clipPath>
                  {/* 근접원: 왼→오 fill (거리 가까울수록 채워짐) */}
                  <linearGradient id="proximityFill" x1="100" y1="150" x2="200" y2="150" gradientUnits="userSpaceOnUse">
                    <stop offset={`${fillProgress * 100}%`} stopColor="black" stopOpacity="1"/>
                    <stop offset={`${fillProgress * 100}%`} stopColor="black" stopOpacity="0"/>
                  </linearGradient>
                </defs>

                {/* Outer ring */}
                <circle cx="150" cy="150" r="140" fill="none" stroke="black" strokeWidth="1.5"/>

                {/* 목표 마커 - 사용자 원과 겹친 부분만 표시 */}
                {bearing !== null && (
                  <circle cx={targetMarkerX} cy={targetMarkerY} r="22" fill="black" clipPath="url(#userCircleClip)"/>
                )}

                {/* 사용자 외부 원 - 테두리만 */}
                <circle cx={userOuterX} cy={userOuterY} r="22" fill="none" stroke="black" strokeWidth="2"/>

                {/* 근접원 (proximity circle) - 거리 가까울수록 왼→오 fill */}
                <circle cx="150" cy="150" r="50" fill="url(#proximityFill)"/>
                <circle cx="150" cy="150" r="50" fill="none" stroke="black" strokeWidth="1.5"/>

                {/* 사용자 내부 마커 - 테두리만 */}
                <circle cx={userInnerX} cy={userInnerY} r="11" fill="none" stroke="black" strokeWidth="1.5"/>
              </svg>
            </div>

            {/* Distance */}
            <div className={styles.distanceWrapper}>
              <div className={styles.distanceValue}>{fmtDist(distance)}</div>
              <div className={styles.distanceLabel}>Distance to the destination</div>
            </div>
          </div>

          {/* Bottom info */}
          <div className={styles.infoSection}>
            <div className={styles.infoRow}>
              <span>Destination direction:</span>
              <span className={styles.infoMono}>{bearing !== null ? `${bearing.toFixed(0)}°` : '--'}</span>
            </div>
            <div className={styles.infoRow}>
              <span>Current direction:</span>
              <span className={styles.infoMono}>{heading !== null ? `${heading.toFixed(0)}°` : '--'}</span>
            </div>
            <div className={styles.infoRow}>
              <span>Destination location:</span>
              <span className={styles.infoMonoSmall}>{targetLat.toFixed(5)}, {targetLon.toFixed(5)}</span>
            </div>
            <div className={styles.infoRow}>
              <span>Current location:</span>
              <span className={styles.infoMonoSmall}>
                {userLat !== null ? userLat.toFixed(5) : '--'}, {userLon !== null ? userLon.toFixed(5) : '--'}
              </span>
            </div>
            {geoError && (
              <div style={{ marginTop: '0.25rem', color: '#dc2626', fontSize: '0.75rem', whiteSpace: 'pre-line' }}>
                {geoError}
                <button onClick={startGeo} style={{ display: 'block', marginTop: '0.25rem', fontSize: '0.75rem', background: 'none', border: '1px solid #dc2626', color: '#dc2626', padding: '0.2rem 0.5rem', cursor: 'pointer' }}>
                  위치 재시도
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
