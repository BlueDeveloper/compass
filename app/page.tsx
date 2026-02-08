'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

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
  const [sensorType, setSensorType] = useState<string>('');
  const [bearing, setBearing] = useState<number | null>(null);
  const [rotationAngle, setRotationAngle] = useState<number>(0);
  const [isAligned, setIsAligned] = useState<boolean>(false);

  // EMA 평활화를 위한 이전 값
  const lastSmoothedHeadingRef = useRef<number | null>(null);
  const absoluteSensorRef = useRef<any>(null);
  const sensorReadCountRef = useRef<number>(0);

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

  /* ---------------- 유틸리티 함수 ---------------- */
  const mod360 = (deg: number): number => {
    return ((deg % 360) + 360) % 360;
  };

  // 두 각도의 최단 거리 차이 계산 (-180 ~ 180)
  const angleDiff = (a: number, b: number): number => {
    let diff = a - b;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return diff;
  };

  /* ---------------- EMA 평활화 함수 (Single EMA - 균형) ---------------- */
  const smoothHeadingEMA = (newHeading: number): number => {
    const ALPHA = 0.25; // EMA 계수 (균형: 빠른 반응 + 안정성)

    const lastSmoothed = lastSmoothedHeadingRef.current;

    // 첫 값 초기화
    if (lastSmoothed === null) {
      lastSmoothedHeadingRef.current = newHeading;
      return newHeading;
    }

    // Outlier rejection: 60도 이상 급격한 변화만 무시 (완화)
    const rawDiff = Math.abs(angleDiff(newHeading, lastSmoothed));
    if (rawDiff > 60 && sensorReadCountRef.current > 10) {
      // 센서 오류로 판단, 이전 값 유지
      return lastSmoothed;
    }

    // Single EMA (빠른 반응)
    const diff = angleDiff(newHeading, lastSmoothed);
    let smoothed = lastSmoothed + ALPHA * diff;
    smoothed = mod360(smoothed);
    lastSmoothedHeadingRef.current = smoothed;

    return smoothed;
  };

  /* ---------------- 센서 처리 ---------------- */
  useEffect(() => {
    if (!permissionGranted) return;

    let lastUpdate = 0;
    const THROTTLE_MS = 100; // 100ms (균형: 초당 10회 업데이트)
    const CHANGE_THRESHOLD = 1.5; // 1.5도 (균형: 적절한 민감도)
    const WARMUP_SAMPLES = 10; // 초기 10개 샘플은 무시하지 않음

    // AbsoluteOrientationSensor 사용 시도 (Android Chrome)
    // @ts-ignore
    if (typeof AbsoluteOrientationSensor !== 'undefined') {
      try {
        // @ts-ignore
        const sensor = new AbsoluteOrientationSensor({ frequency: 60 });
        absoluteSensorRef.current = sensor;

        sensor.addEventListener('reading', () => {
          const now = Date.now();
          if (now - lastUpdate < THROTTLE_MS) return;
          lastUpdate = now;

          sensorReadCountRef.current++;

          // quaternion을 euler 각도로 변환
          const q = sensor.quaternion;
          const [x, y, z, w] = q;

          // 요 (yaw) 계산 - 진북 기준
          const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
          let deviceHeading = mod360(yaw * (180 / Math.PI));

          // Double EMA 평활화 적용
          const smoothedHeading = smoothHeadingEMA(deviceHeading);

          // 초기 안정화 기간에는 threshold 체크 생략
          if (sensorReadCountRef.current > WARMUP_SAMPLES) {
            // 작은 변화 무시
            const lastHeading = heading;
            if (lastHeading !== null) {
              const diff = Math.abs(angleDiff(smoothedHeading, lastHeading));
              if (diff < CHANGE_THRESHOLD) return;
            }
          }

          setHeading(smoothedHeading);
          setSensorType('AbsoluteOrientationSensor');
          setSensorDebug(`AOS: raw=${deviceHeading.toFixed(1)}° → EMA=${smoothedHeading.toFixed(1)}° [${sensorReadCountRef.current}]`);
        });

        sensor.addEventListener('error', (event: any) => {
          console.error('AbsoluteOrientationSensor error:', event.error);
          setSensorDebug(`AOS 에러: ${event.error.name}`);
        });

        sensor.start();
        setSensorType('AbsoluteOrientationSensor (시작됨)');

        return () => {
          if (absoluteSensorRef.current) {
            absoluteSensorRef.current.stop();
          }
        };
      } catch (error) {
        console.warn('AbsoluteOrientationSensor 사용 불가, DeviceOrientation으로 fallback');
        setSensorType('DeviceOrientation (AOS 실패)');
      }
    }

    // DeviceOrientation fallback (iOS 및 기타)
    const handler = (event: DeviceOrientationEvent) => {
      const now = Date.now();
      if (now - lastUpdate < THROTTLE_MS) return;
      lastUpdate = now;

      sensorReadCountRef.current++;

      let deviceHeading: number | null = null;
      let debugInfo = '';

      // iOS Safari - webkitCompassHeading 사용 (진북 기준)
      // @ts-ignore
      if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        // @ts-ignore
        const iosHeading = event.webkitCompassHeading as number;
        deviceHeading = mod360(iosHeading);
        debugInfo = `iOS webkit: ${iosHeading.toFixed(1)}°`;
        setSensorType('iOS webkitCompassHeading');
      }
      // Android/Others - alpha 사용
      else if (event.alpha !== null) {
        // @ts-ignore
        if (event.absolute === true || event.type === 'deviceorientationabsolute') {
          // absolute 이벤트: alpha가 진북 기준
          deviceHeading = mod360(event.alpha);
          debugInfo = `Android abs: ${event.alpha.toFixed(1)}°`;
          setSensorType('DeviceOrientation (absolute)');
        } else {
          // relative 이벤트: 화면 초기 방향 기준
          // 주의: 이 경우 진북이 아니므로 정확하지 않을 수 있음
          deviceHeading = mod360(360 - event.alpha);
          debugInfo = `Android rel: ${(360 - event.alpha).toFixed(1)}° (부정확 가능)`;
          setSensorType('DeviceOrientation (relative - 부정확)');
        }
      }

      if (deviceHeading !== null) {
        // Double EMA 평활화 적용
        const smoothedHeading = smoothHeadingEMA(deviceHeading);

        // 초기 안정화 기간에는 threshold 체크 생략
        if (sensorReadCountRef.current > WARMUP_SAMPLES) {
          // 작은 변화 무시
          const lastHeading = heading;
          if (lastHeading !== null) {
            const diff = Math.abs(angleDiff(smoothedHeading, lastHeading));
            if (diff < CHANGE_THRESHOLD) return;
          }
        }

        setHeading(smoothedHeading);
        setSensorDebug(`${debugInfo} → EMA=${smoothedHeading.toFixed(1)}° [${sensorReadCountRef.current}]`);
      } else {
        setSensorDebug(`센서 값 없음 - alpha: ${event.alpha}, beta: ${event.beta}, gamma: ${event.gamma}`);
        setSensorType('센서 값 없음');
      }
    };

    // deviceorientationabsolute 먼저 시도 (Android)
    window.addEventListener('deviceorientationabsolute', handler, true);
    // 일반 deviceorientation (iOS 및 fallback)
    window.addEventListener('deviceorientation', handler, true);

    return () => {
      window.removeEventListener('deviceorientationabsolute', handler);
      window.removeEventListener('deviceorientation', handler);
      if (absoluteSensorRef.current) {
        absoluteSensorRef.current.stop();
      }
    };
  }, [permissionGranted, heading]);

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

    // 목표 방위각 계산 (진북 기준, 0~360)
    const targetBearing = calculateBearing(
        userLat,
        userLon,
        TARGET_LAT,
        TARGET_LON
    );

    // 거리 계산
    const dist = calculateDistance(
        userLat,
        userLon,
        TARGET_LAT,
        TARGET_LON
    );

    setDistance(dist);
    setBearing(targetBearing);

    // 화살표 회전 각도 계산
    // bearing: 목표 방향 (진북 기준)
    // heading: 현재 기기가 향하는 방향 (진북 기준)
    // rotation: 기기 방향에서 목표 방향까지의 각도
    let rotation = angleDiff(targetBearing, heading);

    // 0~360 범위로 정규화 (시계방향 회전)
    rotation = mod360(rotation);
    setRotationAngle(rotation);

    // 정렬 판정: ±15도 이내면 정렬된 것으로 간주
    const alignmentThreshold = 15;
    const isCurrentlyAligned = Math.abs(angleDiff(targetBearing, heading)) <= alignmentThreshold;
    setIsAligned(isCurrentlyAligned);

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

  /* ---------------- 방향 안내 텍스트 ---------------- */
  const getDirectionGuidance = (): { text: string; icon: string; color: string } => {
    if (rotationAngle === 0) {
      return { text: '목표 방향!', icon: '🎯', color: 'text-green-600' };
    }

    const angle = Math.abs(angleDiff(rotationAngle, 0));

    if (angle <= 15) {
      return { text: '목표 방향! 직진하세요', icon: '✅', color: 'text-green-600' };
    } else if (angle <= 30) {
      const direction = rotationAngle > 180 ? '왼쪽' : '오른쪽';
      return { text: `거의 다 왔어요! ${direction}으로 조금`, icon: '👍', color: 'text-lime-600' };
    } else if (angle <= 60) {
      const direction = rotationAngle > 180 ? '왼쪽' : '오른쪽';
      return { text: `${direction}으로 ${angle.toFixed(0)}°`, icon: '↗️', color: 'text-yellow-600' };
    } else if (angle <= 120) {
      const direction = rotationAngle > 180 ? '왼쪽' : '오른쪽';
      return { text: `${direction}으로 크게 돌아주세요`, icon: '⤴️', color: 'text-orange-600' };
    } else {
      return { text: '뒤돌아 가세요', icon: '🔄', color: 'text-red-600' };
    }
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
                    <div className="absolute inset-0 rounded-full border-4 border-gray-300"></div>

                    {/* 북쪽 표시 (회전하는 나침반 다이얼) */}
                    <div
                        ref={compassRef}
                        className="absolute inset-0 flex items-start justify-center"
                        style={{
                          transformOrigin: 'center center',
                          transition: 'transform 0.3s ease-out'
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
                          transition: 'transform 0.3s ease-out',
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
                          transition: 'transform 0.3s ease-out'
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

                  {/* 방향 안내 */}
                  {heading !== null && (
                      <div className="text-center mb-4 p-3 bg-white rounded-lg border border-gray-200">
                        <div className="text-xl font-bold text-gray-800 mb-1">
                          {getDirectionGuidance().text}
                        </div>
                        <div className="text-sm text-gray-500">
                          {rotationAngle.toFixed(0)}°
                        </div>
                      </div>
                  )}

                  {/* 거리 정보 */}
                  <div className="text-center mb-4">
                    <div className="text-3xl font-bold text-gray-800 mb-1">
                      {formatDistance(distance)}
                    </div>
                    <div className="text-sm text-gray-500">목표까지 거리</div>
                  </div>

                  {/* 방위각 정보 */}
                  {bearing !== null && heading !== null && (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-gray-50 rounded-lg p-2">
                          <div className="text-gray-500 mb-1">현재 방향</div>
                          <div className="font-mono font-bold text-gray-800">{heading.toFixed(0)}°</div>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2">
                          <div className="text-gray-500 mb-1">목표 방향</div>
                          <div className="font-mono font-bold text-blue-600">{bearing.toFixed(0)}°</div>
                        </div>
                      </div>
                  )}
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

          {/* 정보 아코디언 */}
          <details className="bg-white rounded-lg shadow">
            <summary className="cursor-pointer p-4 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg transition-colors">
              📍 상세 정보 보기
            </summary>
            <div className="p-4 pt-0 space-y-4">
              {/* 위치 정보 */}
              <div className="text-xs text-gray-600 space-y-1">
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
              </div>

              {/* 센서 디버그 정보 */}
              {permissionGranted && (
                  <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-2">
                    <div>
                      <div className="font-medium text-gray-700">센서 타입:</div>
                      <div className="font-mono text-gray-600">{sensorType || '감지 중...'}</div>
                    </div>
                    {sensorDebug && (
                        <div>
                          <div className="font-medium text-gray-700">센서 값:</div>
                          <div className="font-mono text-gray-600 break-all">{sensorDebug}</div>
                        </div>
                    )}
                    <div className="text-gray-500 text-xs pt-2 border-t border-gray-300 space-y-1">
                      <div>💡 TIP: Android는 AbsoluteOrientationSensor 사용 시 가장 정확합니다.</div>
                      <div className="font-mono text-xs">
                        안정화: EMA (α=0.25) | 임계값: 1.5° | 주기: 100ms | 균형 모드
                      </div>
                    </div>
                  </div>
              )}
            </div>
          </details>

          {/* 레이더 모드 버튼 */}
          <Link
              href="/radar"
              className="mt-4 block text-center bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            🎯 레이더 모드로 전환
          </Link>
        </div>
      </main>
  );
}
