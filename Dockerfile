FROM ghcr.io/codex-src/codex-universal:2

USER root
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib && \
    rm -rf /var/lib/apt/lists/*

USER postgres
ENV PGDATA=/var/lib/postgresql/data
RUN mkdir -p $PGDATA && initdb -D $PGDATA

EXPOSE 5432
CMD ["postgres", "-D", "/var/lib/postgresql/data", "-c", "listen_addresses=*" ]
