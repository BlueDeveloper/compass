'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';

const TARGET_LAT = 37.5547;   // 한남동 예시
const TARGET_LON = 126.9708;

export default function RadarPage() {
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [bearing, setBearing] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const lastHeadingRef = useRef<number | null>(null);
  const lastBearingRef = useRef<number | null>(null);
  const lastDistanceRef = useRef<number | null>(null);

  /* ---------------- 유틸리티 함수 ---------------- */
  const mod360 = (deg: number): number => {
    return ((deg % 360) + 360) % 360;
  };

  const angleDiff = (a: number, b: number): number => {
    let diff = a - b;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return diff;
  };

  /* ---------------- 평활화 함수 ---------------- */
  const smoothAngle = (newAngle: number, lastAngleRef: React.MutableRefObject<number | null>): number => {
    const ALPHA = 0.3; // 각도 평활화 계수

    const lastAngle = lastAngleRef.current;
    if (lastAngle === null) {
      lastAngleRef.current = newAngle;
      return newAngle;
    }

    const diff = angleDiff(newAngle, lastAngle);
    let smoothed = lastAngle + ALPHA * diff;
    smoothed = mod360(smoothed);
    lastAngleRef.current = smoothed;

    return smoothed;
  };

  const smoothDistance = (newDistance: number): number => {
    const ALPHA = 0.3; // 거리 평활화 계수

    const lastDistance = lastDistanceRef.current;
    if (lastDistance === null) {
      lastDistanceRef.current = newDistance;
      return newDistance;
    }

    const smoothed = lastDistance + ALPHA * (newDistance - lastDistance);
    lastDistanceRef.current = smoothed;

    return smoothed;
  };

  /* ---------------- 위치 추적 ---------------- */
  useEffect(() => {
    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setUserLat(pos.coords.latitude);
          setUserLon(pos.coords.longitude);
        },
        (err) => console.error(err),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  /* ---------------- 방향 센서 ---------------- */
  const requestOrientationPermission = async () => {
    // @ts-ignore
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      try {
        // @ts-ignore
        const result = await DeviceOrientationEvent.requestPermission();
        if (result === 'granted') {
          setPermissionGranted(true);
        }
      } catch (error) {
        console.error(error);
      }
    } else {
      setPermissionGranted(true);
    }
  };

  useEffect(() => {
    if (!permissionGranted) return;

    const handler = (event: DeviceOrientationEvent) => {
      let deviceHeading: number | null = null;

      // @ts-ignore
      if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        // @ts-ignore
        deviceHeading = mod360(event.webkitCompassHeading);
      } else if (event.alpha !== null) {
        deviceHeading = mod360(360 - event.alpha);
      }

      if (deviceHeading !== null) {
        const smoothedHeading = smoothAngle(deviceHeading, lastHeadingRef);
        setHeading(smoothedHeading);
      }
    };

    window.addEventListener('deviceorientationabsolute', handler, true);
    window.addEventListener('deviceorientation', handler, true);

    return () => {
      window.removeEventListener('deviceorientationabsolute', handler);
      window.removeEventListener('deviceorientation', handler);
    };
  }, [permissionGranted]);

  /* ---------------- 거리 및 방위각 계산 ---------------- */
  useEffect(() => {
    if (userLat === null || userLon === null) return;

    // 거리 계산 (Haversine)
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const R = 6371;

    const φ1 = toRad(userLat);
    const φ2 = toRad(TARGET_LAT);
    const Δφ = toRad(TARGET_LAT - userLat);
    const Δλ = toRad(TARGET_LON - userLon);

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = R * c;

    // 거리 평활화
    const smoothedDist = smoothDistance(dist);
    setDistance(smoothedDist);

    // 방위각 계산
    const toDeg = (rad: number) => (rad * 180) / Math.PI;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
        Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const bearingCalc = (toDeg(Math.atan2(y, x)) + 360) % 360;

    // 방위각 평활화
    const smoothedBearing = smoothAngle(bearingCalc, lastBearingRef);
    setBearing(smoothedBearing);
  }, [userLat, userLon]);

  /* ---------------- 자동 줌 조정 ---------------- */
  useEffect(() => {
    if (distance === null) return;

    // 거리에 따라 자동 줌 조정 (0.5km ~ 5km 범위)
    if (distance < 0.5) {
      setZoomLevel(3);
    } else if (distance < 1) {
      setZoomLevel(2);
    } else if (distance < 3) {
      setZoomLevel(1);
    } else if (distance < 5) {
      setZoomLevel(0.7);
    } else {
      setZoomLevel(0.5);
    }
  }, [distance]);

  /* ---------------- 레이더 상 목표 위치 계산 ---------------- */
  const getTargetPosition = () => {
    if (bearing === null || heading === null || distance === null) {
      return { x: 0, y: 0, visible: false };
    }

    // 목표까지의 상대 각도 (화면 기준)
    const relativeAngle = angleDiff(bearing, heading);

    // 레이더 반지름 (픽셀)
    const radarRadius = 120;

    // 거리를 픽셀로 변환 (줌 레벨 적용)
    const maxDistance = 2; // 레이더에 표시할 최대 거리 (km)
    const distanceRatio = Math.min(distance / maxDistance, 1) * zoomLevel;

    // 화면이 멀면 레이더 끝에 표시
    const displayRadius = distanceRatio * radarRadius;

    // 각도를 라디안으로 변환 (0도 = 위쪽)
    const angleRad = ((relativeAngle - 90) * Math.PI) / 180;

    // x, y 좌표 계산
    const x = Math.cos(angleRad) * displayRadius;
    const y = Math.sin(angleRad) * displayRadius;

    return { x, y, visible: true };
  };

  const targetPos = getTargetPosition();

  const formatDistance = (dist: number | null) => {
    if (dist === null) return '계산 중...';
    if (dist < 1) return `${(dist * 1000).toFixed(0)}m`;
    return `${dist.toFixed(2)}km`;
  };

  return (
      <main className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-700 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full">
          {/* 헤더 */}
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold text-white mb-2">레이더 모드</h1>
            <p className="text-sm text-gray-300">목표 지점을 추적합니다</p>
          </div>

          {/* 레이더 컨테이너 */}
          <div className="bg-slate-800 rounded-3xl shadow-2xl p-8 mb-6">
            {!permissionGranted ? (
                <div className="flex flex-col items-center gap-4 py-12">
                  <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mb-2">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                  </div>
                  <p className="text-gray-300 text-center mb-2">
                    레이더 기능을 사용하려면<br/>센서 권한이 필요합니다
                  </p>
                  <button
                      onClick={requestOrientationPermission}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-full transition-colors"
                  >
                    시작하기
                  </button>
                </div>
            ) : (
                <div className="relative flex flex-col items-center">
                  {/* 레이더 디스플레이 */}
                  <div className="relative w-64 h-64 mb-6">
                    <svg viewBox="-150 -150 300 300" className="w-full h-full">
                      {/* 레이더 배경 원들 */}
                      <circle cx="0" cy="0" r="120" fill="none" stroke="#334155" strokeWidth="2" />
                      <circle cx="0" cy="0" r="80" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
                      <circle cx="0" cy="0" r="40" fill="none" stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />

                      {/* 레이더 십자선 */}
                      <line x1="0" y1="-120" x2="0" y2="120" stroke="#334155" strokeWidth="1" />
                      <line x1="-120" y1="0" x2="120" y2="0" stroke="#334155" strokeWidth="1" />

                      {/* 북쪽 표시 */}
                      <text x="0" y="-130" textAnchor="middle" fill="#94a3b8" fontSize="14" fontWeight="bold">N</text>

                      {/* 목표 지점 */}
                      {targetPos.visible && (
                          <>
                            {/* 목표 지점 마커 */}
                            <circle
                                cx={targetPos.x}
                                cy={targetPos.y}
                                r="8"
                                fill="#ef4444"
                                stroke="#dc2626"
                                strokeWidth="2"
                            />
                            {/* 목표 지점 펄스 */}
                            <circle
                                cx={targetPos.x}
                                cy={targetPos.y}
                                r="12"
                                fill="none"
                                stroke="#ef4444"
                                strokeWidth="2"
                                opacity="0.5"
                            >
                              <animate attributeName="r" from="8" to="20" dur="1.5s" repeatCount="indefinite" />
                              <animate attributeName="opacity" from="0.5" to="0" dur="1.5s" repeatCount="indefinite" />
                            </circle>
                            {/* 목표까지의 선 */}
                            <line
                                x1="0"
                                y1="0"
                                x2={targetPos.x}
                                y2={targetPos.y}
                                stroke="#ef4444"
                                strokeWidth="2"
                                strokeDasharray="4 4"
                                opacity="0.5"
                            />
                          </>
                      )}

                      {/* 사용자 (중앙) */}
                      <circle cx="0" cy="0" r="6" fill="#3b82f6" stroke="#1d4ed8" strokeWidth="2" />
                      <circle cx="0" cy="0" r="10" fill="none" stroke="#3b82f6" strokeWidth="2" opacity="0.3" />
                    </svg>
                  </div>

                  {/* 거리 및 줌 정보 */}
                  <div className="text-center mb-4">
                    <div className="text-2xl font-bold text-white mb-1">
                      {formatDistance(distance)}
                    </div>
                    <div className="text-sm text-gray-400">
                      줌: {zoomLevel.toFixed(1)}x
                    </div>
                  </div>

                  {/* 줌 컨트롤 */}
                  <div className="flex gap-2 mb-4">
                    <button
                        onClick={() => setZoomLevel(prev => Math.min(prev + 0.5, 5))}
                        className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                    >
                      줌인 +
                    </button>
                    <button
                        onClick={() => setZoomLevel(prev => Math.max(prev - 0.5, 0.3))}
                        className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                    >
                      줌아웃 -
                    </button>
                  </div>

                  {/* 방위각 정보 */}
                  {bearing !== null && heading !== null && (
                      <div className="grid grid-cols-2 gap-2 text-xs w-full">
                        <div className="bg-slate-700 rounded-lg p-2">
                          <div className="text-gray-400 mb-1">현재 방향</div>
                          <div className="font-mono font-bold text-white">{heading.toFixed(0)}°</div>
                        </div>
                        <div className="bg-slate-700 rounded-lg p-2">
                          <div className="text-gray-400 mb-1">목표 방향</div>
                          <div className="font-mono font-bold text-blue-400">{bearing.toFixed(0)}°</div>
                        </div>
                      </div>
                  )}
                </div>
            )}
          </div>

          {/* 모드 전환 버튼 */}
          <Link
              href="/"
              className="block text-center bg-white hover:bg-gray-100 text-gray-800 font-semibold py-3 px-6 rounded-lg transition-colors mb-4"
          >
            나침반 모드로 전환
          </Link>
        </div>
      </main>
  );
}
