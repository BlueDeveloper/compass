pipeline {
  agent any

  options {
    // 동일 브랜치 중복 빌드 방지
    disableConcurrentBuilds()
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Build') {
      steps {
        sh '''
          set -euo pipefail

          CACHE_DIR="/var/lib/jenkins/.compass-cache"
          LOCK_HASH=$(sha256sum package-lock.json | awk '{print $1}')
          NM_CACHE="$CACHE_DIR/node_modules-$LOCK_HASH"

          # node_modules: package-lock.json 해시 기준 캐시 복원
          if [ -d "$NM_CACHE" ]; then
            echo "[cache] node_modules hit — restoring"
            cp -r "$NM_CACHE" node_modules
          else
            echo "[cache] node_modules miss — installing"
            npm ci --legacy-peer-deps --prefer-offline
            mkdir -p "$CACHE_DIR"
            cp -r node_modules "$NM_CACHE"
            # 오래된 캐시 정리 (최신 3개만 유지)
            ls -dt "$CACHE_DIR"/node_modules-* 2>/dev/null | tail -n +4 | xargs rm -rf || true
          fi

          # Next.js 빌드 캐시 복원 (.next/cache 워크스페이스 유지)
          NEXT_CACHE="$CACHE_DIR/next-cache"
          if [ -d "$NEXT_CACHE" ] && [ ! -d ".next/cache" ]; then
            mkdir -p .next
            cp -r "$NEXT_CACHE" .next/cache
          fi

          # Next.js static build
          npm run build

          # .next/cache 저장
          if [ -d ".next/cache" ]; then
            rm -rf "$NEXT_CACHE"
            cp -r .next/cache "$NEXT_CACHE"
          fi
        '''
      }
    }

    stage('Deploy (static)') {
      steps {
        sh '''
          set -euo pipefail

          ########################################
          # rsync — 변경 파일만 전송 (전체 삭제 불필요)
          ########################################
          sudo -n mkdir -p /opt/compass-mvp
          sudo -n rsync -a --delete --checksum out/ /opt/compass-mvp/

          ########################################
          # 퍼미션 — 배치 처리 (+) 로 프로세스 최소화
          ########################################
          sudo -n find /opt/compass-mvp -type d -exec chmod 755 {} +
          sudo -n find /opt/compass-mvp -type f -exec chmod 644 {} +

          ########################################
          # SELinux context 복구
          ########################################
          sudo -n restorecon -Rv /opt/compass-mvp || true

          ########################################
          # nginx reload
          ########################################
          sudo -n systemctl reload nginx
        '''
      }
    }

    stage('Verify') {
      steps {
        sh '''
          set -euo pipefail
          test -f /opt/compass-mvp/index.html
        '''
      }
    }
  }
}
