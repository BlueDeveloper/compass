# Compass

숨고(soomgo.com) 외주 플랫폼에서 수주한 **두 번째 프로젝트**.

GPS와 디바이스 방향 센서(자이로스코프/나침반)를 이용해 목적지까지의 방향과 거리를 실시간으로 안내하는 나침반 웹앱.

## 기능

- 좌표(위도 경도) 입력 → 목적지 방향 안내
- 디바이스 나침반 센서 기반 실시간 방향 추적
- 자이로스코프 수평 표시
- 목적지 도착 감지
- 인트로 / 검색 / 나침반 3단계 화면 전환
- 배경음 + 효과음

## 기술 스택

- Next.js (App Router, `output: 'export'` 정적 빌드)
- TypeScript
- CSS Modules
- Web APIs: Geolocation, DeviceOrientation, AbsoluteOrientationSensor

## 로컬 실행

```bash
npm install
npm run dev
```

## 배포

Cloudflare Pages — `mpanavigation.com`
