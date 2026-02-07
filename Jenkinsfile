pipeline {
  agent any

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

          node -v
          npm -v

          npm ci --legacy-peer-deps
          npm run build
        '''
      }
    }

    stage('Deploy (static)') {
      steps {
        sh '''
          set -euo pipefail

          sudo -n /bin/mkdir -p /opt/compass-mvp
          sudo -n /bin/rm -rf /opt/compass-mvp/*
          sudo -n /bin/cp -r out/* /opt/compass-mvp/

          sudo -n /usr/bin/find /opt/compass-mvp -type d -exec /bin/chmod 755 {} \\;
          sudo -n /usr/bin/find /opt/compass-mvp -type f -exec /bin/chmod 644 {} \\;

          sudo -n /sbin/restorecon -Rv /opt/compass-mvp || true
          sudo -n /bin/systemctl reload nginx
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
