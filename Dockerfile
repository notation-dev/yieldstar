FROM ghcr.io/codex-src/codex-universal:2

apt-get update && apt-get install -y postgresql postgresql-contrib

service postgresql start

sudo -u postgres createdb yieldstar-test
sudo -u postgres psql -c "CREATE USER testuser WITH PASSWORD 'testpass';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE yieldstar-test TO testuser;"
sudo -u postgres psql -c "ALTER USER testuser CREATEDB;"