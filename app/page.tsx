'use client';

import { useEffect, useRef, useState } from 'react';

const TARGET_LAT = 37.5547;   // 한남동 예시
const TARGET_LON = 126.9708;

export default function Home() {
  const arrowRef = useRef<HTMLDivElement>(null);
  const compassRef = useRef<HTMLDivElement>(null);

  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [sensorDebug, setSensorDebug] = useState<string>('');

  // 평활화를 위한 heading 히스토리
  const headingHistoryRef = useRef<number[]>([]);
  const lastHeadingRef = useRef<number | null>(null);

  /* ---------------- 위치 ---------------- */
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('위치 서비스를 지원하지 않는 브라우저입니다.');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setUserLat(pos.coords.latitude);
          setUserLon(pos.coords.longitude);
          setLocationError(null);
        },
        (err) => {
          console.error(err);
          if (err.code === err.PERMISSION_DENIED) {
            setLocationError('위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해주세요.');
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            setLocationError('위치 정보를 사용할 수 없습니다.');
          } else if (err.code === err.TIMEOUT) {
            setLocationError('위치 요청 시간이 초과되었습니다.');
          } else {
            setLocationError('위치를 가져오는 중 오류가 발생했습니다.');
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  /* ---------------- 방향 센서 ---------------- */
  const requestOrientationPermission = async () => {
    // iOS 대응
    // @ts-ignore
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      try {
        // @ts-ignore
        const result = await DeviceOrientationEvent.requestPermission();
        if (result === 'granted') {
          setPermissionGranted(true);
          setSensorDebug('iOS 권한 승인됨');
        } else {
          setSensorDebug('iOS 권한 거부됨: ' + result);
        }
      } catch (error) {
        setSensorDebug('iOS 권한 에러: ' + error);
      }
    } else {
      setPermissionGranted(true);
      setSensorDebug('Android/Desktop 모드');
    }
  };

  /* ---------------- 평활화 함수 ---------------- */
  const smoothHeading = (newHeading: number): number => {
    const history = headingHistoryRef.current;

    // 0도/360도 경계 처리
    if (history.length > 0) {
      const lastHeading = history[history.length - 1];
      const diff = newHeading - lastHeading;

      // 큰 점프는 360도 경계를 넘은 것으로 간주
      if (diff > 180) {
        newHeading -= 360;
      } else if (diff < -180) {
        newHeading += 360;
      }
    }

    history.push(newHeading);

    // 최근 10개 값만 유지 (5개 → 10개로 증가하여 더 부드럽게)
    if (history.length > 10) {
      history.shift();
    }

    // 가중 평균 계산 (최근 값에 더 높은 가중치)
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < history.length; i++) {
      const weight = i + 1; // 최근 값일수록 높은 가중치
      weightedSum += history[i] * weight;
      weightTotal += weight;
    }
    let avg = weightedSum / weightTotal;

    // 0-360 범위로 정규화
    while (avg < 0) avg += 360;
    while (avg >= 360) avg -= 360;

    return avg;
  };

  useEffect(() => {
    if (!permissionGranted) return;

    let lastUpdate = 0;
    const THROTTLE_MS = 150; // 100ms → 150ms로 증가하여 더 안정적으로
    const CHANGE_THRESHOLD = 2; // 2도 이하 변화는 무시

    const handler = (event: DeviceOrientationEvent) => {
      const now = Date.now();
      if (now - lastUpdate < THROTTLE_MS) return;
      lastUpdate = now;

      let deviceHeading: number | null = null;
      let debugInfo = '';

      // iOS Safari - webkitCompassHeading 사용
      // @ts-ignore
      if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        // @ts-ignore
        const iosHeading = event.webkitCompassHeading as number;
        deviceHeading = iosHeading;
        debugInfo = `iOS webkitCompassHeading: ${iosHeading.toFixed(1)}°`;
      }
      // Android/Others - alpha 사용
      else if (event.alpha !== null) {
        // absolute 이벤트인 경우 alpha가 북쪽 기준
        // 일반 이벤트인 경우 360 - alpha
        // @ts-ignore
        if (event.absolute === true || event.type === 'deviceorientationabsolute') {
          deviceHeading = event.alpha;
          debugInfo = `Android absolute: ${event.alpha.toFixed(1)}°`;
        } else {
          deviceHeading = 360 - event.alpha;
          debugInfo = `Android relative: ${(360 - event.alpha).toFixed(1)}° (alpha: ${event.alpha.toFixed(1)})`;
        }
      }

      if (deviceHeading !== null) {
        // 평활화 적용
        const smoothedHeading = smoothHeading(deviceHeading);

        // 작은 변화는 무시 (떨림 방지)
        const lastHeading = lastHeadingRef.current;
        if (lastHeading !== null) {
          let diff = Math.abs(smoothedHeading - lastHeading);
          // 0도/360도 경계 처리
          if (diff > 180) {
            diff = 360 - diff;
          }

          // threshold 이하의 변화는 무시
          if (diff < CHANGE_THRESHOLD) {
            return;
          }
        }

        lastHeadingRef.current = smoothedHeading;
        setHeading(smoothedHeading);
        setSensorDebug(`${debugInfo} → smoothed: ${smoothedHeading.toFixed(1)}°`);
      } else {
        setSensorDebug(`센서 값 없음 - alpha: ${event.alpha}, beta: ${event.beta}, gamma: ${event.gamma}`);
      }
    };

    // deviceorientationabsolute 먼저 시도 (Android)
    window.addEventListener('deviceorientationabsolute', handler, true);
    // 일반 deviceorientation (iOS 및 fallback)
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

  /* ---------------- 거리 계산 (Haversine) ---------------- */
  const calculateDistance = (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number
  ): number => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const R = 6371; // 지구 반지름 (km)

    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // km
  };

  /* ---------------- 화살표 회전 및 거리 계산 ---------------- */
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

    const dist = calculateDistance(
        userLat,
        userLon,
        TARGET_LAT,
        TARGET_LON
    );

    setDistance(dist);

    const rotation = bearing - heading;

    arrowRef.current.style.transform = `rotate(${rotation}deg)`;
  }, [userLat, userLon, heading]);

  /* ---------------- 북쪽 표시 회전 ---------------- */
  useEffect(() => {
    if (heading === null || !compassRef.current) return;
    compassRef.current.style.transform = `rotate(${-heading}deg)`;
  }, [heading]);

  /* ---------------- 거리 포맷팅 ---------------- */
  const formatDistance = (dist: number | null) => {
    if (dist === null) return '계산 중...';
    if (dist < 1) return `${(dist * 1000).toFixed(0)}m`;
    return `${dist.toFixed(2)}km`;
  };

  /* ---------------- UI ---------------- */
  return (
      <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full">
          {/* 헤더 */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">나침반</h1>
            <p className="text-sm text-gray-600">목표 지점을 향해 방향을 안내합니다</p>
          </div>

          {/* 나침반 컨테이너 */}
          <div className="bg-white rounded-3xl shadow-2xl p-8 mb-6">
            {!permissionGranted ? (
                <div className="flex flex-col items-center gap-4 py-12">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-2">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-700 text-center mb-2">
                    나침반 기능을 사용하려면<br/>센서 권한이 필요합니다
                  </p>
                  <button
                      onClick={requestOrientationPermission}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-full transition-colors shadow-lg"
                  >
                    시작하기
                  </button>
                </div>
            ) : (
                <div className="relative flex flex-col items-center">
                  {/* 나침반 배경 */}
                  <div className="relative w-64 h-64 mb-6">
                    {/* 외곽 원 */}
                    <div className="absolute inset-0 rounded-full border-4 border-gray-200"></div>

                    {/* 북쪽 표시 (회전하는 나침반 다이얼) */}
                    <div
                        ref={compassRef}
                        className="absolute inset-0 flex items-start justify-center"
                        style={{
                          transformOrigin: 'center center',
                          transition: 'transform 0.5s ease-out'
                        }}
                    >
                      <div className="mt-4 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded">
                        N
                      </div>
                    </div>

                    {/* 방향 표시 (E, S, W) */}
                    <div
                        className="absolute inset-0"
                        style={{
                          transformOrigin: 'center center',
                          transition: 'transform 0.5s ease-out',
                          transform: heading !== null ? `rotate(${-heading}deg)` : 'rotate(0deg)'
                        }}
                    >
                      <div className="absolute top-1/2 right-4 -translate-y-1/2 text-gray-400 text-xs font-bold">E</div>
                      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-gray-400 text-xs font-bold">S</div>
                      <div className="absolute top-1/2 left-4 -translate-y-1/2 text-gray-400 text-xs font-bold">W</div>
                    </div>

                    {/* 중앙 원 */}
                    <div className="absolute inset-0 m-auto w-48 h-48 rounded-full bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-gray-300 shadow-inner"></div>

                    {/* 화살표 */}
                    <div
                        ref={arrowRef}
                        className="absolute inset-0 m-auto w-32 h-32"
                        style={{
                          transformOrigin: '50% 50%',
                          transition: 'transform 0.5s ease-out'
                        }}
                    >
                      <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-lg">
                        {/* 화살표 그림자 */}
                        <polygon
                            points="50,5 65,90 50,75 35,90"
                            fill="#000000"
                            opacity="0.1"
                            transform="translate(2, 2)"
                        />
                        {/* 화살표 본체 */}
                        <polygon
                            points="50,5 65,90 50,75 35,90"
                            fill="#DC2626"
                            stroke="#991B1B"
                            strokeWidth="2"
                        />
                        {/* 화살표 하이라이트 */}
                        <polygon
                            points="50,5 55,50 50,75 45,50"
                            fill="#EF4444"
                            opacity="0.6"
                        />
                      </svg>
                    </div>

                    {/* 중앙 점 */}
                    <div className="absolute inset-0 m-auto w-4 h-4 rounded-full bg-gray-800 border-2 border-white shadow-md"></div>
                  </div>

                  {/* 거리 정보 */}
                  <div className="text-center">
                    <div className="text-3xl font-bold text-gray-800 mb-1">
                      {formatDistance(distance)}
                    </div>
                    <div className="text-sm text-gray-500">목표까지 거리</div>
                  </div>
                </div>
            )}
          </div>

          {/* 에러 메시지 */}
          {locationError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-red-700">{locationError}</p>
                </div>
              </div>
          )}

          {/* 위치 정보 */}
          <div className="bg-white rounded-lg shadow p-4 text-xs text-gray-600 space-y-1">
            <div className="flex justify-between">
              <span className="font-medium">현재 위치:</span>
              <span className="font-mono">
                {userLat && userLon
                    ? `${userLat.toFixed(5)}, ${userLon.toFixed(5)}`
                    : '확인 중...'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">목표 지점:</span>
              <span className="font-mono">{TARGET_LAT.toFixed(5)}, {TARGET_LON.toFixed(5)}</span>
            </div>
            {heading !== null && (
                <div className="flex justify-between">
                  <span className="font-medium">방향:</span>
                  <span className="font-mono">{heading.toFixed(1)}°</span>
                </div>
            )}
          </div>

          {/* 센서 디버그 정보 */}
          {sensorDebug && permissionGranted && (
              <div className="mt-4 bg-gray-100 rounded-lg shadow p-3 text-xs">
                <div className="font-medium text-gray-700 mb-1">센서 디버그:</div>
                <div className="font-mono text-gray-600 break-all">{sensorDebug}</div>
              </div>
          )}
        </div>
      </main>
  );
}
