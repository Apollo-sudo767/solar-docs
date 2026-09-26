# 🔐 Pluto Cluster: Secrets Provisioning & Encryption Guide

This guide provides step-by-step instructions for obtaining, creating, and encrypting all secrets required by the **Pluto Cluster** and its workloads.

> [!IMPORTANT]
> **Zero plaintext secrets or secret manifests are stored in the `pluto-cluster` repository.**
> All credentials are encrypted with Age using [`agenix-rekey`](https://github.com/oddlama/agenix-rekey) in my private [`solar-secrets`](https://github.com/Apollo-sudo767/solar-secrets) repository, and synced automatically into Kubernetes namespaces on boot by NixOS via `k3s-secrets-sync.service`.

---

## 📑 Table of Contents
1. [Required Secrets Overview](#1-required-secrets-overview)
2. [Secret 1: K3s Cluster Token (`k3s-token.age`)](#2-secret-1-k3s-cluster-token-k3s-tokenage)
3. [Secret 2: Playit.gg Secret Key (`playit-secret.age`)](#3-secret-2-playitgg-secret-key-playit-secretage)
4. [Secret 3: Surfshark WireGuard VPN (`surfshark-vpn.age`)](#4-secret-3-surfshark-wireguard-vpn-surfshark-vpnage)
5. [Secret 4: Cloudflare Tunnel Credentials (`cloudflared-credentials.age`)](#5-secret-4-cloudflare-tunnel-credentials-cloudflared-credentialsage)
6. [Secret 5: Joplin Database Credentials (`joplin-secret.age`)](#6-secret-5-joplin-database-credentials-joplin-secretage)
7. [Machine Public Keys (`hosts/<hostname>.pub`)](#7-machine-public-keys-hostshostnamepub)
8. [Rekeying & Deploying All Secrets](#8-rekeying--deploying-all-secrets)
9. [How to Decrypt and Verify Secrets](#9-how-to-decrypt-and-verify-secrets)

---

## 1. Required Secrets Overview

| Secret File in `solar-secrets` | Target Kubernetes Secret | Namespace | Consuming Workload |
| :--- | :--- | :--- | :--- |
| `secrets/k3s-token.age` | Node join token (NixOS level) | N/A | `pluto`, `styx`, `hydra` (Control Plane) |
| `secrets/playit-secret.age` | `playit-secret` | `games` | Paper / Modpack Minecraft (`playit-agent` sidecar) |
| `secrets/surfshark-vpn.age` | `surfshark-vpn-secret` | `media` | `qbittorrent` (`gluetun` VPN sidecar) |
| `secrets/cloudflared-credentials.age` | `cloudflared-credentials` | `cloudflared` | Cloudflare Ingress Tunnel (`cloudflared`) |
| `secrets/joplin-secret.age` | `joplin-secret` | `productivity` | Joplin Server & PostgreSQL (`POSTGRES_PASSWORD`) |
| `secrets/cluster-passwd.age` | `/run/agenix/password-apollo.age` (NixOS level) | N/A | Dedicated login password for `pluto`, `styx`, `hydra` |
| `secrets/cloudflare-ddns-token.age` | `cloudflare-ddns-secret` | `infrastructure` | Cloudflare Dynamic DNS (`favonia/cloudflare-ddns`) |

---

## 2. Secret 1: K3s Cluster Token (`k3s-token.age`)

Used by Pluto, Styx, and Hydra to authenticate and join the high-availability etcd control plane.

- **Where to get it**: Generate it yourself on your workstation.
- **How to get it**: Generate a secure 32-byte random hex string.
- **Command to encrypt**:
  ```bash
  openssl rand -hex 32 | nix shell nixpkgs#age nixpkgs#age-plugin-yubikey -c age \
    -R ~/src/solar-secrets/master/apollo_user.pub \
    -R ~/src/solar-secrets/master/yubikey.pub \
    -o ~/src/solar-secrets/secrets/k3s-token.age
  ```

---

## 3. Secret 2: Playit.gg Secret Key (`playit-secret.age`)

Used by the Minecraft pod sidecar so friends can connect to your server without port forwarding.

- **Where to get it**: [playit.gg](https://playit.gg)
- **Step 1**: Run this command to generate your claim code:
  ```bash
  curl -sL https://github.com/playit-cloud/playit-agent/releases/download/v1.0.10/playit-cli-linux-amd64 -o /tmp/playit && chmod +x /tmp/playit
  CODE=$(/tmp/playit claim generate)
  echo "👉 Open: https://playit.gg/claim/$CODE"
  ```
- **Step 2**: Open that URL in your browser and click **"Claim agent"**.
- **Step 3**: Exchange the code for your secret key and encrypt:
  ```bash
  SECRET_KEY=$(/tmp/playit claim exchange $CODE)

  echo -n "$SECRET_KEY" | nix shell nixpkgs#age nixpkgs#age-plugin-yubikey -c age \
    -R ~/src/solar-secrets/master/apollo_user.pub \
    -R ~/src/solar-secrets/master/yubikey.pub \
    -o ~/src/solar-secrets/secrets/playit-secret.age

  rm -f /tmp/playit
  ```

---

## 4. Secret 3: Surfshark WireGuard VPN (`surfshark-vpn.age`)

Used by Gluetun to route 100% of torrent traffic from qBittorrent through an encrypted VPN tunnel with an automatic kill switch.

- **Where to get it**: [my.surfshark.com](https://my.surfshark.com) ➔ **VPN** ➔ **Manual setup** ➔ **WireGuard**.
- **Command to encrypt**:
  ```bash
  cat << 'EOF' > /tmp/surfshark.env
  WIREGUARD_PRIVATE_KEY=PASTE_YOUR_PRIVATE_KEY_HERE
  WIREGUARD_ADDRESSES=10.14.0.2/16
  EOF

  nix shell nixpkgs#age nixpkgs#age-plugin-yubikey -c age \
    -R ~/src/solar-secrets/master/apollo_user.pub \
    -R ~/src/solar-secrets/master/yubikey.pub \
    -o ~/src/solar-secrets/secrets/surfshark-vpn.age \
    /tmp/surfshark.env

  rm -f /tmp/surfshark.env
  ```

---

## 5. Secret 4: Cloudflare Tunnel Credentials (`cloudflared-credentials.age`)

Used by Cloudflare to route secure inbound HTTPS traffic to Joplin, Zotero, and Home Assistant.

- **Where to get it**: Cloudflare Zero Trust CLI.
- **Command to create and encrypt**:
  ```bash
  nix shell nixpkgs#cloudflared -c cloudflared tunnel login
  nix shell nixpkgs#cloudflared -c cloudflared tunnel create pluto-cluster

  nix shell nixpkgs#age nixpkgs#age-plugin-yubikey -c age \
    -R ~/src/solar-secrets/master/apollo_user.pub \
    -R ~/src/solar-secrets/master/yubikey.pub \
    -o ~/src/solar-secrets/secrets/cloudflared-credentials.age \
    ~/.cloudflared/<TUNNEL_ID>.json
  ```

---

## 6. Secret 5: Joplin Database Credentials (`joplin-secret.age`)

Used by Joplin Server and PostgreSQL in the `productivity` namespace.

- **Command to encrypt**:
  ```bash
  cat << 'EOF' > /tmp/joplin.env
  POSTGRES_PASSWORD=YOUR_SECURE_PASSWORD_HERE
  EOF

  nix shell nixpkgs#age nixpkgs#age-plugin-yubikey -c age \
    -R ~/src/solar-secrets/master/apollo_user.pub \
    -R ~/src/solar-secrets/master/yubikey.pub \
    -o ~/src/solar-secrets/secrets/joplin-secret.age \
    /tmp/joplin.env

  rm -f /tmp/joplin.env
  ```

---

## 7. Machine Public Keys (`hosts/<hostname>.pub`)

Extract public keys from each machine:
```bash
ssh-to-age < /persist/etc/ssh/ssh_host_ed25519_key.pub
```
Save the resulting keys into:
- `~/src/solar-secrets/hosts/pluto.pub`
- `~/src/solar-secrets/hosts/styx.pub`
- `~/src/solar-secrets/hosts/hydra.pub`
- `~/src/solar-secrets/hosts/sol.pub`

---

## 8. Rekeying & Deploying All Secrets

```bash
# 1. Commit in solar-secrets:
cd ~/src/solar-secrets
git add secrets/ hosts/
git commit -m "feat(secrets): update pluto cluster secrets"

# 2. Rekey in solar:
cd ~/src/solar
s-rekey

# 3. Commit and push:
git add rekeyed/
git commit -m "chore(secrets): rekey all secrets for pluto cluster"
git push origin main
```

---

## 9. How to Decrypt and Verify Secrets

### Decrypt with YubiKey:
```bash
nix shell nixpkgs#age nixpkgs#age-plugin-yubikey -c age \
  -d -i ~/src/solar-secrets/master/yubikey_slot2.id.pub \
  ~/src/solar-secrets/secrets/<secret-name>.age
```

### View/Edit with Built-in Alias:
```bash
cd ~/src/solar
s-edit
```
