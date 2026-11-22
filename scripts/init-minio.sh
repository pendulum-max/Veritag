#!/bin/sh
# chmod +x scripts/init-minio.sh
set -e

MINIO_ROOT_USER="${MINIO_ROOT_USER:-veritag}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-veritag-secret}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
MINIO_BUCKET="${MINIO_BUCKET:-veritag-files}"

echo "Waiting for MinIO at $MINIO_ENDPOINT ..."
RETRIES=30
i=0
until mc alias set local "$MINIO_ENDPOINT" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" > /dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge "$RETRIES" ]; then
    echo "ERROR: MinIO did not become ready after $RETRIES attempts." >&2
    exit 1
  fi
  echo "  attempt $i/$RETRIES — retrying in 2s..."
  sleep 2
done
echo "MinIO is ready."

if mc ls "local/$MINIO_BUCKET" > /dev/null 2>&1; then
  echo "Bucket '$MINIO_BUCKET' already exists, skipping creation."
else
  echo "Creating bucket '$MINIO_BUCKET'..."
  mc mb "local/$MINIO_BUCKET"
fi

echo "Setting public-read (download) policy on '$MINIO_BUCKET'..."
mc anonymous set download "local/$MINIO_BUCKET"

echo "Applying CORS policy to '$MINIO_BUCKET'..."
cat > /tmp/cors.json <<'EOF'
{
  "cors": [
    {
      "allowedOrigin": ["*"],
      "allowedMethod": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "allowedHeader": ["*"],
      "exposeHeader": ["ETag"],
      "maxAgeSeconds": 3600
    }
  ]
}
EOF
mc cors set "local/$MINIO_BUCKET" /tmp/cors.json

echo "MinIO initialisation complete."
exit 0
