# Project Notes

## Running Postgres locally

The Dockerfile installs PostgreSQL and initializes a default data directory. Build and run the container to start a local database:

```bash
docker build -t yieldstar-dev .
docker run --rm -p 5432:5432 yieldstar-dev
```

Inside the container you can create a database with `createdb mydb` and connect using `psql mydb`. From the host, connect to `localhost:5432` with user `postgres`.
