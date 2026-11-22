# Veritag Deployment Guide

This guide covers deploying Veritag to Kubernetes using the Helm chart in `deploy/helm/veritag`.

## Prerequisites

- **Helm 3.x** — [install docs](https://helm.sh/docs/intro/install/)
- **kubectl** configured to target your cluster
- A Kubernetes cluster: AWS EKS, GKE, or self-hosted (1.24+)
- An ingress controller (nginx recommended; AWS ALB also supported)
- A PostgreSQL database (RDS, Cloud SQL, or self-hosted)
- An S3-compatible object store (AWS S3, MinIO, etc.)
- Container images built and pushed to a registry (see [Building Images](#building-images))

## Building Images

Each service has a Dockerfile at the monorepo root level. Build and push before deploying:

```bash
# Backend
docker build -f backend/Dockerfile -t ghcr.io/pendulum-max/veritag-backend:0.1.0 .
docker push ghcr.io/pendulum-max/veritag-backend:0.1.0

# Indexer
docker build -f indexer/Dockerfile -t ghcr.io/pendulum-max/veritag-indexer:0.1.0 .
docker push ghcr.io/pendulum-max/veritag-indexer:0.1.0

# Web (if applicable)
docker build -f web/Dockerfile -t ghcr.io/pendulum-max/veritag-web:0.1.0 .
docker push ghcr.io/pendulum-max/veritag-web:0.1.0
```

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/pendulum-max/Veritag.git
cd Veritag
```

### 2. Configure values

Copy the default values and edit for your environment:

```bash
cp deploy/helm/veritag/values.yaml my-values.yaml
```

At minimum, update:
- `backend.image.tag`, `indexer.image.tag`, `web.image.tag` — set to your image version
- `ingress.hosts` — set your real hostnames
- `backend.envFromSecret` — point to the K8s Secret you will create in the next step
- `backend.env.STELLAR_NETWORK` — `testnet` or `mainnet`

### 3. Create secrets and install

```bash
# Create the backend secret (see Secrets Management section)
kubectl create secret generic veritag-backend-secrets \
  --from-literal=DATABASE_URL="postgres://user:pass@host:5432/veritag" \
  --from-literal=JWT_SECRET="<strong-random-secret>" \
  --from-literal=REGISTRY_ADMIN_SECRET="<admin-secret>" \
  --from-literal=SPONSOR_SECRET="<sponsor-keypair-secret>" \
  --from-literal=S3_ENDPOINT="https://s3.amazonaws.com" \
  --from-literal=S3_ACCESS_KEY="<access-key>" \
  --from-literal=S3_SECRET_KEY="<secret-key>"

# Install the chart
helm install veritag deploy/helm/veritag \
  --namespace veritag \
  --create-namespace \
  -f my-values.yaml
```

## Configuration Reference

| Value | Default | Description |
|---|---|---|
| `nameOverride` | `""` | Override the chart name component of resource names |
| `fullnameOverride` | `""` | Override the full resource name prefix |
| `global.imageRegistry` | `""` | Optional prefix for all image repositories |
| `global.imagePullSecrets` | `[]` | List of pull-secret names for private registries |
| `backend.replicaCount` | `2` | Number of backend pods |
| `backend.image.tag` | `latest` | Backend image tag |
| `backend.envFromSecret` | `""` | Name of a K8s Secret to load as `envFrom` |
| `backend.autoscaling.enabled` | `false` | Enable HPA for the backend |
| `backend.autoscaling.minReplicas` | `2` | HPA minimum replicas |
| `backend.autoscaling.maxReplicas` | `10` | HPA maximum replicas |
| `backend.autoscaling.targetCPUUtilizationPercentage` | `70` | HPA CPU target |
| `indexer.replicaCount` | `1` | Number of indexer pods |
| `indexer.image.tag` | `latest` | Indexer image tag |
| `indexer.envFromSecret` | `""` | Name of a K8s Secret for the indexer |
| `indexer.autoscaling.enabled` | `false` | Enable HPA for the indexer |
| `web.replicaCount` | `2` | Number of web pods |
| `web.image.tag` | `latest` | Web image tag |
| `web.envFromSecret` | `""` | Name of a K8s Secret for the web service |
| `web.autoscaling.enabled` | `false` | Enable HPA for the web service |
| `ingress.enabled` | `true` | Deploy an Ingress resource |
| `ingress.className` | `nginx` | `ingressClassName` on the Ingress |
| `ingress.hosts` | see values.yaml | List of host/path/service routing rules |
| `ingress.tls` | `[]` | TLS configuration for the Ingress |

## Secrets Management

The backend reads sensitive configuration from environment variables. The recommended approach is a Kubernetes Secret referenced via `envFromSecret`.

### Required variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/veritag` |
| `JWT_SECRET` | Secret used to sign JWT tokens (at least 32 random bytes) |
| `REGISTRY_ADMIN_SECRET` | Stellar keypair secret for the registry admin account |
| `SPONSOR_SECRET` | Stellar keypair secret for the fee-sponsoring account |
| `S3_ENDPOINT` | S3-compatible endpoint URL |
| `S3_ACCESS_KEY` | S3 access key ID |
| `S3_SECRET_KEY` | S3 secret access key |

### Creating the secret

```bash
kubectl create secret generic veritag-backend-secrets \
  --namespace veritag \
  --from-literal=DATABASE_URL="postgres://user:pass@host:5432/veritag" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=REGISTRY_ADMIN_SECRET="<stellar-secret-key>" \
  --from-literal=SPONSOR_SECRET="<stellar-secret-key>" \
  --from-literal=S3_ENDPOINT="https://s3.amazonaws.com" \
  --from-literal=S3_ACCESS_KEY="<key-id>" \
  --from-literal=S3_SECRET_KEY="<secret>"
```

Then in `my-values.yaml`:

```yaml
backend:
  envFromSecret: veritag-backend-secrets
```

For the indexer, create a separate secret and set `indexer.envFromSecret` similarly. The indexer typically needs `DATABASE_URL` and any chain-specific keys.

> **Note:** For production, consider [External Secrets Operator](https://external-secrets.io/) or [Vault Agent Injector](https://developer.hashicorp.com/vault/docs/platform/k8s/injector) instead of manually managed secrets.

## Ingress Setup

### nginx ingress controller

The default `values.yaml` targets nginx. Install the controller if not already present:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx --namespace ingress-nginx --create-namespace
```

Configure hosts in your values file:

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: veritag.example.com
      paths:
        - path: /
          pathType: Prefix
          service: web
    - host: api.veritag.example.com
      paths:
        - path: /
          pathType: Prefix
          service: backend
```

### AWS ALB (EKS)

Install the AWS Load Balancer Controller, then set:

```yaml
ingress:
  enabled: true
  className: alb
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
    alb.ingress.kubernetes.io/certificate-arn: "arn:aws:acm:us-east-1:123456789012:certificate/..."
  hosts:
    - host: veritag.example.com
      paths:
        - path: /
          pathType: Prefix
          service: web
    - host: api.veritag.example.com
      paths:
        - path: /
          pathType: Prefix
          service: backend
```

The ALB controller handles TLS termination, so you do not need a `tls` block in this case.

### GKE managed ingress

```yaml
ingress:
  enabled: true
  className: gce
  annotations:
    kubernetes.io/ingress.global-static-ip-name: "veritag-ip"
    networking.gke.io/managed-certificates: "veritag-cert"
  hosts:
    - host: veritag.example.com
      paths:
        - path: /
          pathType: Prefix
          service: web
    - host: api.veritag.example.com
      paths:
        - path: /
          pathType: Prefix
          service: backend
```

Create a `ManagedCertificate` resource separately for GKE-managed TLS.

## TLS with cert-manager

Install cert-manager and create a `ClusterIssuer`, then configure:

```bash
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true
```

Create a `ClusterIssuer` (Let's Encrypt example):

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
```

Then in `my-values.yaml`:

```yaml
ingress:
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  tls:
    - secretName: veritag-tls
      hosts:
        - veritag.example.com
        - api.veritag.example.com
```

## Horizontal Pod Autoscaling

HPA is disabled by default. To enable it for the backend:

```yaml
backend:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
```

When `autoscaling.enabled` is `true`, the `replicaCount` field is ignored and the HPA manages pod count. The Metrics Server must be installed in your cluster for HPA to function:

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

The same `autoscaling` block is available under `indexer` and `web`.

## Cloud-Specific Notes

### AWS EKS

- Use `ingress.className: alb` and annotate with the ALB controller annotations shown above.
- Assign an IAM role with S3 permissions to the backend service account using IRSA rather than storing access keys in a secret where possible.
- Use Amazon RDS for PostgreSQL and reference the endpoint in `DATABASE_URL`.
- Node groups should be in at least two availability zones; set `topologySpreadConstraints` or pod anti-affinity in a custom `values.yaml` overlay.

### GKE

- Use `ingress.className: gce` with a `ManagedCertificate` resource for TLS.
- Use Cloud SQL with the Cloud SQL Auth Proxy as a sidecar, or reference the private IP directly.
- Use Workload Identity to avoid storing S3/GCS credentials in secrets.

## Upgrading

After updating images or configuration:

```bash
helm upgrade veritag deploy/helm/veritag \
  --namespace veritag \
  -f my-values.yaml \
  --set backend.image.tag=0.2.0 \
  --set indexer.image.tag=0.2.0 \
  --set web.image.tag=0.2.0
```

Helm performs a rolling update by default. Verify rollout status:

```bash
kubectl rollout status deployment/veritag-backend -n veritag
kubectl rollout status deployment/veritag-indexer -n veritag
kubectl rollout status deployment/veritag-web     -n veritag
```

To roll back to the previous release:

```bash
helm rollback veritag -n veritag
```

## Uninstalling

```bash
helm uninstall veritag --namespace veritag
```

This removes all Kubernetes resources created by the chart but does not delete the namespace, PersistentVolumeClaims, or secrets you created manually. Clean those up separately if needed:

```bash
kubectl delete secret veritag-backend-secrets -n veritag
kubectl delete namespace veritag
```

## Health Checks

Each service exposes a health endpoint used by liveness and readiness probes:

| Service | Probe path | Port |
|---|---|---|
| Backend | `/health` | 4000 |
| Indexer | `/healthz` | 8080 |
| Web | `/` | 3000 |

The web service does not have a dedicated health endpoint; probes hit `/`. If your Next.js build adds an `api/health` route, you can override the probe path with a custom values overlay.

## Troubleshooting

**Pods stuck in `Pending`:** Check node resource capacity with `kubectl describe node`. Reduce resource `requests` in values if the cluster is under-provisioned.

**`ImagePullBackOff`:** Verify the image tag exists in the registry and that `global.imagePullSecrets` references a valid pull secret in the namespace.

**Backend `CrashLoopBackOff`:** The most common cause is a missing or misconfigured `DATABASE_URL`. Check logs with `kubectl logs -n veritag deploy/veritag-backend`.

**Ingress returns 404:** Confirm the ingress controller is running and that `ingress.className` matches the controller's `--ingress-class` argument.
