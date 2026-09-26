# 🚚 Pluto Cluster: Network Relocation & VLAN Deployment Runbook

This runbook covers the end-to-end operational procedure for relocating the **Pluto High-Availability K3s Cluster** (`hydra`, `pluto`, `styx`) from one physical network to another (e.g., from home staging to a friend's house or off-site location on a dedicated VLAN).

---

## 📑 Table of Contents
1. [Architectural Portability Overview](#1-architectural-portability-overview)
2. [VLAN & Host Network Requirements](#2-vlan--host-network-requirements)
3. [Phase 1: Pre-Departure Graceful Shutdown](#3-phase-1-pre-departure-graceful-shutdown)
4. [Phase 2: Packing Checklist](#4-phase-2-packing-checklist)
5. [Phase 3: Arrival & Power-On Sequence](#5-phase-3-arrival--power-on-sequence)
6. [Phase 4: Router Port Forwarding & DHCP Reservation](#6-phase-4-router-port-forwarding--dhcp-reservation)
7. [Phase 5: 60-Second On-Site Verification](#7-phase-5-60-second-on-site-verification)
8. [Troubleshooting Network / Subnet Shifts](#8-troubleshooting-network--subnet-shifts)

---

## 1. Architectural Portability Overview

The Pluto Cluster is engineered to be portable across different LAN subnets with minimal manual intervention:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Dedicated Cluster VLAN                          │
│                                                                        │
│   ┌──────────────┐          ┌──────────────┐         ┌─────────────┐   │
│   │    Hydra     │          │    Pluto     │         │    Styx     │   │
│   │ ThinkCentre  │          │ Beelink EQR5 │         │  ThinkPad   │   │
│   └──────┬───────┘          └──────┬───────┘         └──────┬──────┘   │
│          │ eth0                    │ eno1                   │ eth0     │
│          └────────────────┬────────┴────────────────────────┘          │
│                           │                                            │
│                 ┌─────────▼─────────┐                                  │
│                 │ 5/8-Port Gb Switch│ (L2 Unmanaged Wire-Speed Switch) │
│                 └─────────┬─────────┘                                  │
└───────────────────────────┼────────────────────────────────────────────┘
                            │ Single Uplink Cable
                  ┌─────────▼─────────┐
                  │   Router / VLAN   │
                  │   (Access Port)   │
                  └─────────┬─────────┘
                            │ WAN Internet
                            ▼
          ┌─────────────────┴─────────────────┐
          │                                   │
          ▼                                   ▼
┌──────────────────┐               ┌──────────────────┐
│ Cloudflare Argo  │               │ Cloudflare DDNS  │
│ Tunnel Outbound  │               │ Updates Public IP│
│ (Joplin, Zotero) │               │ (mc.apollan.cc)  │
└──────────────────┘               └──────────────────┘
```

### What Handles Subnet Changes Automatically:
- **Tailscale Mesh (`100.x.y.z`)**: All nodes automatically establish encrypted outbound peer tunnels to the Tailscale coordination server. You can always SSH into `apollo@hydra`, `apollo@pluto`, and `apollo@styx` via Tailscale from your laptop regardless of local subnet.
- **Cloudflare Tunnel (`cloudflared`)**: Creates an outbound QUIC tunnel to Cloudflare Edge. **Zero router port forwarding is required** for web workloads (`zotero.apollan.cc`, `joplin.apollan.cc`).
- **Cloudflare Dynamic DNS (`cloudflare-ddns`)**: Detects the host site's public WAN IP automatically on boot and keeps `mc.apollan.cc` synchronized every 5 minutes.
- **Flannel CNI (`--flannel-iface`)**: Nodes bind Flannel overlay traffic dynamically to their physical Ethernet interfaces (`eno1` on Pluto, `eth0` on Hydra/Styx), adapting to whatever DHCP lease the VLAN router provides.

---

## 2. VLAN & Host Network Requirements

Placing the cluster on its own dedicated VLAN is ideal for isolating game server and database traffic from household consumer devices. Ensure the host router meets these three requirements:

### Requirement 1: Access Port (Untagged)
- The switch port or wall jack connected to the cluster switch must be configured as an **Untagged / Native Access Port** for the designated VLAN.
- Nodes will request DHCP leases normally without requiring 802.1Q VLAN sub-interface tagging in NixOS.

### Requirement 2: Disable Client / Port Isolation
> [!WARNING]
> Many router platforms (UniFi, pfSense, OPNsense, Omada) default to enabling **"Client Isolation"**, **"Guest Isolation"**, or **"Private VLAN"** on secondary VLANs.
> If enabled, the router blocks devices on the same subnet from communicating with each other, which instantly breaks Flannel VXLAN (UDP `8472`) and `etcd` peer clustering.
> **Confirm with your host that Client/Port Isolation is DISABLED on the VLAN.**

> [!TIP]
> Plugging all 3 nodes into an **unmanaged Gigabit desktop switch** and running a single uplink cable to the router/VLAN wall jack guarantees all node-to-node Flannel and etcd traffic is switched locally at line rate without router interference.

### Requirement 3: Inbound & Outbound Firewall Rules
- **Outbound WAN**: Must permit outbound traffic on TCP `443` (HTTPS), UDP `7844` / `443` (Cloudflare Tunnel QUIC), and UDP `41641` (Tailscale WireGuard).
- **Inbound WAN (Port Forwarding)**: The router firewall must permit forwarded game traffic from WAN into the specific VLAN to reach Pluto.

---

## 3. Phase 1: Pre-Departure Graceful Shutdown

> [!CAUTION]
> **Never pull the power cords directly.** An ungraceful power cutoff can corrupt etcd database transactions or cause Longhorn distributed block storage volumes to become degraded.

Perform a clean shutdown from your laptop or console in this exact order:

```bash
# 1. Shut down Styx (Joining Control Plane Node)
ssh apollo@styx "sudo shutdown now"

# 2. Shut down Pluto (Compute Node)
ssh apollo@pluto "sudo shutdown now"

# 3. Shut down Hydra (Primary etcd bootstrap master - shut down LAST)
ssh apollo@hydra "sudo shutdown now"
```

Wait until all physical LEDs stop blinking and fans power down before disconnecting power and Ethernet cables.

---

## 4. Phase 2: Packing Checklist

- [ ] **Node 1 (`hydra`)**: Lenovo ThinkCentre M920q Tiny + 65W/90W power adapter.
- [ ] **Node 2 (`pluto`)**: Beelink EQR5 mini PC + power adapter.
- [ ] **Node 3 (`styx`)**: Lenovo ThinkPad T14 Gen 2 + 65W USB-C charger.
- [ ] **Switch**: 5-port or 8-port unmanaged Gigabit Ethernet switch + power adapter.
- [ ] **Patch Cables**: 4x Cat6 Ethernet patch cables (minimum 3 for nodes, 1 for WAN/VLAN uplink).
- [ ] **Operator Laptop**: MacBook / workstation with SSH keys and Tailscale enabled.

---

## 5. Phase 3: Arrival & Power-On Sequence

### Step 5.1: Physical Cabling
1. Connect `hydra`, `pluto`, and `styx` to ports 1, 2, and 3 on your Gigabit switch using Ethernet cables.
2. Connect port 4 (or uplink) of your switch to the friend's router port or wall jack designated for the VLAN.

### Step 5.2: Sequential Power-On
1. **Power on `hydra` first.**
   - Wait **2 full minutes** for the Linux kernel, NetworkManager DHCP, and embedded K3s `etcd` control plane to reach a healthy leader state.
2. **Power on `pluto` and `styx`.**
   - Both nodes will boot, acquire DHCP leases on the VLAN, connect to `https://hydra:6443`, and rejoin the HA cluster quorum.

---

## 6. Phase 4: Router Port Forwarding & DHCP Reservation

### Step 6.1: Identify Pluto's New Local IP
Connect your laptop to the network (or via Tailscale) and run:

```bash
ssh apollo@pluto "ip -br a show dev eno1"
```
*(Example output: `eno1 UP 192.168.10.45/24`)*.

### Step 6.2: Set DHCP Reservation
In your friend's router management dashboard:
1. Locate Pluto's MAC address in the DHCP client list.
2. Create a **Static DHCP Reservation** for Pluto so its IP remains fixed across reboots.

### Step 6.3: Configure Port Forwarding Matrix
Configure the following router port forwarding rules targeting **Pluto's local VLAN IP**:

| Game Server | Protocol | External Port | Internal Port | Target Host |
| :--- | :--- | :--- | :--- | :--- |
| **Minecraft Server** | TCP / UDP | `25565` | `25565` | Pluto's VLAN IP |
| **Simple Voice Chat** | UDP | `24454` | `24454` | Pluto's VLAN IP |
| **Team Fortress 2** | TCP / UDP | `27015` | `27015` | Pluto's VLAN IP |
| **TF2 SourceTV** | UDP | `27020` | `27020` | Pluto's VLAN IP |
| **Factorio Dedicated** | UDP | `34197` | `34197` | Pluto's VLAN IP |

*(Note: Joplin and Zotero use Cloudflare Tunnel and do **not** require any port forwarding).*

---

## 7. Phase 5: 60-Second On-Site Verification

Run these sanity checks from your laptop:

### 1. Check Node Status & Quorum
```bash
ssh apollo@pluto "sudo kubectl get nodes -o wide"
```
*Expected: All 3 nodes (`hydra`, `pluto`, `styx`) show `Ready` with their new VLAN internal IPs.*

### 2. Check Flannel Cross-Node Overlay
```bash
ssh apollo@pluto "bridge fdb show dev flannel.1 && ping -c 2 10.42.0.1"
```
*Expected: `0% packet loss` when pinging Hydra's Flannel gateway (`10.42.0.1`).*

### 3. Verify Cloudflare Dynamic DNS Updated
```bash
ssh apollo@pluto "sudo kubectl logs -n infrastructure -l app.kubernetes.io/name=cloudflare-ddns --tail=15"
```
*Expected: Log confirms `Detected the IPv4 address <friend-public-ip>` and `Updated A record for mc.apollan.cc`.*

### 4. Verify Cloudflare Ingress Tunnel
```bash
ssh apollo@pluto "sudo kubectl logs -n cloudflared -l app=cloudflared --tail=15"
```
*Expected: Registered active tunnel connections via QUIC protocol.*

### 5. Test Live Web Endpoints
Open these URLs in your mobile browser or laptop:
- **Zotero WebDAV**: `https://zotero.apollan.cc` (should show HTTP Basic Auth prompt or 401 Restricted).
- **Joplin Server**: `https://joplin.apollan.cc` (should open the Joplin web login UI).

---

## 8. Troubleshooting Network / Subnet Shifts

### Issue 1: Flannel Retains Stale IP from Previous Network
If `ping -c 2 10.42.0.1` times out after moving networks:

```bash
# Check if Flannel FDB has old IP cached:
ssh apollo@pluto "bridge fdb show dev flannel.1"

# On Hydra, force Flannel recreate:
ssh apollo@hydra "sudo ip link delete flannel.1 && sudo systemctl restart k3s"

# On Pluto, refresh Flannel interface:
ssh apollo@pluto "sudo ip link delete flannel.1 && sudo systemctl restart k3s"
```

### Issue 2: Node Still Has Ghost Secondary IP on Physical NIC
If an interface retains an old IP from the previous subnet:

```bash
# Check addresses:
ip -br a show dev eth0

# Delete stale address:
sudo ip addr del <old-ip>/24 dev eth0
```

### Issue 3: Joplin "Invalid Origin" Error
If Joplin shows `Invalid origin` in the browser, ensure the deployment's `APP_BASE_URL` is set to `https://joplin.apollan.cc` and rollout restarted:

```bash
ssh apollo@pluto "sudo kubectl rollout restart deployment/joplin-server -n productivity"
```
