FROM node:22-bookworm-slim AS node
# Multi-platform manifest digest, verified against Docker Hub on 2026-11-14.
FROM jenkins/jenkins:2.580.2-lts-jdk21@sha256:74401de6a6f92e1afe1b02d1c8e3d0c33f263bfb5275dd8813f9150355f2367b
USER root
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
WORKDIR /opt/a11ygate
COPY source/ ./
RUN npm ci --no-audit --no-fund \
 && npm run cli:build \
 && npx playwright install --with-deps chromium \
 && chmod -R a+rX /opt/ms-playwright
USER jenkins
RUN jenkins-plugin-cli --plugins configuration-as-code workflow-aggregator junit timestamper git
# A local SCM library: no remote checkout, credentials, or GitHub token.
RUN mkdir /tmp/a11ygate-library \
 && cp -R integrations/jenkins/vars /tmp/a11ygate-library/vars \
 && cd /tmp/a11ygate-library && git init -b main \
 && git add vars \
 && GIT_AUTHOR_NAME=DaveEliranAssistant GIT_AUTHOR_EMAIL=dave.eliran.assistant@gmail.com \
    GIT_COMMITTER_NAME=DaveEliranAssistant GIT_COMMITTER_EMAIL=dave.eliran.assistant@gmail.com \
    git commit -m 'Local library under test'
COPY --chown=jenkins:jenkins source/integrations/jenkins/test/docker/jenkins.yaml /usr/share/jenkins/ref/jenkins.yaml
COPY --chown=jenkins:jenkins source/integrations/jenkins/test/docker/init.groovy /usr/share/jenkins/ref/init.groovy.d/fixture.groovy
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/ref/jenkins.yaml
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false -Dhudson.plugins.git.GitSCM.ALLOW_LOCAL_CHECKOUT=true"
ENV JENKINS_OPTS="--httpListenAddress=127.0.0.1 --httpPort=8080"
WORKDIR /var/jenkins_home
