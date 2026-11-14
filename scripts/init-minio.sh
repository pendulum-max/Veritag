#!/bin/sh
set -eu

MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-veritag}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-veritag-secret}"
S3_BUCKET="${S3_BUCKET:-veritag-files}"

echo "[minio-init] Waiting for MinIO server at ${MINIO_ENDPOINT}..."
MAX_RETRIES=30
COUNT=0
until mc alias set local "${MINIO_ENDPOINT}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null 2>&1; do
  COUNT=$((COUNT + 1))
  if [ "${COUNT}" -ge "${MAX_RETRIES}" ]; then
    echo "[minio-init] ERROR: Timed out waiting for MinIO at ${MINIO_ENDPOINT}" >&2
    exit 1
  fi
  sleep 2
done

echo "[minio-init] Ensuring bucket '${S3_BUCKET}' exists..."
mc mb --ignore-existing "local/${S3_BUCKET}"

echo "[minio-init] Setting anonymous download policy on 'local/${S3_BUCKET}' for development..."
mc anonymous set download "local/${S3_BUCKET}" || true

CORS_FILE="/tmp/veritag-cors.xml"
cat <<'EOF' > "${CORS_FILE}"
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>POST</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <ExposeHeader>x-amz-request-id</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
EOF

echo "[minio-init] Applying development CORS configuration to 'local/${S3_BUCKET}'..."
mc cors set "local/${S3_BUCKET}" "${CORS_FILE}" || true

echo "[minio-init] Provisioning complete for bucket '${S3_BUCKET}'."
