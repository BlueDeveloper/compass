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

/* ═══════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════ */
export default function CompassPage() {

  /* ── UI Phase ── */
  const [phase,          setPhase]          = useState<'search' | 'compass'>('search');
  const [compassVisible, setCompassVisible] = useState(false);
  const [isShaking,      setIsShaking]      = useState(false);
  const [flickerIntensity, setFlickerIntensity] = useState(0);
  const [audioStarted, setAudioStarted] = useState(false);

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

  /* ── Navigation ── */
  const [distance,  setDistance]  = useState<number | null>(null);
  const [bearing,   setBearing]   = useState<number | null>(null);
  const [rotAngle,  setRotAngle]  = useState(0);   // arrow rotation (0 = front)
  const [isAligned, setIsAligned] = useState(false);
  const [isArrived, setIsArrived] = useState(false);

  /* ── Refs ── */
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef   = useRef<AnalyserNode | null>(null);
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

    // Setup audio file with analyser
    if (!audioElementRef.current) {
      const audio = new Audio('/fluorescent.mp3');
      audio.loop = true;
      audio.volume = 0.5;
      audioElementRef.current = audio;

      const ctx = audioCtxRef.current;
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      const gain = ctx.createGain();

      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.5;

      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);

      audioSourceRef.current = source;
      analyserRef.current = analyser;
      gainRef.current = gain;
    }
  }, []);

  const startAudioFile = useCallback(() => {
    if (audioElementRef.current && audioCtxRef.current) {
      audioCtxRef.current.resume();
      audioElementRef.current.play().catch(() => {});
    }
  }, []);

  const stopAudioFile = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }
  }, []);

  const setAudioVol = useCallback((vol: number) => {
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
     AUDIO-BASED FLICKER INTENSITY
  ═══════════════════════════════════════════ */
  // FLICKER PAUSED
  // useEffect(() => {
  //   if (!audioStarted || !analyserRef.current) return;

  //   const analyser = analyserRef.current;
  //   const dataArray = new Uint8Array(analyser.frequencyBinCount);

  //   const updateFlicker = () => {
  //     analyser.getByteFrequencyData(dataArray);

  //     // Calculate average amplitude across all frequencies
  //     let sum = 0;
  //     for (let i = 0; i < dataArray.length; i++) {
  //       sum += dataArray[i];
  //     }
  //     const average = sum / dataArray.length;

  //     // Normalize to 0-1 range (0-255 -> 0-1)
  //     const normalizedIntensity = average / 255;

  //     // Strong flicker effect: only trigger when intensity is high (threshold: 0.15)
  //     if (normalizedIntensity > 0.15) {
  //       // Scale to strong flicker range (0.5 to 1.0 for dramatic effect)
  //       const flickerStrength = 0.5 + (normalizedIntensity - 0.15) * 0.588;
  //       setFlickerIntensity(flickerStrength);
  //     } else {
  //       // No flicker when audio is quiet
  //       setFlickerIntensity(0);
  //     }
  //   };

  //   const interval = setInterval(updateFlicker, 50);
  //   return () => clearInterval(interval);
  // }, [audioStarted]);

  /* ═══════════════════════════════════════════
     INITIAL AUDIO ON SEARCH SCREEN
  ═══════════════════════════════════════════ */
  const handleScreenInteraction = useCallback(() => {
    if (!audioStarted && phase === 'search') {
      initAudio();
      startAudioFile();
      setAudioStarted(true);
    }
  }, [audioStarted, phase, initAudio, startAudioFile]);

  useEffect(() => {
    // Keep audioStarted true when transitioning from search to compass
    // Only stop audio when going back to search from compass
    return () => {
      if (phase === 'search') {
        stopAudioFile();
        setAudioStarted(false);
      }
    };
  }, [phase, stopAudioFile]);

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
     DIRECTION-BASED AUDIO EFFECT
  ═══════════════════════════════════════════ */
  useEffect(() => {
    if (!permissionGranted || phase !== 'compass') return;

    // Ensure audio is started in compass phase
    if (!audioStarted) {
      initAudio();
      setAudioStarted(true);
    }

    if (isArrived) {
      // Special sound on arrival
      if (audioElementRef.current) setAudioVol(0.8);
      else startAudioFile();
    } else if (heading !== null && bearing !== null) {
      // Calculate angle difference
      const angleDiff = Math.abs(angDiff(bearing, heading));

      // 0~5 degrees: stop audio and flicker completely
      if (angleDiff <= 5) {
        stopAudioFile();
      } else {
        // Apply audio based on alignment
        const alignmentFactor = (angleDiff - 5) / 175; // 5° = 0, 180° = 1
        const audioVol = 0.2 + alignmentFactor * 0.6;

        if (audioElementRef.current && audioElementRef.current.paused) {
          startAudioFile();
        }
        setAudioVol(audioVol);
      }
    } else {
      if (audioElementRef.current && !audioElementRef.current.paused) {
        setAudioVol(0.5);
      }
    }
  }, [heading, bearing, isArrived, permissionGranted, phase, startAudioFile, setAudioVol, audioStarted, initAudio]);

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


  // Target position - bearing direction (outer circle)
  const targetBearing = bearing !== null ? bearing : 0;
  const targetAngle = targetBearing * Math.PI / 180;
  const targetX = 150 + Math.sin(targetAngle) * 140;
  const targetY = 150 - Math.cos(targetAngle) * 140;

  // Calculate eclipse effect (direction-based)
  const calculateEclipseEffect = () => {
    if (heading === null || bearing === null) return 0;

    // Calculate difference between heading and bearing (0~180 degrees)
    const diff = Math.abs(angDiff(bearing, heading));

    // The closer to 0, the closer to 1 (0° = 1, 180° = 0)
    const progress = Math.max(0, 1 - (diff / 180));

    return progress;
  };

  const eclipseProgress = calculateEclipseEffect();

  // Calculate gradient direction (from target direction to opposite)
  const targetBearingRad = targetBearing * Math.PI / 180;
  const gradientX1 = userOuterX + Math.sin(targetBearingRad) * 20;
  const gradientY1 = userOuterY - Math.cos(targetBearingRad) * 20;
  const gradientX2 = userOuterX - Math.sin(targetBearingRad) * 20;
  const gradientY2 = userOuterY + Math.cos(targetBearingRad) * 20;

  /* ═══════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════ */
  return (
    <div className={styles.mainContainer}>
      {/* Flicker overlay - only show when audio is started */}
      {audioStarted && (
        <div
          className={styles.flickerOverlay}
          style={{
            backgroundColor: `rgba(0, 0, 0, ${flickerIntensity * 0.8})`
          }}
        />
      )}
      <style>{`
        @keyframes backgroundFlicker {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(${1 - flickerIntensity * 0.3}); }
        }
      `}</style>

      {/* Start overlay */}
      {phase === 'search' && !audioStarted && (
        <div
          className={styles.startOverlay}
          onClick={handleScreenInteraction}
        >
          <div className={styles.startOverlayContent}>
            <p className={styles.startOverlayText}>Tap to start MPa Navigation</p>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          SEARCH PHASE - Main screen style
      ══════════════════════════════════════════════ */}
      {phase === 'search' && (
        <div className={`${styles.searchContainer} responsive-container`}>
          <div className={styles.inputWrapper}>
            <div>
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

          <div className={styles.flexGrow}></div>

          <div className={styles.logoContainer}>
            <img src="/MPa_LOGO2.png" alt="MPa Logo" className={`${styles.logoImage} responsive-logo`} />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          COMPASS PHASE - Compass screen style
      ══════════════════════════════════════════════ */}
      {phase === 'compass' && (
        <div className={`${styles.compassContainer} responsive-container`}>
          <div>
            {!permissionGranted && (
              <button
                onClick={requestPermission}
                className={styles.sensorButton}
              >
                Enable Sensor
              </button>
            )}

            {/* Direction instruction */}
            <div className={styles.directionWrapper}>
              <p className={styles.directionText}>{getDirectionText()}</p>
              <p className={styles.headingText}>
                Heading: {heading !== null ? `${heading.toFixed(1)}°` : 'No sensor data'}
              </p>
            </div>
          </div>

          {/* Compass circles */}
          <div className={`${styles.compassWrapper} responsive-compass`}>
            <svg width="100%" height="100%" viewBox="-30 -30 360 360">
              <defs>
                {/* Gradient starting from target direction */}
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

              {/* Fixed compass circles */}
              {/* Outer circle */}
              <circle cx="150" cy="150" r="140" fill="none" stroke="black" strokeWidth="2"/>

              {/* Inner circle */}
              <circle cx="150" cy="150" r="50" fill="none" stroke="black" strokeWidth="2"/>

              {/* North direction indicator (fixed at 12 o'clock) */}
              <circle cx="150" cy="10" r="4" fill="gray"/>
              <text x="150" y="32" textAnchor="middle" fontSize="12" fill="gray">N</text>

              {/* User position (moves according to heading direction) */}
              {/* User position on outer circle - filled from target direction */}
              <circle cx={userOuterX} cy={userOuterY} r="20" fill="url(#userFillGradient)"/>
              <circle cx={userOuterX} cy={userOuterY} r="20" fill="none" stroke="black" strokeWidth="2"/>

              {/* User position on inner circle */}
              <circle cx={userInnerX} cy={userInnerY} r="10" fill="none" stroke="black" strokeWidth="2"/>

              {/* Target point (for development - temporary display) */}
              <circle cx={targetX} cy={targetY} r="8" fill="none" stroke="red" strokeWidth="2"/>
              <circle cx={targetX} cy={targetY} r="4" fill="red"/>
            </svg>
          </div>

          <div className={styles.bottomSection}>
            {/* Distance */}
            <div className={styles.distanceWrapper}>
              <div className={styles.distanceValue}>{fmtDist(distance)}</div>
              <div className={styles.distanceLabel}>Distance to the destination</div>
            </div>

            {/* Info */}
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
            </div>

            <button
              onClick={() => { stopAudioFile(); setAudioStarted(false); setPhase('search'); setCompassVisible(false); }}
              className={styles.backButton}
            >
              ← Back to search
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
