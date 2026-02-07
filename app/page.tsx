'use client';

import { useEffect, useRef, useState } from 'react';

const TARGET_LAT = 37.5349;   // 한남동 예시
const TARGET_LON = 127.0017;

export default function Home() {
  const arrowRef = useRef<HTMLDivElement>(null);

  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);

  /* ---------------- 위치 ---------------- */
  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setUserLat(pos.coords.latitude);
          setUserLon(pos.coords.longitude);
        },
        (err) => {
          debugger
          console.error(err);
        },
        { enableHighAccuracy: true }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  /* ---------------- 방향 센서 ---------------- */
  const requestOrientationPermission = async () => {
    // iOS 대응
    // @ts-ignore
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      // @ts-ignore
      const result = await DeviceOrientationEvent.requestPermission();
      if (result === 'granted') {
        setPermissionGranted(true);
      }
    } else {
      setPermissionGranted(true);
    }
  };

  useEffect(() => {
    if (!permissionGranted) return;

    const handler = (event: DeviceOrientationEvent) => {
      let deviceHeading: number | null = null;

      // iOS
      // @ts-ignore
      if (event.webkitCompassHeading !== undefined) {
        // @ts-ignore
        deviceHeading = event.webkitCompassHeading;
      } else if (event.alpha !== null) {
        deviceHeading = 360 - event.alpha;
      }

      if (deviceHeading !== null) {
        setHeading(deviceHeading);
      }
    };

    window.addEventListener('deviceorientationabsolute', handler, true);
    window.addEventListener('deviceorientation', handler, true);

    return () => {
      window.removeEventListener('deviceorientationabsolute', handler);
      window.removeEventListener('deviceorientation', handler);
    };
  }, [permissionGranted]);

  /* ---------------- 방위각 계산 ---------------- */
  const calculateBearing = (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number
  ) => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const toDeg = (rad: number) => (rad * 180) / Math.PI;

    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x =
        Math.cos(φ1) * Math.sin(φ2) -
        Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  };

  /* ---------------- 화살표 회전 ---------------- */
  useEffect(() => {
    if (
        userLat === null ||
        userLon === null ||
        heading === null ||
        !arrowRef.current
    )
      return;

    const bearing = calculateBearing(
        userLat,
        userLon,
        TARGET_LAT,
        TARGET_LON
    );

    const rotation = bearing - heading;

    arrowRef.current.style.transform = `rotate(${rotation}deg)`;
  }, [userLat, userLon, heading]);

  /* ---------------- UI ---------------- */
  return (
      <main
          style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
          }}
      >
        {!permissionGranted && (
            <button
                onClick={requestOrientationPermission}
                style={{
                  padding: '12px 20px',
                  fontSize: 16,
                }}
            >
              시작하기
            </button>
        )}

        <div
            ref={arrowRef}
            style={{
              width: 120,
              height: 120,
              transition: 'transform 0.2s linear',
              transformOrigin: '50% 50%',
            }}
        >
          {/* 임시 화살표 (로고로 교체) */}
          <svg viewBox="0 0 100 100">
            <polygon
                points="50,0 90,100 50,80 10,100"
                fill="black"
            />
          </svg>
        </div>

        <div style={{ fontSize: 12, opacity: 0.6 }}>
          {userLat && userLon
              ? `lat: ${userLat.toFixed(5)}, lon: ${userLon.toFixed(5)}`
              : '위치 확인 중'}
        </div>
      </main>
  );
}
