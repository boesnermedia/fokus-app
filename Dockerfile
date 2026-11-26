FROM alpine:3.20

ARG PB_VERSION=0.40.5

RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -O /tmp/pb.zip \
 && unzip /tmp/pb.zip pocketbase -d /pb \
 && rm /tmp/pb.zip

COPY pb_migrations /pb/pb_migrations
COPY pb_hooks /pb/pb_hooks
COPY pb_public /pb/pb_public
COPY seed /pb/seed
COPY entrypoint.sh /pb/entrypoint.sh
RUN chmod +x /pb/entrypoint.sh

EXPOSE 8090
CMD ["/pb/entrypoint.sh"]
