# Universal Cheatsheet ⚡

Quick reference for day-to-day operations, flake management, and system recovery in Solar.

______________________________________________________________________

## 🚀 Rebuild & Maintenance Aliases

Solar includes native shell aliases powered by `nh`:

| Alias | Command | Purpose |
| :--- | :--- | :--- |
| `nrs` | `nh os switch --no-nom` | Build and activate system configuration immediately |
| `nrb` | `nh os boot --no-nom` | Build configuration and register for next boot without switching |
| `drs` | `nh darwin switch --no-nom` | Build and activate macOS Darwin configuration |
| `nfu` | `nix flake update` | Update all flake lock input dependencies |
| `nfc` | `nix flake check` | Evaluate and check flake outputs and assertions |
| `nc` | `nh clean all` | Prune old generations, keeping last 5 within 7 days |
| `nco` | `nh clean all --keep 3 && nix-store --optimise` | Deep store clean and hardlink deduplication |

______________________________________________________________________

## 🔐 Secrets & Agenix Operations

| Operation | Command | Description |
| :--- | :--- | :--- |
| **Seed Keyring** | `solar-seed` (or `seed`) | Decrypt Age master key into RAM keyring |
| **Unseed Keyring**| `solar-unseed` (or `unseed`) | Purge Age master key from RAM |
| **Edit Secret (fzf)** | `s-edit` | Interactive menu to decrypt, edit, and re-encrypt with master identity |
| **Rekey Secrets (Fast)** | `s-rekey` | Run `agenix-rekey` across all hosts and update `rekeyed/` |
| **Edit Secret (Direct)** | `agenix -e secrets/<name>.age` | Decrypts specific file, opens in `$EDITOR`, re-encrypts |
| **Rekey Secrets (Direct)** | `agenix -r` | Rekey all secrets for all declared host public keys |
| **Inspect Secret**| `cat /run/agenix/<name>` | View live decrypted secret in RAM |

______________________________________________________________________

## 🪐 Pluto Cluster & K3s GitOps

```bash
# Set cluster admin credentials (on pluto, hydra, or styx)
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

# Check cluster nodes, roles, and IP routing
kubectl get nodes -o wide

# Check multi-tier storage provisioners and persistent claims
kubectl get storageclass
kubectl get pvc -A

# Check Flux GitOps synchronization status
flux get kustomizations
flux get sources git

# Force instant GitOps reconciliation from Git
flux reconcile kustomization apps --with-source
flux reconcile kustomization infrastructure --with-source

# Tail application logs
kubectl logs -n games -l app=minecraft -c minecraft-server -f
kubectl logs -n productivity -l app=joplin -f
```

______________________________________________________________________

## 🌐 Network & Tailscale Diagnostics

```bash
# Check tailnet status and ping mesh nodes
tailscale status
tailscale ping <hostname>

# Force SSH key-only reauthentication
sudo tailscale up --ssh --operator=apollo

# Flush DNS caches
resolvectl flush-caches
sudo systemctl restart systemd-resolved
```

______________________________________________________________________

## 💾 Storage & Btrfs Health

```bash
# Check filesystem space & allocation
sudo btrfs filesystem usage /

# Trigger manual maintenance scrub
sudo btrfs scrub start /
sudo btrfs scrub status /

# Check ZFS storage pool health (on Sol)
zpool status -v
zfs list
```
