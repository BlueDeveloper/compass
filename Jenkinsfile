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
        // node_modules: package-lock.json 기준 캐시
        // .next/cache: Next.js 증분 빌드 캐시
        cache(maxCacheSize: 512, caches: [
          arbitraryFileCache(
            path: 'node_modules',
            cacheValidityDecidingFile: 'package-lock.json'
          ),
          arbitraryFileCache(
            path: '.next/cache'
          )
        ]) {
          sh '''
            set -euo pipefail

            # 의존성 설치 — 캐시 히트 시 네트워크 생략
            npm ci --legacy-peer-deps --prefer-offline

            # Next.js static build
            npm run build
          '''
        }
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
