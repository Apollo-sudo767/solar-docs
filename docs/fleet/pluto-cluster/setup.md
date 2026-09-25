# 🪐 Pluto Cluster: Comprehensive Setup & Operations Guide

Welcome to the definitive guide for deploying, bootstrapping, and operating the **Pluto High-Availability K3s Cluster**.

This guide covers the complete deployment lifecycle—from the underlying NixOS flake infrastructure and central ZFS NAS storage to GitOps workload management, Nix-managed secrets, and external ingress for games and media.

---

## 📑 Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites & Hardware Nodes](#2-prerequisites--hardware-nodes)
3. [Storage Evolution: Hybrid Multi-Tier & Progressive NFS](#3-storage-evolution-hybrid-multi-tier--progressive-nfs)
4. [Secret Management Architecture (Nix & Agenix)](#4-secret-management-architecture-nix--agenix)
5. [Cluster Bootstrapping & Quorum Initialization](#5-cluster-bootstrapping--quorum-initialization)
6. [GitOps Deployment with Flux CD](#6-gitops-deployment-with-flux-cd)
7. [External Access & Friend Connectivity](#7-external-access--friend-connectivity)
   - [Playit.gg Integration for Minecraft](#playitgg-sidecar-integration)
   - [Custom Domain & DNS SRV Records](#custom-domain--dns-srv-records)
   - [Cloudflare Ingress for Web Services](#cloudflare-ingress-for-web-services)
8. [Workload Setup & Operational Runbooks](#8-workload-setup--operational-runbooks)
   - [8.1 Workload Architecture & Allocation Matrix](#81-workload-architecture--allocation-matrix)
   - [8.2 Paper / Modpack Minecraft Server (`apps/minecraft`)](#82-paper--modpack-minecraft-server-appsminecraft)
   - [8.3 Factorio Dedicated Server (`apps/factorio`)](#83-factorio-dedicated-server-appsfactorio)
   - [8.4 Team Fortress 2 Dedicated Server (`apps/tf2`)](#84-team-fortress-2-dedicated-server-appstf2)
   - [8.5 Joplin Server & PostgreSQL (`apps/joplin`)](#85-joplin-server--postgresql-appsjoplin)
   - [8.6 Zotero WebDAV & Nginx Proxy (`apps/zotero`)](#86-zotero-webdav--nginx-proxy-appszotero)
   - [8.7 Home Assistant Core (`apps/home-assistant`)](#87-home-assistant-core-appshome-assistant)
   - [8.8 Media Suite: Jellyfin & Servarr (`apps/jellyfin`, `apps/arr`)](#88-media-suite-jellyfin--servarr-appsjellyfin-appsarr)
9. [Day-2 Operations & Maintenance](#9-day-2-operations--maintenance)
10. [Troubleshooting Runbook](#10-troubleshooting-runbook)
11. [Automated Cluster Health Check Script](#11-automated-cluster-health-check-script)

---

## 1. Architecture Overview

```
                      ┌─────────────────────────────────────────┐
                      │       Sol (Central ZFS Storage NAS)     │
                      │       NFS: sol.local:/tank/k3s-volumes  │
                      └────────────────────┬────────────────────┘
                                           │ Dynamic NFS PVCs
                 ┌─────────────────────────┼─────────────────────────┐
                 │                         │                         │
                 ▼                         ▼                         ▼
   ┌──────────────────────────┐┌──────────────────────────┐┌──────────────────────────┐
   │          hydra           ││           styx           ││          pluto           │
   │  ThinkCentre M920q Tiny  ││   ThinkPad T14 Gen 2     ││   Beelink EQR5 (Ryzen)   │
   │  Bootstrap Master Node   ││   Control Plane Master   ││   Control Plane Master   │
   │   clusterInit = true     ││      Battery capped      ││    node.type=compute     │
   │    gpu.vendor=intel      ││    Reboot: Sun 03:30     ││    Reboot: Sun 03:00     │
   │    Reboot: Sun 04:00     ││                          ││                          │
   └─────────────┬────────────┘└─────────────┬────────────┘└─────────────┬────────────┘
                 └───────────────────────────┼───────────────────────────┘
                                             │
                                   Embedded etcd Quorum
                                             │
                   ┌─────────────────────────┴─────────────────────────┐
                   ▼                                                   ▼
┌───────────────────────────────────────┐   ┌─────────────────────────────────────────┐
│     Minecraft & Game Server Pods      │   │    Jellyfin & Home Assistant Pods       │
│ ┌───────────────────┐ ┌─────────────┐ │   │ ┌─────────────────┐ ┌─────────────────┐ │
│ │ minecraft-server  │ │playit-agent │ │   │ │    Jellyfin     │ │ Home Assistant  │ │
│ │ (8GB RAM, 25565)  │ │ (Sidecar)   │ │   │ │ (Intel QuickSync│ │ (Home Automation│ │
│ └─────────▲─────────┘ └──────▲──────┘ │   │ │  Transcoding)   │ │  Port 8123)     │ │
│           └────── Loopback ──┘        │   │ └────────┬────────┘ └────────┬────────┘ │
└───────────────────▲───────────────────┘   └──────────┼───────────────────┼──────────┘
                    │ Outbound Tunnel                  └─────────┬─────────┘
                    ▼                                            ▼
           [ Playit.gg Anycast ]                     [ Cloudflare Tunnel (`cloudflared`) ]
                    ▲                                            ▲
            mc.apollan.cc                               jellyfin.apollan.cc
            (SRV Record)                               homeassistant.apollan.cc
```

---

## 2. Prerequisites & Hardware Nodes

The cluster operates across dedicated physical machines configured declaratively in the [Solar](https://github.com/Apollo-sudo767/solar) NixOS flake:

| Node | Hardware Spec | Role | Special System Configurations |
| :--- | :--- | :--- | :--- |
| **`hydra`** | Lenovo ThinkCentre M920q Tiny (i5-8500T, **24GB RAM**, NVMe) | Bootstrap Master (`clusterInit = true`) | `gpu.vendor=intel`, Intel QuickSync transcoding (`/dev/dri`), temporary initial NFS server, secrets sync daemon |
| **`styx`** | Lenovo ThinkPad T14 Gen 2 (i5, **16GB RAM**, NVMe) | Control-Plane Master (joins `hydra`) | Battery capped at 50% (`TLP`), lid-switch ignored, disabled WiFi power save |
| **`pluto`** | Beelink EQR5 (Ryzen 7 5825U, **32GB RAM**, NVMe) | Control-Plane Master (joins `hydra`) | `node.type=compute`, Primary game host, secondary NFS host |
| **`sol`** | Central ZFS Storage Server (Multi-NIC, HDD array) | Fleet NAS & Storage Hub | ZFS pool `tank`, NFS export `/tank/k3s-volumes` with `no_root_squash` |

All compute nodes run **stateless root filesystems** using tmpfs rollback on boot (Preservation/Impermanence) to guarantee reproducible, immutable nodes.

---

## 3. Storage Evolution: Hybrid Multi-Tier & Progressive NFS

The Pluto cluster implements a **Hybrid Multi-Tier Storage Architecture** providing three concurrent storage classes tailored to workload I/O:
- **`longhorn`**: Replicated block storage across M920qs (`hydra` & `styx`) for transactional databases (Joplin PostgreSQL, Zotero WebDAV).
- **`local-path`**: High-throughput node-local NVMe on `pluto` (`/persist/kubernetes/local-storage`) for latency-sensitive game servers (Minecraft).
- **`nfs-client`**: Centralized dynamic NFS storage for persistent game worlds (Factorio, TF2) and home automation.

*(For full architecture diagrams and database dump procedures, see the [Workload Migration Runbook](/fleet/pluto-cluster/migration)).*

To accommodate physical deployment order and prevent drive exhaustion on smaller disks, the shared NFS tier progresses across three phases:

### 3.1 Phase 1 (Local Testing): Temporary NFS on `hydra`
When Hydra is initialized locally before other nodes exist:
- Hydra exports `/persist/kubernetes/storage` via NFS (`services.nfs.server.enable = true`).
- `nfs-client-provisioner` points to `hydra:/persist/kubernetes/storage`.
- Runs initial lightweight workloads (Home Assistant, Cloudflare Tunnel).

Verify Hydra's NFS export:
```bash
showmount -e localhost
# Output:
# /persist/kubernetes/storage *
# /persist/k3s-volumes *
```

### 3.2 Phase 2: Cut Over NFS Storage to `pluto`
Because Hydra has a compact SSD and Pluto has a high-capacity NVMe drive with a Ryzen 7 5825U CPU, shared storage transitions to Pluto once Pluto joins the cluster:
1. Sync existing storage from Hydra to Pluto:
   ```bash
   sudo rsync -avz /persist/kubernetes/storage/ root@pluto:/persist/kubernetes/storage/
   ```
2. In `infrastructure/nfs-provisioner/deployment.yaml`, update `NFS_SERVER` to `"pluto"`.
3. Apply changes (`kubectl apply -k .`). Pluto’s fast NVMe now hosts all game saves and persistent claims.

### 3.3 Phase 3: Final Migration to `sol` ZFS NAS (When Built)
Once `sol` is assembled and running with its ZFS `tank` pool:
1. Copy all volumes over the network:
   ```bash
   rsync -avz /persist/kubernetes/storage/ sol:/tank/k3s-volumes/
   ```
2. In `infrastructure/nfs-provisioner/deployment.yaml`, update `NFS_SERVER` to `"sol.local"` and `NFS_PATH` to `"/tank/k3s-volumes"`.
3. In `apps/kustomization.yaml`, uncomment `- jellyfin` and `- arr`.
4. Commit and push: Flux/K3s will automatically migrate and deploy the full media streaming stack!

---

## 4. Secret Management Architecture (Nix & Agenix)

> [!IMPORTANT]
> **Zero plaintext secrets or secret manifests exist in this GitOps repository.**
> All credentials are encrypted using Age via [`agenix-rekey`](https://github.com/Apollo-sudo767/solar) in your private [`solar-secrets`](https://github.com/Apollo-sudo767/solar-secrets) repository.

### 4.1 Required Secrets Inventory

| Secret | Target Age File in `solar-secrets` | Format / Value |
| :--- | :--- | :--- |
| **K3s Cluster Token** | `secrets/k3s-token.age` | Secure random string: `openssl rand -hex 32` |
| **Playit Agent Secret** | `secrets/playit-secret.age` | Plain secret key string obtained from Playit.gg |
| **Cloudflare Credentials** | `secrets/cloudflared-credentials.age` | Complete credentials JSON from `cloudflared tunnel create` |
| **Surfshark WireGuard** | `secrets/surfshark-vpn.age` | Key-value env file: `WIREGUARD_PRIVATE_KEY` and `WIREGUARD_ADDRESSES` |
| **Joplin Database Credentials** | `secrets/joplin-secret.age` | Key-value env file: `POSTGRES_PASSWORD=...` |

### 4.2 Creating Node Public Keys (`hosts/`)
For `agenix-rekey` to encrypt secrets for your cluster machines, extract each machine's Age public key:
```bash
# On each node (or extract from /persist/etc/ssh/ssh_host_ed25519_key.pub):
ssh-to-age < /persist/etc/ssh/ssh_host_ed25519_key.pub
```
Save the resulting `age1...` strings into:
- `~/src/solar-secrets/hosts/pluto.pub`
- `~/src/solar-secrets/hosts/styx.pub`
- `~/src/solar-secrets/hosts/hydra.pub`
- `~/src/solar-secrets/hosts/sol.pub`

### 4.3 Editing and Rekeying Secrets
```bash
cd ~/src/solar-secrets

# 1. Create K3s Join Token:
s-edit secrets/k3s-token.age

# 2. Create Playit Secret:
s-edit secrets/playit-secret.age

# 3. Create Cloudflare Tunnel Credentials:
s-edit secrets/cloudflared-credentials.age

# 4. Create Surfshark WireGuard VPN Credentials:
s-edit secrets/surfshark-vpn.age

# 5. Create Joplin Database Credentials:
s-edit secrets/joplin-secret.age

# 6. Rekey secrets for all cluster nodes:
cd ~/src/solar
s-rekey
git add rekeyed/
git commit -m "chore: rekey secrets for pluto cluster"
git push origin main
```

### 4.4 Automated Secret Synchronization Daemon
On `hydra` and `pluto`, NixOS runs `k3s-secrets-sync.service`. On boot, once the K3s API server is ready, it automatically creates:
- `games/playit-secret`: With key `PLAYIT_SECRET_KEY`
- `cloudflared/cloudflared-credentials`: With file `credentials.json`
- `media/surfshark-vpn-secret`: With keys `WIREGUARD_PRIVATE_KEY` and `WIREGUARD_ADDRESSES`
- `productivity/joplin-secret`: With key `POSTGRES_PASSWORD`

---

## 5. Cluster Bootstrapping & Quorum Initialization

### Step 1: Deploy Node 1 (`hydra` - Bootstrap Master)
Hydra is the first physical box available locally. You can install it using the **Solar Live Installer USB** (`sudo solar-install`) or manually via Disko from a standard **NixOS Minimal Live USB**:

1. **Boot Hydra from a Live USB** and connect to the local network.
2. **Partition and Format via Disko**:
   ```bash
   sudo nix run github:nix-community/disko -- --mode zap-create-mount --flake "github:Apollo-sudo767/solar#hydra"
   ```
3. **Provision Persistent SSH Host Key**:
   ```bash
   sudo mkdir -p /mnt/persist/etc/ssh
   sudo ssh-keygen -t ed25519 -f /mnt/persist/etc/ssh/ssh_host_ed25519_key -N "" -C "root@hydra"
   sudo chmod 600 /mnt/persist/etc/ssh/ssh_host_ed25519_key
   cat /mnt/persist/etc/ssh/ssh_host_ed25519_key.pub
   ```
   *(On your workstation, place this public key in `solar-secrets/hosts/hydra.pub`, run `s-rekey`, and push to GitHub).*
4. **Install NixOS Closure & Reboot**:
   ```bash
   sudo nixos-install --flake "github:Apollo-sudo767/solar#hydra" --no-root-password
   sudo reboot
   ```
5. **Verify K3s & Secrets Sync on Hydra**:
   Because `clusterInit = true` is enabled on Hydra, it initializes the embedded etcd cluster:
   ```bash
   ssh apollo@<hydra-ip>
   sudo systemctl status k3s
   sudo kubectl get nodes -o wide
   sudo kubectl get secret -n cloudflared cloudflared-credentials
   ```
6. **Deploy Initial Workloads**:
   ```bash
   git clone https://github.com/Apollo-sudo767/pluto-cluster.git
   cd pluto-cluster
   sudo kubectl apply -k .
   ```

### Step 2: Join Node 2 (`styx` - Battery Protected Master)
Deploy the NixOS configuration to `styx`. It is configured with `serverAddr = "https://hydra:6443"` and automatically uses the shared `k3s-token.age`:
```bash
sudo nixos-rebuild switch --flake "github:Apollo-sudo767/solar#styx"
```

Verify the 2-node cluster from Hydra:
```bash
sudo kubectl get nodes
```

When ready to install Pluto on the Beelink hardware:
1. Follow the **[Venus ➔ MacBook ➔ ThinkCentre (Hydra) ➔ Pluto Complete Migration Runbook](/fleet/pluto-cluster/transfer)** for step-by-step data stashing and pod validation.
2. **Stage Pluto SSH Host Key on MacBook**:
   ```bash
   # From Mars:
   ssh apollo@macbook-pro "mkdir -p ~/.ssh/hosts"
   scp -r ~/.ssh/hosts/pluto apollo@macbook-pro:~/.ssh/hosts/
   # (Or from MacBook):
   mkdir -p ~/.ssh/hosts/pluto && scp -r apollo@mars:~/.ssh/hosts/pluto/ ~/.ssh/hosts/pluto/
   ```
3. **Boot Pluto with Solar Live Installer USB & Push Key**:
   ```bash
   # From MacBook to Pluto Live Installer:
   scp ~/.ssh/hosts/pluto/ssh_host_ed25519_key* root@<pluto-installer-ip>:/mnt/persist/etc/ssh/
   # Or stage in /home/nixos/ before partitioning:
   scp ~/.ssh/hosts/pluto/ssh_host_ed25519_key* nixos@<pluto-installer-ip>:/home/nixos/
   ```
4. **Install Pluto Closure**:
   Run `sudo solar-install` on the installer console, select `pluto`, confirm Disko LUKS formatting, and reboot.
5. Once Pluto boots and joins `https://hydra:6443`, full 3-node HA quorum is established:
   ```bash
   sudo kubectl get nodes
   ```
6. **Cut over shared NFS storage to Pluto**:
   ```bash
   sudo rsync -avzP /persist/kubernetes/storage/ root@pluto:/persist/kubernetes/storage/
   ```
   In `infrastructure/nfs-provisioner/deployment.yaml`, update `NFS_SERVER: "pluto"`, then commit and push.

### Step 4: Verify Node Labels
Workloads are scheduled onto specific nodes using labels:
```bash
kubectl get nodes --show-labels
```
- Verify `pluto` has `node.type=compute` (reserves heavy CPU/RAM for Minecraft, TF2, Factorio).
- Verify `hydra` has `gpu.vendor=intel` (targets Intel QuickSync video transcoding for Jellyfin).

---

## 6. GitOps Deployment with Flux CD

Workloads, storage provisioners, and ingress controllers are managed declaratively by Flux CD from the [`pluto-cluster`](https://github.com/Apollo-sudo767/pluto-cluster) repository.

### Step 1: Run the Bootstrap Helper
On `pluto` (or any machine with admin `KUBECONFIG` access to the cluster):
```bash
cd ~/src/pluto-cluster
./bootstrap.sh
```

The script will:
1. Validate cluster connectivity via `kubectl`.
2. Check for or install the Flux CLI.
3. Install the Flux controllers into the `flux-system` namespace.
4. Synchronize the Git repository `git@github.com:Apollo-sudo767/pluto-cluster.git`.
5. Apply the root Kustomizations (`clusters/pluto/infrastructure.yaml` and `clusters/pluto/apps.yaml`).

### Step 2: Track GitOps Synchronization Status
```bash
flux get kustomizations
flux get sources git
```

### Step 3: Verify Dynamic Storage Provisioning
```bash
kubectl get storageclass
```
Expected output showing the multi-tier provisioners:
```text
NAME                   PROVISIONER                                     RECLAIMPOLICY   VOLUMEBINDINGMODE
nfs-client (default)   cluster.local/nfs-subdir-external-provisioner   Delete          Immediate
longhorn               driver.longhorn.io                              Delete          Immediate
local-path             rancher.io/local-path                           Delete          WaitForFirstConsumer
```

---

## 7. External Access & Friend Connectivity

### Playit.gg Sidecar Integration
Minecraft uses Playit.gg to bypass firewalls and CGNAT without port forwarding:
1. The Minecraft deployment runs `itzg/minecraft-server` and `playitgg/playit-agent` within the same pod.
2. The agent reads `PLAYIT_SECRET_KEY` and establishes an outbound tunnel to Playit.gg's network.
3. Incoming game packets are delivered over the tunnel to `localhost:25565`.

#### Custom Domain & DNS SRV Records
To let friends connect using your domain (e.g. `mc.apollan.cc`) without typing ports:

1. In the [Playit Dashboard](https://playit.gg):
   - Open your agent tunnel ➔ Select **Custom Domains** ➔ Add `mc.apollan.cc`.
   - Note the assigned tunnel target (e.g. `galaxy-1234.craft.playit.gg`) and port (e.g. `34215`).
2. In **Cloudflare DNS**:
   - Add a **CNAME** Record: `mc` ➔ `galaxy-1234.craft.playit.gg` (DNS Only / Grey Cloud).
   - Add an **SRV** Record: `_minecraft._tcp.mc` ➔ Priority `0`, Weight `5`, Port `<assigned-port>`, Target `mc.apollan.cc`.

---

### Cloudflare Ingress for Web Services
Web services (Joplin, Zotero, Home Assistant, Jellyfin) are exposed securely over HTTPS via Cloudflare Tunnels:

1. Edit `infrastructure/cloudflared/configmap.yaml`:
   ```yaml
   ingress:
     - hostname: joplin.apollan.cc
       service: http://joplin.productivity.svc.cluster.local:22300
     - hostname: zotero.apollan.cc
       service: http://zotero.productivity.svc.cluster.local:80
     - hostname: homeassistant.apollan.cc
       service: http://home-assistant.home-automation.svc.cluster.local:8123
     - service: http_status:404
   ```
2. In Cloudflare DNS, add CNAME records for each hostname pointing to `<tunnel-id>.cfargotunnel.com` (Proxied / Orange Cloud).

---

## 8. Workload Setup & Operational Runbooks {#8-workload-setup--operational-runbooks}

This section provides dedicated, end-to-end setup and operational runbooks for every server and service running in the Pluto cluster. Each workload has distinct storage persistence classes, compute pin requirements, ingress routes, and secret configurations.

---

### 8.1 Workload Architecture & Allocation Matrix {#81-workload-architecture--allocation-matrix}

The Pluto cluster implements a multi-tier hardware allocation policy designed to match workload characteristics with physical hardware capabilities:

| Workload | Namespace | Node Target / Affinity | CPU & Memory | Storage Class & Size | External Ingress / Connectivity | Required Secrets |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Paper / Modpack Minecraft** | `games` | `pluto` (`node.type=compute`) | 4 vCPU / 8-12Gi RAM | `local-path` (20Gi NVMe) | Playit.gg Sidecar + Cloudflare SRV (`mc.apollan.cc`) | `playit-secret` |
| **Factorio Dedicated** | `games` | `pluto` (`node.type=compute`) | 2 vCPU / 2-4Gi RAM | `nfs-client` (10Gi NFS) | Router Port-Forward (UDP 34197) | None |
| **Team Fortress 2** | `games` | `pluto` (`node.type=compute`) | 2 vCPU / 2-4Gi RAM | `nfs-client` (25Gi NFS) | Router Port-Forward (UDP 27015/27020, TCP 27015) | `tf2-secret` (GSLT, RCON) |
| **Joplin Server + DB** | `productivity` | Any (`hydra` / `styx`) | 1 vCPU / 1.5Gi RAM | `longhorn` (10Gi Replicated) | Cloudflare Tunnel (`joplin.apollan.cc:22300`) | `joplin-secret` (PostgreSQL) |
| **Zotero WebDAV + Proxy** | `productivity` | Any (`hydra` / `styx`) | 0.5 vCPU / 250Mi RAM | `longhorn` (20Gi Replicated) | Cloudflare Tunnel (`zotero.apollan.cc:80`) | WebDAV bcrypt in ConfigMap |
| **Home Assistant Core** | `home-automation` | Any | 2 vCPU / 1-2Gi RAM | `nfs-client` (20Gi NFS) | Cloudflare Tunnel (`homeassistant.apollan.cc:8123`) | None |
| **Jellyfin Streaming** | `media` | `hydra` (`gpu.vendor=intel`) | 4 vCPU / 4-8Gi RAM | `nfs-client` (20Gi cfg + Sol Media) | Cloudflare Tunnel / LAN direct (Port 8096) | None |
| **qBittorrent + VPN** | `media` | Any | 2 vCPU / 2-4Gi RAM | `nfs-client` (10Gi cfg + Sol Media) | Gluetun Surfshark WireGuard / ClusterIP 8080 | `surfshark-vpn-secret` |

#### Hardware Resource Partitioning Rationale

1. **Beelink EQR5 (`pluto`)**: Compute heavyweight with AMD Ryzen 7 5700U (8 cores / 16 threads, 4.3 GHz boost) and 32GB RAM. Pinned for single-threaded tick-heavy game servers (`minecraft`, `factorio`, `tf2`). Node-local NVMe storage (`local-path`) is reserved for Minecraft to eliminate disk I/O wait times.
2. **ThinkCentre M920q (`hydra`)**: Intel Core i5-8500T with Intel UHD Graphics 630. Pinned for hardware transcoding in `jellyfin` via `/dev/dri` QuickSync passthrough.
3. **ThinkPad T14 Gen 2 (`styx`)**: Battery-backed mobile chassis acting as an uninterruptible quorum voter and control plane anchor.
4. **ThinkCentre M920q Pair (`hydra` + `styx`)**: Host 2-way replicated block storage (`longhorn`) for mission-critical relational databases (PostgreSQL for Joplin) and academic documents (Zotero WebDAV), preventing database corruption from network file system locks.
5. **Central ZFS NAS (`sol`)**: High-capacity dynamic storage via `nfs-client-provisioner` for read-heavy bulk files, media libraries, game saves, and non-blocking application configs.

---

### 8.2 Paper / Modpack Minecraft Server (`apps/minecraft`) {#82-paper--modpack-minecraft-server-appsminecraft}

The Minecraft server runs containerized Paper 1.21.1 (or Forge/NeoForge/Fabric modpacks) alongside an embedded `playit-agent` sidecar that enables instant, zero-port-forwarding public connections.

#### 1. Directory Structure & Key Manifests
- `apps/minecraft/namespace.yaml`: Defines `games` namespace.
- `apps/minecraft/pvc.yaml`: Requests 20Gi using `storageClassName: local-path` bound to Pluto's NVMe drive (`/persist/kubernetes/local-storage`).
- `apps/minecraft/deployment.yaml`: Runs `itzg/minecraft-server` and `playitgg/playit-agent`.
- `apps/minecraft/service.yaml`: Internal ClusterIP routing port 25565.

#### 2. Local-Path NVMe Storage Architecture
Minecraft world generation and chunk loading are notoriously sensitive to disk latency. Placing world chunks on an NFS mount causes severe server tick stalls ("Server can't keep up! Is the server overloaded?"). 

To guarantee 20 TPS (Ticks Per Second):
* The PVC uses `storageClassName: local-path` with `volumeBindingMode: WaitForFirstConsumer`.
* The Deployment defines a `nodeAffinity` targeting `node.type=compute` (`pluto`).
* The data directory mounts directly onto Pluto's fast NVMe drive at `/persist/kubernetes/local-storage`.

#### 3. Required Secrets Setup
The Playit sidecar requires a valid tunnel secret key:
```bash
# Option A: Direct Kubernetes Secret (Immediate deployment)
kubectl create secret generic playit-secret \
  --namespace=games \
  --from-literal=PLAYIT_SECRET_KEY="YOUR_PLAYIT_SECRET_KEY_HERE"

# Option B: Agenix (Solar GitOps managed)
# Add to ~/src/solar-secrets/secrets/playit-secret.age and sync via cluster daemon.
```

#### 4. Performance Tuning & Aikar JVM Flags
The deployment embeds proven Aikar Garbage Collection flags into the container environment:
```yaml
env:
  - name: EULA
    value: "TRUE"
  - name: VERSION
    value: "1.21.1"
  - name: TYPE
    value: "PAPER"
  - name: MEMORY
    value: "8G"
  - name: JVM_XX_OPTS
    value: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch"
```

#### 5. Public DNS & Friend Access Setup
1. In the [Playit.gg Dashboard](https://playit.gg):
   - Navigate to **Tunnels** ➔ **Add Tunnel** ➔ Type: **Minecraft (Java)** ➔ Port `25565`.
   - Go to **Custom Domains** ➔ Add `mc.apollan.cc`.
   - Note the generated tunnel host (e.g. `galaxy-1234.craft.playit.gg`) and external port (e.g. `34215`).
2. In **Cloudflare DNS**:
   - **CNAME Record**: `mc` ➔ `galaxy-1234.craft.playit.gg` (DNS Only / Grey Cloud).
   - **SRV Record**: `_minecraft._tcp.mc` ➔ Priority `0`, Weight `5`, Port `<assigned-port>`, Target `mc.apollan.cc`.
3. Players connect directly using: `mc.apollan.cc` without specifying any port.

#### 6. Voice Chat & Modpack Support
* **Simple Voice Chat (Plasmo / SimpleVoiceChat)**: Simple Voice Chat requires a separate UDP port (default `24454`). Create an additional UDP tunnel in Playit and bind it to container port 24454.
* **Modpack Switching**: To convert to a modpack, change `TYPE` to `FABRIC` or `NEOFORGE` and populate `/data/mods` and `/data/config`.

#### 7. Day-2 Operations & Commands
```bash
# Check server logs in real time
kubectl logs -n games -l app=minecraft -c minecraft-server -f

# Check Playit tunnel connectivity
kubectl logs -n games -l app=minecraft -c playit-agent

# Execute RCON console commands (e.g., OP player, whitelist)
kubectl exec -it -n games deploy/minecraft -c minecraft-server -- rcon-cli op apollo
kubectl exec -it -n games deploy/minecraft -c minecraft-server -- rcon-cli whitelist add friend1
```

---

### 8.3 Factorio Dedicated Server (`apps/factorio`) {#83-factorio-dedicated-server-appsfactorio}

The Factorio dedicated server runs headless `factoriotools/factorio:stable` backed by central Sol ZFS storage.

#### 1. Directory Structure & Key Manifests
- `apps/factorio/pvc.yaml`: Requests 10Gi using `storageClassName: nfs-client`.
- `apps/factorio/deployment.yaml`: Headless server deployment with automatic mod updating.
- `apps/factorio/service.yaml`: `NodePort` service exposing UDP `34197`.

#### 2. Network Routing & Port Forwarding
Factorio communicates entirely over UDP port 34197:
1. In `apps/factorio/service.yaml`, the service defines `type: NodePort` with `nodePort: 34197`.
2. On your router:
   - Create a UDP Port Forwarding rule: **WAN UDP 34197** ➔ **Pluto LAN IP (192.168.1.xxx) : 34197**.
3. Players connect via: `<your-public-ip-or-ddns>:34197`.

#### 3. Environment Variables & Mod Management
```yaml
env:
  - name: UPDATE_MODS_ON_START
    value: "true"
  - name: SAVE_NAME
    value: "pluto_world"
  - name: GENERATE_NEW_SAVE
    value: "true"
```
* **Automatic World Generation**: If no existing save exists with `pluto_world.zip` in `/factorio/saves/`, the server automatically creates a fresh procedural map on startup.
* **Mod Updating**: If mods are installed in `/factorio/mods/`, setting `UPDATE_MODS_ON_START: "true"` contacts the Factorio Mod Portal on every pod boot to fetch compatibility updates.
* **Permissions & UID**: The `factoriotools` container runs as internal user `factorio` (UID `845`, GID `845`). The NFS storage provisioner ensures permissions are cleanly retained across restarts.

#### 4. Custom Server Settings (`server-settings.json`)
To customize server name, visibility, and game behavior, place `server-settings.json` into the root of the data volume:
```json
{
  "name": "Pluto Factorio Realm",
  "description": "Hosted on Pluto HA K3s Cluster",
  "tags": ["space-age", "automation"],
  "max_players": 12,
  "visibility": {
    "public": true,
    "lan": true
  },
  "username": "apollo",
  "token": "YOUR_FACTORIO_AUTH_TOKEN",
  "game_password": "",
  "require_user_verification": true,
  "auto_pause": true
}
```

#### 5. Day-2 Operations & Commands
```bash
# View server logs and player joins
kubectl logs -n games -l app=factorio -f

# Upload existing game save directly to NFS volume
kubectl cp /path/to/my-save.zip games/$(kubectl get pod -n games -l app=factorio -o jsonpath='{.items[0].metadata.name}'):/factorio/saves/pluto_world.zip

# Restart server to load new save
kubectl rollout restart deployment -n games factorio-server
```

---

### 8.4 Team Fortress 2 Dedicated Server (`apps/tf2`) {#84-team-fortress-2-dedicated-server-appstf2}

The TF2 dedicated server operates in **dual mode** hosted out of St. Louis, MO (`sv_region 0`):
1. **Public Casual Pub (Default)**: Discoverable 24/7 on Valve's global server browser, auto-populating with bots (`tf_bot_quota 12`) when empty and cycling popular payload and control point maps.
2. **On-Demand Comp 6s**: Players or admins can trigger an instant switch to official 6v6 tournament mode with locked class limits and SourceTV demo recording.

#### 1. Directory Structure & Key Manifests
- `apps/tf2/configmap.yaml`: Embeds `server.cfg`, `casual.cfg`, `comp_6s.cfg`, `mapcycle.txt`, and `mapcycle_6s.txt`.
- `apps/tf2/pvc.yaml`: Requests 25Gi using `storageClassName: nfs-client` for game assets and custom maps.
- `apps/tf2/deployment.yaml`: Features an `init-config` container that stages custom configs into `/home/steam/tf-dedicated/tf/cfg/` with UID `1000:1000`.
- `apps/tf2/service.yaml`: Exposes game traffic (UDP 27015), RCON (TCP 27015), and SourceTV (UDP 27020).

#### 2. Steam GSLT Registration & Secret Management
To register on Valve's public master server browser, obtain a free Steam Game Server Login Token (GSLT):
1. Visit [steamcommunity.com/dev/managegameservers](https://steamcommunity.com/dev/managegameservers).
2. Create an account with App ID **`440`** (Team Fortress 2) and memo `Pluto TF2`.
3. Create the secret in the cluster:
```bash
kubectl create secret generic tf2-secret \
  --namespace=games \
  --from-literal=SRCDS_TOKEN="YOUR_GSLT_TOKEN_HERE" \
  --from-literal=SRCDS_RCONPW="YOUR_SECURE_RCON_PASSWORD"
```

#### 3. Network Ports & Router Forwarding
Forward the following ports on your gateway router to Pluto's LAN IP:
* **UDP 27015**: Game traffic (client connections)
* **TCP 27015**: RCON administration
* **UDP 27020**: SourceTV spectator broadcast

#### 4. Casual Pub Mode Architecture (`casual.cfg`)
* **Bot Auto-Fill**: `tf_bot_quota 12` with `tf_bot_quota_mode fill` ensures bots automatically fill empty slots. As human players connect, bots leave automatically.
* **Mapcycle**: Cycles `pl_badwater`, `pl_upward`, `pl_borneo`, `cp_badlands`, `cp_granary`, `cp_gullywash_final1`, `cp_snakewater_final1`, `koth_viaduct`, `koth_harvest_final`, and `koth_lakeside_final`.
* **Voting**: Native Source engine voting enabled (`sv_allow_votes 1`) for map change, restart game, and kick.

#### 5. Competitive 6s Mode Architecture (`comp_6s.cfg`)
* **Tournament Rules**: `mp_tournament 1` with 5CP and KOTH competitive mapcycle (`cp_process_final`, `cp_snakewater_final1`, `cp_badlands`, `cp_granary`, `cp_gullywash_final1`, `cp_sunshine`, `koth_product_final`).
* **Class Restrictions**:
  - Scout: 2
  - Soldier: 2
  - Demoman: 1
  - Medic: 1
  - Heavy: 1 / Pyro: 1 / Sniper: 1 / Spy: 1 / Engineer: 1
* **SourceTV Broadcast & Recording**: Automatic STV demo recording (`tv_enable 1`, `tv_autorecord 1`) streaming on port 27020 with 90-second spectator delay.

#### 6. Day-2 In-Game Operations
Open the TF2 Developer Console (`~`) in-game:
```bash
# Connect to console administration
rcon_password YOUR_SECURE_RCON_PASSWORD

# Switch instantly to official 6s tournament mode
rcon comp

# Return instantly to public casual pub with bots
rcon casual

# Change current map
rcon changelevel pl_upward
```

---

### 8.5 Joplin Server & PostgreSQL (`apps/joplin`) {#85-joplin-server--postgresql-appsjoplin}

Joplin Server provides end-to-end encrypted note synchronization across desktop and mobile devices, backed by a dedicated PostgreSQL 16 database.

#### 1. Directory Structure & Key Manifests
- `apps/joplin/namespace.yaml`: Defines `productivity` namespace.
- `apps/joplin/pvc.yaml`: Requests 10Gi using `storageClassName: longhorn` (`joplin-postgres-data`).
- `apps/joplin/postgres.yaml`: PostgreSQL 16 Alpine deployment and ClusterIP service.
- `apps/joplin/deployment.yaml`: Joplin Server 3.7.2 application deployment.
- `apps/joplin/service.yaml`: Internal ClusterIP service exposing port 22300.

#### 2. Longhorn Replicated Block Storage Architecture
Relational database management systems (RDBMS) like PostgreSQL rely on atomic POSIX write locks, fsync guarantees, and Write-Ahead Logging (WAL). Using NFS for database backends frequently leads to silent database corruption or locking stalls when network latencies fluctuate.

To prevent this:
* Joplin's PostgreSQL data directory (`/var/lib/postgresql/data`) is provisioned on **Longhorn**.
* Longhorn creates synchronous, block-level 2-way replicated volumes across the fast SSDs of **`hydra`** and **`styx`**.
* If either M920q reboots or goes offline for maintenance, the surviving node keeps PostgreSQL active with 0 data loss.

#### 3. Required Secrets Setup
```bash
# Generate a strong password and create the secret
DB_PASS=$(openssl rand -base64 24)
kubectl create secret generic joplin-secret \
  --namespace=productivity \
  --from-literal=POSTGRES_PASSWORD="${DB_PASS}"
```

#### 4. Cloudflare Ingress Mapping
Ensure `infrastructure/cloudflared/configmap.yaml` routes traffic to the internal Joplin service:
```yaml
ingress:
  - hostname: joplin.apollan.cc
    service: http://joplin.productivity.svc.cluster.local:22300
```
In Cloudflare DNS, ensure `joplin.apollan.cc` has a CNAME pointing to `<tunnel-id>.cfargotunnel.com` (Proxied).

#### 5. Day-2 Onboarding & Client Configuration
1. Open a browser and visit: `https://joplin.apollan.cc`.
2. Log in with initial administrator credentials:
   - **Email**: `admin@localhost`
   - **Password**: `admin`
3. **Change Administrator Password Immediately**: Navigate to **Profile** ➔ Update Password.
4. **Create Personal User**: Go to **Admin** ➔ **Users** ➔ Create a personal user account for yourself.
5. **Configure Joplin Desktop & Mobile Clients**:
   - Open Joplin Preferences ➔ **Synchronization**.
   - **Synchronization target**: `Joplin Server`.
   - **Joplin server URL**: `https://joplin.apollan.cc`.
   - **Joplin username / password**: Your personal account credentials.
   - Click **Check synchronisation configuration** ➔ Success!

---

### 8.6 Zotero WebDAV & Nginx Proxy (`apps/zotero`) {#86-zotero-webdav--nginx-proxy-appszotero}

The Zotero WebDAV service provides unlimited cloud file attachment synchronization for academic research papers, books, and annotations.

#### 1. Directory Structure & Key Manifests
- `apps/zotero/pvc.yaml`: Requests 20Gi using `storageClassName: longhorn` (`zotero-data`).
- `apps/zotero/configmap.yaml`: Embeds `webdav.yaml` (Hacdias engine configuration) and `nginx.conf` (reverse proxy compatibility rules).
- `apps/zotero/deployment.yaml`: Multi-container pod containing `webdav` backend, `nginx-proxy` sidecar, and `init-storage` setup.
- `apps/zotero/service.yaml`: Exposes port 80 to the cluster.

#### 2. The Zotero Compatibility Sidecar Problem & Solution
Standard WebDAV servers (such as Nextcloud, Apache, or bare Hacdias) notoriously fail with the Zotero desktop client due to rigid client-side expectations:
1. **The `MKCOL` Probe Trap**: When validating a WebDAV endpoint, the Zotero client issues an `MKCOL /zotero` HTTP request. If the directory already exists, RFC 4918 requires WebDAV servers to return `405 Method Not Allowed`. Zotero interprets this as a fatal failure and halts synchronization.
2. **Prefix Stripping**: Zotero often prepends `/zotero` or `/zotero/zotero` to asset URLs.
3. **Payload Limits**: Large PDF textbooks and scans trigger HTTP 413 (Payload Too Large) on standard proxies.
4. **CORS Headers**: WebDAV engines reject cross-origin requests containing browser origin headers.

**The Solution (`nginx-proxy` sidecar)**:
```nginx
location / {
    # 1. Intercept MKCOL probes and force 201 Created
    if ($request_method = MKCOL) {
        return 201;
    }

    # 2. Strip /zotero prefixes to route cleanly to WebDAV root
    rewrite ^/zotero/zotero/(.*)$ /$1 break;
    rewrite ^/zotero/zotero/?$ / break;
    rewrite ^/zotero/(.*)$ /$1 break;
    rewrite ^/zotero/?$ / break;

    # 3. Unlimited attachment sizes for books and datasets
    client_max_body_size 0;

    # 4. Strip Origin header to prevent WebDAV CORS errors
    proxy_set_header Origin "";

    # 5. Pass through essential WebDAV headers
    proxy_set_header Depth $http_depth;
    proxy_set_header Destination $http_destination;
    proxy_pass http://127.0.0.1:8081;
}
```

#### 3. User Password Configuration
In `apps/zotero/configmap.yaml`, user authentication is managed via bcrypt:
```yaml
users:
  - username: unbalance
    password: "{bcrypt}$2b$05$vdB4P/hY/tXngTOBHxuzOun7Mm.dOISAy139getu7z5MWUdofMZru"
    modify: true
    permissions: "CRUD"
```
To generate a new bcrypt hash for a custom password:
```bash
nix shell nixpkgs#apacheHttpd -c htpasswd -bnBC 10 "" "yourpassword" | tr -d ':\n'
```

#### 4. Cloudflare Ingress Mapping
In `infrastructure/cloudflared/configmap.yaml`:
```yaml
ingress:
  - hostname: zotero.apollan.cc
    service: http://zotero.productivity.svc.cluster.local:80
```

#### 5. Zotero Client Configuration & Verification
1. Open Zotero Desktop ➔ **Preferences** (or **Settings** on macOS).
2. Go to the **Sync** tab.
3. Under **File Syncing**:
   - Check **Sync attachment files in My Library using**: Select **WebDAV**.
   - **URL**: `https://zotero.apollan.cc` (or `https://zotero.apollan.cc/zotero`).
   - **Username**: `unbalance`.
   - **Password**: `<your-password>`.
4. Click **Verify Server**.
5. Zotero connects, probes directory creation, and displays:  
   **"File sync is successfully set up and working!"**

---

### 8.7 Home Assistant Core (`apps/home-assistant`) {#87-home-assistant-core-appshome-assistant}

Home Assistant Core orchestrates smart home devices, telemetry, automations, and dashboards across your local network.

#### 1. Directory Structure & Key Manifests
- `apps/home-assistant/namespace.yaml`: Defines `home-automation` namespace.
- `apps/home-assistant/pvc.yaml`: Requests 20Gi using `storageClassName: nfs-client` (`home-assistant-config`).
- `apps/home-assistant/deployment.yaml`: Runs `ghcr.io/home-assistant/home-assistant:stable`.
- `apps/home-assistant/service.yaml`: ClusterIP service exposing port 8123.

#### 2. Network Topologies: Cluster Overlay vs Host Networking
Home Assistant supports two operational networking modes in Kubernetes:
* **Standard Mode (`hostNetwork: false`, Default)**: Pod runs inside the K3s flannel overlay network (`10.42.0.0/16`). Ideal for pure cloud/API integrations (Ecobee, Hue Bridge, Tailscale, Cloudflare Tunnel).
* **Host Mode (`hostNetwork: true`)**: Bypasses the container network stack and binds directly to the physical node's network interface. **Required if you need local mDNS, SSDP, Matter, or Zigbee/Z-Wave USB device auto-discovery**.

#### 3. Reverse Proxy & Trusted Proxies Configuration
When accessed through Cloudflare Tunnel, Home Assistant rejects requests with HTTP 400 (Bad Request) unless reverse proxy headers are explicitly trusted.

Ensure `/config/configuration.yaml` on the storage volume includes:
```yaml
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 10.42.0.0/16       # K3s Pod Overlay CIDR
    - 10.43.0.0/16       # K3s Service CIDR
    - 192.168.1.0/24     # Local LAN Subnet
```

#### 4. Cloudflare Ingress Mapping
In `infrastructure/cloudflared/configmap.yaml`:
```yaml
ingress:
  - hostname: homeassistant.apollan.cc
    service: http://home-assistant.home-automation.svc.cluster.local:8123
```
> [!NOTE]
> In the Cloudflare Zero Trust dashboard, ensure **WebSockets** are enabled under Network settings for the tunnel domain. Home Assistant's Lovelace UI depends entirely on real-time WebSockets.

#### 5. Day-2 Operations
```bash
# View startup logs and integration warnings
kubectl logs -n home-automation -l app=home-assistant -f

# Edit configuration.yaml directly inside pod
kubectl exec -it -n home-automation deploy/home-assistant -- vi /config/configuration.yaml

# Restart Home Assistant to apply configuration changes
kubectl rollout restart deployment -n home-automation home-assistant
```

---

### 8.8 Media Suite: Jellyfin & Servarr (`apps/jellyfin`, `apps/arr`) {#88-media-suite-jellyfin--servarr-appsjellyfin-appsarr}

The media suite delivers a private, automated media streaming and indexing pipeline consisting of Jellyfin, Sonarr, Radarr, Prowlarr, and a VPN-isolated qBittorrent client.

#### 1. Hardware Transcoding & Intel QuickSync Pinning (`hydra`)
Jellyfin requires hardware-accelerated transcoding to stream 4K HEVC / H.264 content to low-power clients without pegging the CPU.
* **Node Selection**: Pinned to **`hydra`** via `nodeSelector: gpu.vendor: intel`.
* **Device Passthrough**: Mounts `/dev/dri` (Intel UHD Graphics 630) directly into the pod with `privileged: true`.
* **Jellyfin Playback Settings**:
  - In Jellyfin Dashboard ➔ **Playback** ➔ **Transcoding**:
  - Hardware Acceleration: **Intel QuickSync (QSV)**.
  - Enable hardware decoding for: **H.264, HEVC, MPEG2, VC1, VP9, AV1**.
  - Enable **VPP Tone Mapping** and **Low-Power Encoding**.

#### 2. qBittorrent & Gluetun Surfshark VPN Sidecar Kill-Switch
To protect privacy and prevent torrent traffic leaks:
* Container `gluetun` establishes a WireGuard tunnel directly to Surfshark servers in the Netherlands.
* Container `qbittorrent` shares the network namespace (`container:gluetun`), meaning **if the VPN drops, all torrent networking instantly severs (strict kill-switch)**.
* Required Secret:
  ```bash
  kubectl create secret generic surfshark-vpn-secret \
    --namespace=media \
    --from-literal=WIREGUARD_PRIVATE_KEY="YOUR_SURFSHARK_WG_KEY" \
    --from-literal=WIREGUARD_ADDRESSES="10.14.0.2/16"
  ```
* Local Cluster Access: Gluetun's `FIREWALL_OUTBOUND_SUBNETS` is configured with `10.42.0.0/16,192.168.0.0/16` so Radarr, Sonarr, and your browser can reach the qBittorrent WebUI on port 8080 without leaking torrent traffic.

#### 3. Central Sol ZFS Storage Integration
All media workloads share the high-capacity NFS volume from Sol:
* `jellyfin-media` mounts `/tank/media` (or `/tank/k3s-volumes/media`) to `/media` across Jellyfin and qBittorrent.
* Individual config volumes (`jellyfin-config`, `qbittorrent-config`, `radarr-config`, `sonarr-config`, `prowlarr-config`) store database indexes and application state.

#### 4. Automated Servarr Pipeline Workflow
1. **Prowlarr (Indexers)**: Synchronizes trackers and torrent search providers with Radarr and Sonarr via internal service endpoints:
   - Sonarr URL: `http://sonarr.media.svc.cluster.local:8989`
   - Radarr URL: `http://radarr.media.svc.cluster.local:7878`
2. **Download Client**: Both Radarr and Sonarr are configured with download client:
   - Host: `qbittorrent.media.svc.cluster.local` (Port: `8080`).
3. **Automated Organization**:
   - Completed movies ➔ `/media/movies`.
   - Completed TV shows ➔ `/media/tv`.
4. **Jellyfin Notification**: Jellyfin automatically scans `/media` upon file system updates, immediately presenting media to streaming clients.

---

## 9. Day-2 Operations & Maintenance

### Staggered Maintenance & Automated Reboots
To keep the cluster continuously updated without dropping etcd quorum, each node runs automated NixOS upgrades and reboots on Sunday morning, staggered by 30 minutes:

| Node | Reboot Schedule | Quorum Status During Window |
| :--- | :--- | :--- |
| **`pluto`** | Sunday 03:00 UTC | 2/3 masters online (`styx`, `hydra`) — Quorum preserved |
| **`styx`** | Sunday 03:30 UTC | 2/3 masters online (`pluto`, `hydra`) — Quorum preserved |
| **`hydra`** | Sunday 04:00 UTC | 2/3 masters online (`pluto`, `styx`) — Quorum preserved |

---

## 10. Troubleshooting Runbook

### Issue 1: Pods Stuck in `Pending` with Storage Errors
- **Check**: `kubectl describe pvc -n <namespace>`
- **Resolution**: Verify NFS export is reachable from all nodes (`showmount -e <nfs-server>`). Ensure `nfs-client-provisioner` pod is running.

### Issue 2: Node Fails to Join K3s Quorum
- **Check**: `journalctl -u k3s -e` on the failing node.
- **Resolution**: Check if the token matches (`cat /run/agenix/k3s-token.age`). Ensure TCP ports `6443` and `2379:2380` are open in firewall.

### Issue 3: Friends Cannot Connect to Minecraft
- **Check**: View Playit sidecar logs:
  ```bash
  kubectl logs -n games -l app=minecraft -c playit-agent
  ```
- **Resolution**: Check Playit secret validity and verify SRV record target/port in Cloudflare DNS.

---

### 11. Automated Cluster Health Check Script

Run this smoke test script directly on any master node (`hydra`, `pluto`, or `styx`) to test nodes, PVCs, databases, and game pods in one pass:

```bash
cat << 'EOF' > /tmp/check-cluster.sh
#!/usr/bin/env bash
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo "=== 🪐 PLUTO CLUSTER HEALTH CHECK ==="
echo ""

# 1. Nodes
echo -n "Checking K3s Node Status... "
if kubectl get nodes | grep -q "Ready"; then
  echo -e "${GREEN}✓ Ready${NC}"
else
  echo -e "${RED}✗ Node not ready${NC}"
fi

# 2. PVCs
echo -n "Checking PVC Status... "
PENDING_PVCS=$(kubectl get pvc -A --no-headers 2>/dev/null | grep -v "Bound" | wc -l)
if [ "$PENDING_PVCS" -eq 0 ]; then
  echo -e "${GREEN}✓ All PVCs Bound${NC}"
else
  echo -e "${RED}✗ $PENDING_PVCS PVCs not bound${NC}"
fi

# 3. Joplin Web Service
echo -n "Testing Joplin HTTP Service... "
if kubectl exec -n productivity deploy/joplin-server -- wget -qO- http://localhost:22300/login >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Joplin HTTP 200${NC}"
else
  echo -e "${RED}✗ Joplin unreachable${NC}"
fi

# 4. Joplin Postgres Database
echo -n "Testing Joplin Database... "
NOTE_COUNT=$(kubectl exec -i -n productivity deploy/joplin-postgres -- psql -U joplin -d joplin -t -c "SELECT count(*) FROM notes;" 2>/dev/null | xargs)
if [ -n "$NOTE_COUNT" ]; then
  echo -e "${GREEN}✓ Postgres connected ($NOTE_COUNT notes)${NC}"
else
  echo -e "${RED}✗ Postgres query failed${NC}"
fi

# 5. Minecraft Server & RCON
echo -n "Testing Minecraft Server (RCON)... "
if kubectl exec -n games deploy/minecraft -c minecraft-server -- rcon-cli list >/dev/null 2>&1; then
  echo -e "${GREEN}✓ RCON active & World loaded${NC}"
else
  echo -e "${RED}✗ Minecraft RCON not responding${NC}"
fi

# 6. Factorio Server
echo -n "Testing Factorio Server Logs... "
if kubectl logs -n games deploy/factorio-server --tail=100 2>&1 | grep -q "Hosting game at port"; then
  echo -e "${GREEN}✓ Server hosting on UDP 34197${NC}"
else
  echo -e "${RED}✗ Factorio host line not found in logs${NC}"
fi

# 7. Playit Tunnel Sidecar
echo -n "Testing Playit Tunnel Sidecar... "
if kubectl logs -n games deploy/minecraft -c playit-agent --tail=50 2>&1 | grep -qiE "registered|connected"; then
  echo -e "${GREEN}✓ Tunnel connected${NC}"
else
  echo -e "${RED}✗ Playit tunnel not connected${NC}"
fi

echo ""
echo "=== HEALTH CHECK FINISHED ==="
EOF

chmod +x /tmp/check-cluster.sh
/tmp/check-cluster.sh
```
