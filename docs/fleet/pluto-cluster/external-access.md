# 🌐 External Game Access, Cloudflare DDNS & Cluster Security

This guide documents the architecture, configuration, and operational workflows for exposing game servers (Minecraft, TF2, Factorio) to the public internet using **Cloudflare DDNS** and **Router Port Forwarding**, as well as isolating cluster node authentication with a **dedicated cluster user password** via `agenix-rekey`.

---

## 📑 Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Dedicated Cluster Password Isolation](#2-dedicated-cluster-password-isolation)
3. [Cloudflare API Token & DNS Configuration](#3-cloudflare-api-token--dns-configuration)
4. [Secret Provisioning via Agenix](#4-secret-provisioning-via-agenix)
5. [NixOS & K3s Secret Synchronization](#5-nixos--k3s-secret-synchronization)
6. [Cloudflare DDNS Kubernetes Deployment](#6-cloudflare-ddns-kubernetes-deployment)
7. [Router Port Forwarding Matrix](#7-router-port-forwarding-matrix)
8. [Deployment & Verification Runbook](#8-deployment--verification-runbook)

---

## 1. Architecture Overview

```text
                                [ Internet Players ]
                                          │
                     ┌────────────────────┴────────────────────┐
                     │ DNS Resolution: mc.apollan.cc          │
                     │ (Cloudflare DNS - GREY CLOUD)           │
                     └────────────────────┬────────────────────┘
                                          │ Public WAN IP
                                          ▼
                               ┌─────────────────────┐
                               │     Home Router     │
                               │  (Port Forwarding)  │
                               └──────────┬──────────┘
                                          │ TCP 25565 / UDP 24454
                                          ▼
                               ┌─────────────────────┐
                               │   Pluto (K3s Node)  │
                               │    192.168.68.98    │
                               └──────────┬──────────┘
                                          │ NodePort / HostPort / CNI
                                          ▼
                      ┌───────────────────────────────────────┐
                      │    Namespace: games                   │
                      │    Pod: deploy/minecraft              │
                      │    Port: 25565 (TCP), 24454 (UDP)     │
                      └───────────────────────────────────────┘

                      ┌───────────────────────────────────────┐
                      │    Namespace: infrastructure          │
                      │    Pod: deploy/cloudflare-ddns        │
                      │    (Periodically updates A record)    │
                      └───────────────────▲───────────────────┘
                                          │ Injected on boot
                      ┌───────────────────┴───────────────────┐
                      │ NixOS Service: k3s-secrets-sync       │
                      │ Decrypts cloudflare-ddns-token.age    │
                      └───────────────────────────────────────┘
```

### Why Direct Port Forwarding + Cloudflare DDNS?
- **Cloudflare Tunnel (`cloudflared`)** is strictly designed for HTTP/HTTPS web services (Jellyfin, Home Assistant, Joplin). Raw TCP/UDP traffic through tunnels requires every connecting player to install and configure client-side `cloudflared access tcp` daemons, which is impractical for public gaming.
- **Third-party Proxies (e.g. Playit.gg)** introduce external routing latency and often charge subscription fees for custom domains.
- **Cloudflare DDNS with Grey Cloud (DNS Only)** keeps your custom domain (`mc.apollan.cc`) synchronized with your dynamic WAN IP at $0/yr while maintaining native, low-latency client connections.

---

## 2. Dedicated Cluster Password Isolation

To prevent credential compromise on headless, network-facing servers from impacting personal workstations, the cluster nodes (`hydra`, `pluto`, `styx`) use a distinct authentication secret (`cluster-passwd.age`), while desktop workstations (`mars`, `mercury`, `sol`) retain their existing password (`apollo-passwd.age`).

### Generation Workflow (on `mercury`)
1. Generate a SHA-512 crypt hash for the new cluster password:
   ```bash
   mkpasswd -m sha-512
   ```
2. Create and encrypt the master secret in `solar-secrets`:
   ```bash
   s-edit $HOME/src/solar-secrets/secrets/cluster-passwd.age
   ```
   Paste the generated `$6$...` hash on a single line, save, and exit.
3. Commit and push in `solar-secrets`:
   ```bash
   cd $HOME/src/solar-secrets
   git add secrets/cluster-passwd.age
   git commit -m "feat(secrets): add dedicated cluster password hash"
   git push
   ```

### Declarative NixOS Wiring (`modules/core/security/secrets.nix`)
In `solar`, the password logic selects `cluster-passwd.age` for cluster nodes and automatically falls back to `apollo-passwd.age` if not present:

```nix
    # 1. Core Secrets (User passwords, enabled via agenixPassword toggle)
    (lib.mkIf
      (
        config.myFeatures.core.system.users.agenixPassword
        && cfg.enable
        && cfg.usePrivateSecrets
        && hasPrivateSecrets
      )
      {
        age.secrets."password-apollo.age".rekeyFile =
          if (lib.elem config.networking.hostName [ "hydra" "pluto" "styx" ])
             && (builtins.pathExists "${secretsDir}/cluster-passwd.age")
          then
            "${secretsDir}/cluster-passwd.age"
          else
            "${secretsDir}/apollo-passwd.age";
      }
    )
```

---

## 3. Cloudflare API Token & DNS Configuration

### Step 1: Create the Cloudflare API Token
1. Log into the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **My Profile** ➔ **API Tokens** ➔ **Create Token**.
3. Use the **Edit zone DNS** template:
   - **Permissions**: `Zone` ➔ `DNS` ➔ `Edit`
   - **Zone Resources**: `Include` ➔ `Specific zone` ➔ `apollan.cc`
4. Complete the creation and copy the API Token.

### Step 2: Create DNS A Record
In Cloudflare DNS settings for `apollan.cc`:
- **Type**: `A`
- **Name**: `mc` (for `mc.apollan.cc`)
- **IPv4 Address**: `1.1.1.1` (placeholder; DDNS will update it automatically)
- **Proxy Status**: **DNS only (Grey Cloud)** ⚠️ *CRITICAL: Proxied (Orange Cloud) will block game client connections!*

---

## 4. Secret Provisioning via Agenix

On your management workstation (`mercury`):

1. Create the encrypted token file:
   ```bash
   s-edit $HOME/src/solar-secrets/secrets/cloudflare-ddns-token.age
   ```
   Paste the Cloudflare API token on a single line, save, and exit.

2. Commit & push `solar-secrets`:
   ```bash
   cd $HOME/src/solar-secrets
   git add secrets/cloudflare-ddns-token.age
   git commit -m "feat(secrets): add cloudflare ddns api token"
   git push
   ```

---

## 5. NixOS & K3s Secret Synchronization

### Host Secret Binding (`modules/core/security/secrets.nix`)
Add the secret definition for cluster nodes:
```nix
    (lib.mkIf
      (
        cfg.enable
        && cfg.usePrivateSecrets
        && hasPrivateSecrets
        && (builtins.pathExists "${secretsDir}/cloudflare-ddns-token.age")
        && (lib.elem config.networking.hostName [ "pluto" "hydra" "styx" ])
      )
      {
        age.secrets."cloudflare-ddns-token.age".rekeyFile = "${secretsDir}/cloudflare-ddns-token.age";
      }
    )
```

### K3s Sync Daemon (`modules/services/servers/k3s-secrets-sync.nix`)
Expose the option and inject it into the `infrastructure` namespace:

```nix
    cloudflareDdnsTokenPath = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = config.age.secrets."cloudflare-ddns-token.age".path or null;
      description = "Path to decrypted Cloudflare DDNS API token file.";
    };
```

In the activation script:
```bash
        # 4. Cloudflare DDNS Token (Namespace: infrastructure)
        CF_DDNS_PATH="${
          if cfg.cloudflareDdnsTokenPath != null then
            toString cfg.cloudflareDdnsTokenPath
          else
            "/persist/etc/kubernetes/secrets/cloudflare-ddns-token"
        }"
        if [ -f "$CF_DDNS_PATH" ]; then
          kubectl --kubeconfig "$KUBECONFIG" create namespace infrastructure --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG" apply -f -
          CF_TOKEN=$(cat "$CF_DDNS_PATH" | tr -d '\n\r ')
          kubectl --kubeconfig "$KUBECONFIG" create secret generic cloudflare-ddns-secret \
            --namespace=infrastructure \
            --from-literal=CLOUDFLARE_API_TOKEN="$CF_TOKEN" \
            --dry-run=client -o yaml | kubectl --kubeconfig "$KUBECONFIG" apply -f -
          echo "Synchronized cloudflare-ddns-secret in namespace 'infrastructure'."
        fi
```

### Rekeying Secrets (on `mercury`)
```bash
cd $HOME/src/solar
nix flake lock --update-input solar-secrets
s-rekey
git add modules/ rekeyed/ flake.lock
git commit -m "feat(security): configure cluster password and cloudflare-ddns sync"
git push
```

---

## 6. Cloudflare DDNS Kubernetes Deployment

Under `infrastructure/cloudflare-ddns/` in the `pluto-cluster` repository:

### `deployment.yaml`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflare-ddns
  namespace: infrastructure
  labels:
    app.kubernetes.io/name: cloudflare-ddns
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: cloudflare-ddns
  template:
    metadata:
      labels:
        app.kubernetes.io/name: cloudflare-ddns
    spec:
      containers:
        - name: cloudflare-ddns
          image: favonia/cloudflare-ddns:1.14.0
          imagePullPolicy: IfNotPresent
          env:
            - name: CLOUDFLARE_API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: cloudflare-ddns-secret
                  key: CLOUDFLARE_API_TOKEN
            - name: DOMAINS
              value: "mc.apollan.cc"
            - name: PROXIED
              value: "false"
            - name: UPDATE_CRON
              value: "@every 5m"
          resources:
            requests:
              cpu: 10m
              memory: 16Mi
            limits:
              cpu: 50m
              memory: 32Mi
```

### `kustomization.yaml`
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deployment.yaml
```

Include `- ./cloudflare-ddns` in `infrastructure/kustomization.yaml`, then commit and push.

---

## 7. Router Port Forwarding Matrix

Configure the following port forwarding rules on your home router WAN settings pointing to **Pluto (`192.168.68.98`)**:

| Service | Protocol | External Port | Internal IP | Internal Port | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Minecraft Server** | TCP | `25565` | `192.168.68.98` | `25565` | Main game connection |
| **Simple Voice Chat**| UDP | `24454` | `192.168.68.98` | `24454` | In-game proximity voice |
| **Factorio** *(Optional)* | UDP | `34197` | `192.168.68.98` | `34197` | Factorio multiplayer |
| **TF2** *(Optional)* | UDP / TCP | `27015` | `192.168.68.98` | `27015` | Team Fortress 2 server |
| **TF2 SourceTV** | UDP | `27020` | `192.168.68.98` | `27020` | SourceTV broadcast |

> [!NOTE]
> All the above ports are already pre-opened in Pluto's host firewall configuration (`modules/hosts/pluto/default.nix`).

---

## 8. Deployment & Verification Runbook

### Step 1: Upgrade Cluster Nodes
Apply the rekeyed secrets and updated systemd sync services on each cluster node:
```bash
# On pluto, hydra, and styx:
sudo systemctl start nixos-upgrade.service
```

### Step 2: Verify Kubernetes Secret Injection
Check that the secret was populated into the `infrastructure` namespace:
```bash
sudo kubectl get secret cloudflare-ddns-secret -n infrastructure
```

### Step 3: Monitor DDNS Updates
View the DDNS pod logs to ensure it detects your WAN IP and updates Cloudflare:
```bash
sudo kubectl logs -n infrastructure -l app.kubernetes.io/name:cloudflare-ddns -f
```
Expected output:
```text
Checking public IPv4 address...
IPv4 address is XX.XX.XX.XX.
Updating mc.apollan.cc (IPv4)...
Successfully updated mc.apollan.cc!
```

### Step 4: Verify External Player Join
Have external players connect to:
```text
mc.apollan.cc:25565
```
*(Or simply `mc.apollan.cc` since 25565 is the default Minecraft port).*
