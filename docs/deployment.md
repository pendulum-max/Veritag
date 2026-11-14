# Veritag Kubernetes & Helm Deployment Guide

This guide explains how to deploy the Veritag microservices (`backend`, `indexer`, and `web`) to a production Kubernetes cluster (AWS EKS, Google Cloud GKE, or self-hosted Kubernetes) using the official Helm chart in `deploy/helm/veritag`.

## Prerequisites

- **Kubernetes Cluster** (`>= 1.27`) with an Ingress controller (e.g., `ingress-nginx`) and optional `cert-manager` for automated TLS certificates.
- **Helm CLI** (`>= 3.12`)
- **PostgreSQL 16+** database instance (e.g., AWS RDS, Cloud SQL, or CloudNativePG)
- **S3-Compatible Object Storage** (AWS S3, Cloudflare R2, or MinIO)

---

## 1. Create the Kubernetes Secret

Before installing the Helm chart, create the `veritag-secrets` Secret in your target namespace containing sensitive database credentials, JWT signing keys, and Stellar sponsor secrets:

```bash
kubectl create namespace veritag

kubectl -n veritag create secret generic veritag-secrets \
  --from-literal=DATABASE_URL="postgres://veritag:STRONG_PASSWORD@postgres-host:5432/veritag" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=SPONSOR_SECRET="S..." \
  --from-literal=REGISTRY_ADMIN_SECRET="S..." \
  --from-literal=S3_ACCESS_KEY="your-s3-access-key" \
  --from-literal=S3_SECRET_KEY="your-s3-secret-key"
```

---

## 2. Validate and Render the Helm Chart

Run `helm lint` and `helm template` locally to validate chart syntax and inspect rendered manifests:

```bash
helm lint deploy/helm/veritag
helm template veritag deploy/helm/veritag --namespace veritag
```

---

## 3. Install or Upgrade the Release

```bash
helm upgrade --install veritag deploy/helm/veritag \
  --namespace veritag \
  --set ingress.webHost="veritag.yourdomain.com" \
  --set ingress.apiHost="api.veritag.yourdomain.com" \
  --set web.publicApiUrl="https://api.veritag.yourdomain.com"
```

---

## 4. Configuration Reference (`values.yaml`)

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `global.stellarNetwork` | `"testnet"` | Target Stellar network (`testnet` or `mainnet`). |
| `global.sorobanRpcUrl` | `"https://soroban-testnet.stellar.org"` | Soroban JSON-RPC endpoint. |
| `global.registryContractId` | `"CCOY35..."` | Deployed `VeritagRegistry` contract ID. |
| `global.accountFactoryContractId` | `"CDIHHV..."` | Deployed `AccountFactory` contract ID. |
| `global.existingSecretName` | `"veritag-secrets"` | Name of the Kubernetes Secret containing sensitive credentials. |
| `backend.replicaCount` | `2` | Initial replica count for the REST backend & fee-sponsor relayer. |
| `backend.autoscaling.enabled` | `true` | Enables HorizontalPodAutoscaler (HPA) for the backend (`2..10` pods). |
| `indexer.replicaCount` | `1` | Single active event-polling replica (`Recreate` strategy to avoid cursor races). |
| `web.replicaCount` | `2` | Initial replica count for the Next.js frontend. |
| `ingress.enabled` | `true` | Enables Kubernetes Ingress routing for `webHost` and `apiHost`. |
