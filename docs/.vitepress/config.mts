import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "Solar",
  description: "Dendritic Flake & Fleet Orchestration for NixOS and macOS",
  base: "/solar/",
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', href: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>☀️</text></svg>' }]
  ],

  themeConfig: {
    siteTitle: "☀️ Solar",
    logo: undefined,

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Fleet & Clusters', link: '/fleet/' },
      { text: 'Architecture', link: '/guide/architecture' },
      { text: 'Storage & Security', link: '/guide/storage-security' },
      { text: 'Cheatsheet', link: '/reference/cheatsheet' },
      { text: 'Toggles', link: '/reference/toggles' },
      { text: '🔍 Nix Search', link: '/reference/search' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guides & Architecture',
          items: [
            { text: 'Getting Started & Install', link: '/guide/getting-started' },
            { text: 'Dendritic Architecture', link: '/guide/architecture' },
            { text: 'How Modules Work', link: '/guide/modules' },
            { text: 'Storage, Disko & Security', link: '/guide/storage-security' },
            { text: 'Forking & Maintenance', link: '/guide/forking' },
          ]
        },
        {
          text: 'Fleet & Operations',
          items: [
            { text: 'Fleet Catalog', link: '/fleet/' },
            { text: 'Pluto HA Cluster', link: '/fleet/pluto-cluster' },
            { text: 'Universal Cheatsheet', link: '/reference/cheatsheet' },
          ]
        }
      ],
      '/fleet/': [
        {
          text: 'The Fleet',
          items: [
            { text: 'Fleet Overview & Matrix', link: '/fleet/' },
          ]
        },
        {
          text: 'Pluto HA Cluster',
          items: [
            { text: 'Cluster Architecture', link: '/fleet/pluto-cluster' },
            { text: 'Setup & Operations Guide', link: '/fleet/pluto-cluster/setup' },
            { text: 'Secrets & Security Guide', link: '/fleet/pluto-cluster/secrets' },
            { text: 'Workload Migration Runbook', link: '/fleet/pluto-cluster/migration' },
            { text: 'Venus ➔ Pluto Transfer Guide', link: '/fleet/pluto-cluster/transfer' },
          ]
        },
        {
          text: 'Related Guides',
          items: [
            { text: 'Storage & Disko', link: '/guide/storage-security' },
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Forking & Maintenance', link: '/guide/forking' },
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Reference & Operations',
          items: [
            { text: '🔍 Nix & Flake Search', link: '/reference/search' },
            { text: 'Universal Cheatsheet', link: '/reference/cheatsheet' },
            { text: 'Universal Keybindings', link: '/reference/keybindings' },
            { text: 'Troubleshooting & Diagnostics', link: '/reference/troubleshooting' },
            { text: 'Definitive Toggle Reference', link: '/reference/toggles' },
            { text: 'Frequently Asked Questions', link: '/reference/faq' },
          ]
        }
      ]
    },

    search: {
      provider: 'local'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Apollo-sudo767/solar' }
    ],

    editLink: {
      pattern: 'https://github.com/Apollo-sudo767/solar/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },

    footer: {
      message: 'Released under MIT. Designed for NixOS and macOS.',
      copyright: 'Copyright © 2026 Apollo-sudo767'
    }
  }
})
