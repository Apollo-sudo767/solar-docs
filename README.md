# Solar Docs ☀️📖

Documentation portal for the **Solar** dendritic NixOS & macOS fleet orchestration flake.

Built with [VitePress](https://vitepress.dev/).

---

## 🚀 Local Development

### Prerequisites
- Node.js 20+ (or run `nix develop`)
- npm

### Quickstart

```bash
# Enter development shell (if using Nix)
nix develop

# Install dependencies
npm install

# Start local dev server
npm run docs:dev

# Build for production
npm run docs:build

# Preview production build
npm run docs:preview
```

---

## 🌐 Deployment

Documentation is automatically built and published to GitHub Pages via GitHub Actions on every push to the `main` branch.
