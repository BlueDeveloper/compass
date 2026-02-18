pipeline {
  agent any

  stages {

    stage('Checkout') {
      steps {
        // Git 저장소 체크아웃
        checkout scm
      }
    }

    stage('Build') {
      steps {
        sh '''
          set -euo pipefail

          # Node / npm 버전 확인
          node -v
          npm -v

          # 의존성 설치 (CI 환경 안정성)
          npm ci --legacy-peer-deps

          # Next.js static build (out/ 생성)
          npm run build
        '''
      }
    }

    stage('Deploy (static)') {
      steps {
        sh '''
          set -euo pipefail

          ########################################
          # 1. 기존 배포 디렉토리 완전 제거
          ########################################
          sudo -n rm -rf /opt/compass-mvp

          ########################################
          # 2. 배포 디렉토리 재생성
          ########################################
          sudo -n mkdir -p /opt/compass-mvp

          ########################################
          # 3. 정적 빌드 결과물 복사
          #    out/* → /opt/compass-mvp
          ########################################
          sudo -n cp -r out/* /opt/compass-mvp/

          ########################################
          # 4. 퍼미션 정리
          ########################################
          sudo -n find /opt/compass-mvp -type d -exec chmod 755 {} \\;
          sudo -n find /opt/compass-mvp -type f -exec chmod 644 {} \\;

          ########################################
          # 5. SELinux context 복구
          ########################################
          sudo -n restorecon -Rv /opt/compass-mvp || true

          ########################################
          # 6. nginx reload
          ########################################
          sudo -n systemctl reload nginx
        '''
      }
    }

    stage('Verify') {
      steps {
        sh '''
          set -euo pipefail

          # 정적 배포 성공 여부 최소 검증
          test -f /opt/compass-mvp/index.html
        '''
      }
    }
  }
}
