FROM alpine:3.20

ARG PB_VERSION=0.40.5

RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -O /tmp/pb.zip \
 && unzip /tmp/pb.zip pocketbase -d /pb \
 && rm /tmp/pb.zip

COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY pb_public /pb/pb_public
# Dateinamen mit Inhalts-Hash: Browser und CDN holen bei jeder Änderung sofort die neue Version.
RUN cd /pb/pb_public && v=$(cat app.js app.css | md5sum | cut -c1-10) \
 && mv app.js app.$v.js && mv app.css app.$v.css \
 && sed -i "s/__V__/$v/g" index.html sw.js
COPY seed /pb/seed
COPY entrypoint.sh /pb/entrypoint.sh
RUN chmod +x /pb/entrypoint.sh

EXPOSE 8090
CMD ["/pb/entrypoint.sh"]
