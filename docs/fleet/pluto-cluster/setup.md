# 🪐 Pluto Cluster: Comprehensive Setup & Operations Guide

Welcome to the definitive guide for deploying, bootstrapping, and operating the **Pluto High-Availability K3s Cluster**.

This guide covers the complete deployment lifecycle—from the underlying NixOS flake infrastructure and central ZFS NAS storage to GitOps workload management, Nix-managed secrets, and external ingress for games and media.

---

## 📑 Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites & Hardware Nodes](#2-prerequisites--hardware-nodes)
3. [Storage Evolution: Progressive NFS & Sol NAS Migration](#3-storage-evolution-progressive-nfs--sol-nas-migration)
4. [Secret Management Architecture (Nix & Agenix)](#4-secret-management-architecture-nix--agenix)
5. [Cluster Bootstrapping & Quorum Initialization](#5-cluster-bootstrapping--quorum-initialization)
6. [GitOps Deployment with Flux CD](#6-gitops-deployment-with-flux-cd)
7. [External Access & Friend Connectivity](#7-external-access--friend-connectivity)
   - [Playit.gg Integration for Minecraft](#playitgg-sidecar-integration)
   - [Custom Domain & DNS SRV Records](#custom-domain--dns-srv-records)
   - [Cloudflare Ingress for Web Services](#cloudflare-ingress-for-web-services)
8. [Workloads Reference](#8-workloads-reference)
9. [Day-2 Operations & Maintenance](#9-day-2-operations--maintenance)
10. [Troubleshooting Runbook](#10-troubleshooting-runbook)

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

## 3. Storage Evolution: Progressive NFS & Sol NAS Migration

To accommodate physical deployment order and prevent drive exhaustion on smaller disks, storage progresses across three phases:

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

### Step 3: Transition Venus ➔ Node 3 (`pluto`) & Cut Over Storage
When ready to install Pluto on the Beelink hardware:
1. Follow the **[Venus ➔ MacBook ➔ ThinkCentre (Hydra) ➔ Pluto Complete Migration Runbook](./transfer)** for step-by-step data stashing and pod validation.
2. **Stage Pluto SSH Host Key on MacBook**:
   ```bash
   # From Mars:
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

## 8. Workloads Reference

| Workload | Namespace | Node Target | Memory / CPU | Storage PVC | Features |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Paper / Modpack Minecraft** | `games` | `pluto` (`node.type=compute`) | 8-12Gi RAM / 4 vCPU | 20-50Gi (`nfs-client`) | Aikar JVM flags, Playit sidecar |
| **Joplin Server + Postgres** | `productivity` | Any | 1.5Gi RAM / 1 vCPU | 10Gi (`nfs-client`) | Cloudflare Tunnel ingress |
| **Zotero WebDAV** | `productivity` | Any | 200Mi RAM / 0.5 vCPU | 20Gi (`nfs-client`) | Nginx sidecar, MKCOL probe intercept |
| **Factorio** | `games` | `pluto` (`node.type=compute`) | 2-4Gi RAM / 2 vCPU | 10Gi (`nfs-client`) | Headless server, UDP port 34197 |
| **Home Assistant** | `home-automation` | Any | 1Gi RAM / 1 vCPU | 10Gi (`nfs-client`) | Host networking, automated device discovery |
| **Jellyfin** | `media` | `hydra` (`gpu.vendor=intel`) | 4Gi RAM / 2 vCPU | 20Gi Config + Sol Media NFS | Intel QuickSync hardware transcoding (`/dev/dri`) |
| **qBittorrent + VPN** | `media` | Any | 4Gi RAM / 2 vCPU | 10Gi Config + Sol Media NFS | Gluetun Surfshark WireGuard VPN sidecar |

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
