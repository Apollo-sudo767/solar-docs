# 🚀 Multi-Tier Storage & Workload Migration Runbook

This runbook documents the **Hybrid Multi-Tier Storage Architecture** for the **Pluto High-Availability K3s Cluster** and provides step-by-step procedures for transitioning stateful workloads from an all-Nix bare-metal server (such as `venus`) into K3s.

---

## 📑 Table of Contents

1. [Hybrid Multi-Tier Storage Architecture](#1-hybrid-multi-tier-storage-architecture)
2. [Longhorn: Why Helm vs. Nix?](#2-longhorn-why-helm-vs-nix)
3. [Workload Storage Allocation Matrix](#3-workload-storage-allocation-matrix)
4. [Joplin Server Transition (Longhorn Replicated Block)](#4-joplin-server-transition-longhorn-replicated-block)
5. [WebDAV for Zotero Transition (Longhorn Replicated Block)](#5-webdav-for-zotero-transition-longhorn-replicated-block)
6. [Factorio & Team Fortress 2 Transition (Pluto NFS)](#6-factorio--team-fortress-2-transition-pluto-nfs)
7. [Nix-Minecraft Modpack Server Transition (Node-Local NVMe)](#7-nix-minecraft-modpack-server-transition-node-local-nvme)
8. [Post-Migration Verification & Cloudflare Ingress](#8-post-migration-verification--cloudflare-ingress)

---

## 1. Hybrid Multi-Tier Storage Architecture

Kubernetes supports multiple concurrent `StorageClass` providers. In the Pluto cluster, we mix and match three distinct tiers optimized for each workload's unique I/O characteristics:

```
                                  ┌─────────────────────────────────────────────────────────────┐
                                  │                     K3s CONTROL PLANE                       │
                                  └───────────────┬─────────────────────────────┬───────────────┘
                                                  │                             │
                     ┌────────────────────────────┼─────────────────────────────┐
                     │                            │                             │
                     ▼                            ▼                             ▼
        ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
        │  storageClass: longhorn │  │ storageClass: nfs-client │  │ storageClass: local-path│
        │ (Replicated Block Dev)  │  │ (Pluto High-Capacity NFS)│  │ (Direct Node-Local NVMe)│
        └────────────┬────────────┘  └────────────┬────────────┘  └────────────┬────────────┘
                     │                            │                             │
                     ▼                            ▼                             ▼
              • Joplin DB                  • Factorio                    • Minecraft
              • Zotero WebDAV              • Team Fortress 2               (Zero chunk lag)
              (HA across M920qs)           • Home Assistant
```

### Tier 1: 🛡️ Replicated Block Storage (`storageClassName: longhorn`)
* **Target Workloads**: **Joplin PostgreSQL** & **Zotero WebDAV**
* **Hardware Target**: Across the two Lenovo ThinkCentre M920q nodes (**`hydra`** & **`styx`**)
* **Resilience**: 
  * Synchronous 2-way block replication (`numberOfReplicas: 2`).
  * If one M920q loses power or performs an automated weekly NixOS upgrade reboot, Longhorn promotes the replica on the surviving node instantly. K3s restarts the Joplin/Zotero pod there with **zero data loss and zero split-brain risk**.

### Tier 2: 💾 Centralized High-Capacity NFS (`storageClassName: nfs-client`)
* **Target Workloads**: **Factorio**, **Team Fortress 2**, and **Home Assistant**
* **Hardware Target**: Hosted on Pluto's fast NVMe drive (`/persist/kubernetes/storage`)
* **Characteristics**:
  * Saves, maps, and server assets benefit from Pluto's high capacity and Ryzen 7 compute without the CPU/RAM overhead of continuous synchronous 2-node replication.
  * Centralized directory layout enables easy snapshots and automated BorgBackup jobs.

### Tier 3: ⚡ Direct Node-Local NVMe (`storageClassName: local-path`)
* **Target Workloads**: **Minecraft** (Paper or NeoForge Modpack)
* **Hardware Target**: Pinned directly to **`pluto`** via node affinity
* **Characteristics**:
  * Bypasses the network stack and replication layers completely, writing directly to `/persist/kubernetes/local-storage` on Pluto's NVMe (~3,500 MB/s).
  * Eliminates chunk-saving tick drops (**"Can't keep up! Is the server overloaded?"**), providing smooth world rendering for players.

---

## 2. Longhorn: Why Helm vs. Nix?

When orchestrating Longhorn on an ephemeral NixOS cluster, use a **clean division of responsibilities**:

| Layer | Tool | Configuration & Rationale |
| :--- | :--- | :--- |
| **Host & Kernel Layer** | **NixOS** (`solar`) | **Prerequisites only**: Enables the Linux kernel `iscsi_tcp` module, Open-iSCSI daemon (`services.openiscsi.enable = true`), filesystem utilities (`nfs-utils`, `e2fsprogs`, `xfsprogs`), and mounts the persistent volume directory (`/persist/kubernetes/longhorn`). *Already configured on `hydra`, `styx`, and `pluto` in `solar`!* |
| **Kubernetes CSI & Controller Layer** | **Helm via Flux** (`pluto-cluster`) | **Operator & CRDs**: Deploys the Longhorn manager DaemonSet, CSI driver, Webhook, replica policies (`defaultReplicaCount: 2`), and StorageClass via [`infrastructure/longhorn/helm-release.yaml`](https://github.com/Apollo-sudo767/pluto-cluster/blob/main/infrastructure/longhorn/helm-release.yaml). |

**Why Helm is the superior choice for the Kubernetes components**:
1. **GitOps Lifecycle**: Upgrading Longhorn versions, altering default replica counts, or modifying storage classes is managed through Git commits in `pluto-cluster` without having to rebuild the NixOS host closure.
2. **Clean Impermanence**: Helm values configure `defaultSettings.defaultDataPath: "/persist/kubernetes/longhorn"`, ensuring all volume blocks survive ephemeral tmpfs root wipes.

---

## 3. Workload Storage Allocation Matrix

| Service | Target Namespace | StorageClass | PVC Name & Size | Target Host Node | Network Route |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Joplin Postgres** | `productivity` | `longhorn` | `joplin-postgres-data` (10Gi) | Replicated across M920qs (`hydra` + `styx`) | Internal TCP 5432 |
| **Joplin Server** | `productivity` | Stateless | N/A | Any Control Plane Node | `joplin.apollan.cc` (Cloudflare ➔ 22300) |
| **Zotero WebDAV** | `productivity` | `longhorn` | `zotero-data` (20Gi) | Replicated across M920qs (`hydra` + `styx`) | `zotero.apollan.cc` (Cloudflare ➔ Nginx 80) |
| **Factorio** | `games` | `nfs-client` | `factorio-data` (10Gi) | Pluto NVMe NFS | `factorio.apollan.cc` (NodePort UDP 34197) |
| **Team Fortress 2** | `games` | `nfs-client` | `tf2-data` (25Gi) | Pluto NVMe NFS | NodePort UDP 27015 |
| **Minecraft** | `games` | `local-path` | `minecraft-data` (20Gi) | Pluto NVMe Node-Local | Playit.gg Sidecar + Voice UDP 24454 |

---

## 4. Joplin Server Transition (Longhorn Replicated Block)

### Step 4.1: Provision Secrets
Joplin requires a shared database password between PostgreSQL and the Joplin Server app:
1. Encrypt `joplin-secret.age` into `solar-secrets` following the [Secrets Guide](/fleet/pluto-cluster/secrets).
2. Or provision imperatively:
   ```bash
   kubectl create secret generic joplin-secret \
     --namespace=productivity \
     --from-literal=POSTGRES_PASSWORD="<your-secure-password>"
   ```

### Step 4.2: Export Existing Database from NixOS (`venus`)
```bash
ssh root@venus
systemctl stop joplin-server
sudo -u postgres pg_dump -d joplin --clean --if-exists > /tmp/joplin_backup.sql
```

### Step 4.3: Apply Workload Manifests & Initialize Database
```bash
# Apply Joplin stack to Pluto
kubectl apply -k apps/joplin

# Wait for PostgreSQL to become Ready
kubectl get pods -n productivity -l app=joplin-postgres -w

# Temporarily scale down Joplin Server so schema migrations don't conflict
kubectl scale deployment -n productivity joplin-server --replicas=0

# Stream database dump into K3s PostgreSQL pod
cat /tmp/joplin_backup.sql | kubectl exec -i -n productivity \
  $(kubectl get pod -n productivity -l app=joplin-postgres -o jsonpath='{.items[0].metadata.name}') \
  -- psql -U joplin -d joplin

# Scale Joplin back up
kubectl scale deployment -n productivity joplin-server --replicas=1
kubectl logs -n productivity -l app=joplin -f
```

---

## 5. WebDAV for Zotero Transition (Longhorn Replicated Block)

### Architecture Highlights
- **Dual-Container Pod**: `hacdias/webdav` (port 8081) paired with an `nginx:alpine` sidecar (port 80).
- **MKCOL Compatibility**: The sidecar intercepts `MKCOL` probes and returns `201 Created`, preventing Zotero client verification errors (HTTP 405). It also strips `/zotero` path prefixes and disables body size limits for large PDFs.

### Transferring Attachments into Longhorn
Because Longhorn creates raw virtual block devices rather than host directories:
1. Apply the Zotero manifests:
   ```bash
   kubectl apply -k apps/zotero
   ```
2. Stream attachment files directly into the running container:
   ```bash
   POD_NAME=$(kubectl get pod -n productivity -l app=zotero-webdav -o jsonpath='{.items[0].metadata.name}')

   # Tar from venus and stream into the container mount:
   ssh root@venus "tar -cf - -C /var/lib/zotero-webdav/zotero ." | \
     kubectl exec -i -n productivity $POD_NAME -c webdav -- tar -xf - -C /data/zotero

   # Ensure proper permissions:
   kubectl exec -i -n productivity $POD_NAME -c webdav -- chmod -R 0777 /data/zotero
   ```
3. Test in Zotero Desktop (`Settings ➔ Sync ➔ WebDAV`):
   - URL: `https://zotero.apollan.cc` (or `/zotero`)
   - Username: `unbalance`
   - Click **Verify Server** (turns green immediately).

---

## 6. Factorio & Team Fortress 2 Transition (Pluto NFS)

On Pluto (`nfs-client`), dynamic PVC directories are located on the host at `/persist/kubernetes/storage/<namespace>-<pvc-name>-*`.

### Step 6.1: Factorio Save & Mod Transfer
```bash
# 1. Stop service on Venus & scale down K3s deployment
ssh root@venus "systemctl stop factorio"
kubectl scale deployment -n games factorio-server --replicas=0

# 2. Locate PVC directory on NFS host (hydra or pluto):
FACTORIO_DIR=$(ssh apollo@<nfs-host> "ls -d /persist/kubernetes/storage/games-factorio-data-*")

# 3. Copy saves (rename to pluto_world.zip or adjust SAVE_NAME in deployment.yaml):
rsync -avzP /var/lib/factorio/saves/ apollo@<nfs-host>:${FACTORIO_DIR}/saves/

# 4. Copy mods and server-settings if present:
[ -d /var/lib/factorio/mods ] && rsync -avzP /var/lib/factorio/mods/ apollo@<nfs-host>:${FACTORIO_DIR}/mods/
[ -f /var/lib/factorio/config/server-settings.json ] && rsync -avzP /var/lib/factorio/config/server-settings.json apollo@<nfs-host>:${FACTORIO_DIR}/config/server-settings.json

# 5. CRUCIAL: Fix UID/GID ownership for factoriotools container (UID 845)
ssh apollo@<nfs-host> "chown -R 845:845 ${FACTORIO_DIR}"

# 6. Scale factorio-server back up:
kubectl scale deployment -n games factorio-server --replicas=1
kubectl logs -n games -l app=factorio -f
```

### Step 6.2: Team Fortress 2 Dedicated Server (Public Pub + On-Demand Comp 6s)

The TF2 dedicated server operates in **dual mode** hosted out of St. Louis, MO (`sv_region 0`):
1. **Public Casual Pub (Default)**: Listed on Valve's global server browser using a free Steam GSLT token, running popular Payload/5CP/KOTH maps with auto-fill bot quota (`tf_bot_quota 12`) so the server is never empty.
2. **On-Demand Comp 6s**: When 12+ players join, players can vote or an admin can trigger official tournament 6s mode (`rcon comp` or `rcon exec comp_6s.cfg`).

#### 1. Obtain & Encrypt Steam GSLT Token (Optional but Recommended for Public Listing)
1. Register a token at [steamcommunity.com/dev/managegameservers](https://steamcommunity.com/dev/managegameservers) with App ID **`440`** (Team Fortress 2).
2. Create `secrets/tf2-secret.age` in `solar-secrets`:
   ```bash
   cat << 'EOF' > /tmp/tf2.env
   SRCDS_TOKEN=YOUR_STEAM_GSLT_TOKEN_HERE
   SRCDS_RCONPW=YOUR_SECURE_RCON_PASSWORD_HERE
   EOF

   nix shell nixpkgs#age nixpkgs#age-plugin-yubikey -c age \
     -R ~/src/solar-secrets/master/apollo_user.pub \
     -R ~/src/solar-secrets/master/yubikey.pub \
     -o ~/src/solar-secrets/secrets/tf2-secret.age \
     /tmp/tf2.env

   rm -f /tmp/tf2.env
   ```

#### 2. Apply Manifests & Verify Port Binding
```bash
# Apply TF2 manifests
kubectl apply -k apps/tf2

# Verify pod and configmap
kubectl get pods -n games -l app=tf2 -w
kubectl logs -n games -l app=tf2 -c init-config
kubectl logs -n games -l app=tf2 -c tf2 -f
```

#### 3. In-Game Mode Toggling
* **Switch to 6s Match**: In console run `rcon comp` (or `rcon exec comp_6s`). Bots disappear, `mp_tournament 1` activates, class limits lock (2 Scout, 2 Soldier, 1 Demo, 1 Medic), and SourceTV records.
* **Return to Casual Pub**: In console run `rcon casual` (or `rcon exec casual`). Tournament ends, bot fill resumes, and casual mapcycle returns.

---

## 7. Nix-Minecraft Modpack Server Transition (Node-Local NVMe)

The Minecraft PVC uses `storageClassName: local-path` with `volumeBindingMode: WaitForFirstConsumer` pinned directly to Pluto's fast NVMe drive at `/persist/kubernetes/local-storage`.

### ⚠️ The Nix Store Symlink Trap
In `nix-minecraft`, mods and configs are symlinked directly into `/nix/store/...`. A standard `rsync -a` creates **broken dangling symlinks** inside Kubernetes because `/nix/store` does not exist inside standard OCI containers.

### Migration Options

#### Option A: Containerized Modpack via `itzg/minecraft-server` (Recommended)
Configure `apps/minecraft/deployment.yaml`:
```yaml
env:
  - name: TYPE
    value: "NEOFORGE"
  - name: VERSION
    value: "1.21.1"
  - name: MEMORY
    value: "12G"
  - name: MODRINTH_MODPACK
    value: "https://github.com/Phas-MC/NoMansLand/releases/download/1.0.2/PhasMC.s.No.Man.s.Land.mrpack"
```
Then transfer only the mutable world and user state:
```bash
MC_DIR=$(ssh apollo@pluto "ls -d /persist/kubernetes/local-storage/*minecraft-data*")

# Copy world & player databases
rsync -avzP /srv/minecraft/no-mans-land/world/ apollo@pluto:${MC_DIR}/world/
rsync -avzP /srv/minecraft/no-mans-land/*.json apollo@pluto:${MC_DIR}/

# Fix ownership for itzg container (UID 1000)
ssh apollo@pluto "chown -R 1000:1000 ${MC_DIR}"
```

#### Option B: Dereference Symlinks (`rsync -aL`)
```bash
# Note the capital -L flag to follow and dereference all symlinks into regular files:
rsync -avzLP /srv/minecraft/no-mans-land/ apollo@pluto:${MC_DIR}/
ssh apollo@pluto "chown -R 1000:1000 ${MC_DIR}"
```

---

## 8. Post-Migration Verification & Cloudflare Ingress

Restart Cloudflare tunnel to ensure all new ingress routes are active:
```bash
kubectl rollout restart deployment -n cloudflared cloudflared
```

### Automated Cluster Health Check Script

Run the automated smoke test script on any master node (`hydra` or `pluto`):

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

### Verification Checklist
- [ ] **Joplin**: `https://joplin.apollan.cc` loads cleanly; sync succeeds across desktop and mobile.
- [ ] **Zotero**: `https://zotero.apollan.cc` passes "Verify Server" probe in Zotero client; PDF attachments download and upload without errors.
- [ ] **Factorio**: Server is reachable at `factorio.apollan.cc:34197` (UDP); existing factory saves load without issue.
- [ ] **Minecraft**: Players connect via Playit tunnel domain or node IP; world chunks and inventories are intact.
