<script setup lang="ts">
import { ref, computed } from 'vue'
import rawToggles from '../../public/toggles.json'

interface ToggleOption {
  path: string
  type: string
  default: string
  description: string
  section: string
}

const toggles: ToggleOption[] = rawToggles as ToggleOption[]

const searchQuery = ref('')
const selectedCategory = ref('All')
const copiedIndex = ref<number | null>(null)
const activeTab = ref<'solar' | 'nixpkgs' | 'nixos-options'>('solar')

const categories = [
  'All',
  'Suites',
  'Core',
  'Desktops',
  'Hardware',
  'Programs',
  'Services',
  'Darwin'
]

const filteredOptions = computed(() => {
  const query = searchQuery.value.toLowerCase().trim()
  return toggles.filter(opt => {
    // Category filter
    if (selectedCategory.value !== 'All') {
      const catLower = selectedCategory.value.toLowerCase()
      if (!opt.path.toLowerCase().includes(`myfeatures.${catLower}`) &&
          !opt.section.toLowerCase().includes(catLower)) {
        return false
      }
    }

    if (!query) return true

    // Text query filter
    return (
      opt.path.toLowerCase().includes(query) ||
      opt.description.toLowerCase().includes(query) ||
      opt.section.toLowerCase().includes(query) ||
      opt.type.toLowerCase().includes(query)
    )
  })
})

function copyNixCode(opt: ToggleOption, index: number) {
  let snippet = `${opt.path} = ${opt.default};`
  if (opt.type === 'bool' && opt.default === 'false') {
    snippet = `${opt.path} = true;`
  }
  navigator.clipboard.writeText(snippet)
  copiedIndex.value = index
  setTimeout(() => {
    if (copiedIndex.value === index) {
      copiedIndex.value = null
    }
  }, 2000)
}

const nixpkgsSearchUrl = computed(() => {
  const q = encodeURIComponent(searchQuery.value.trim())
  return `https://search.nixos.org/packages?channel=unstable&from=0&size=50&sort=relevance&type=packages&query=${q}`
})

const nixosOptionsSearchUrl = computed(() => {
  const q = encodeURIComponent(searchQuery.value.trim())
  return `https://search.nixos.org/options?channel=unstable&from=0&size=50&sort=relevance&type=packages&query=${q}`
})
</script>

<template>
  <div class="nix-search-container">
    <!-- Mode Switcher Tabs -->
    <div class="search-tabs">
      <button
        :class="['tab-btn', { active: activeTab === 'solar' }]"
        @click="activeTab = 'solar'"
      >
        ☀️ Solar Flake Options ({{ toggles.length }})
      </button>
      <button
        :class="['tab-btn', { active: activeTab === 'nixpkgs' }]"
        @click="activeTab = 'nixpkgs'"
      >
        📦 Nixpkgs Packages
      </button>
      <button
        :class="['tab-btn', { active: activeTab === 'nixos-options' }]"
        @click="activeTab = 'nixos-options'"
      >
        ❄️ NixOS Upstream Options
      </button>
    </div>

    <!-- Main Search Bar -->
    <div class="search-box-wrapper">
      <span class="search-icon">🔍</span>
      <input
        v-model="searchQuery"
        type="text"
        class="search-input"
        placeholder="Search options (e.g. joplin, hyprland, tailscale, disko)..."
        autofocus
      />
      <button
        v-if="searchQuery"
        class="clear-btn"
        @click="searchQuery = ''"
        title="Clear search"
      >
        ✕
      </button>
    </div>

    <!-- External Search Redirect View -->
    <div v-if="activeTab !== 'solar'" class="external-search-card">
      <div v-if="activeTab === 'nixpkgs'">
        <h3>Search Nixpkgs Packages on search.nixos.org</h3>
        <p>Query the global nixpkgs database containing over 100,000+ packages for your Solar configurations.</p>
        <a
          :href="nixpkgsSearchUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="external-search-btn"
        >
          Open "{{ searchQuery || 'all' }}" in search.nixos.org ↗
        </a>
      </div>
      <div v-else-if="activeTab === 'nixos-options'">
        <h3>Search Upstream NixOS Options</h3>
        <p>Explore standard NixOS configuration options available across `services.*`, `programs.*`, and `networking.*`.</p>
        <a
          :href="nixosOptionsSearchUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="external-search-btn"
        >
          Search upstream NixOS options for "{{ searchQuery || 'all' }}" ↗
        </a>
      </div>
    </div>

    <!-- Solar Options View -->
    <div v-else>
      <!-- Category Filter Pills -->
      <div class="category-pills">
        <button
          v-for="cat in categories"
          :key="cat"
          :class="['pill-btn', { active: selectedCategory === cat }]"
          @click="selectedCategory = cat"
        >
          {{ cat }}
        </button>
      </div>

      <!-- Result Count -->
      <div class="results-header">
        <span>Found <strong>{{ filteredOptions.length }}</strong> matching options</span>
        <span v-if="searchQuery" class="filtered-text">matching "{{ searchQuery }}"</span>
      </div>

      <!-- Results List -->
      <div class="options-list">
        <div
          v-for="(opt, idx) in filteredOptions"
          :key="opt.path"
          class="option-card"
        >
          <div class="card-top">
            <code class="option-path">{{ opt.path }}</code>
            <div class="card-badges">
              <span class="badge badge-type">{{ opt.type }}</span>
              <span class="badge badge-default">default: {{ opt.default }}</span>
              <button
                class="copy-btn"
                @click="copyNixCode(opt, idx)"
                :title="copiedIndex === idx ? 'Copied!' : 'Copy Nix code'"
              >
                {{ copiedIndex === idx ? '✓ Copied' : '📋 Copy' }}
              </button>
            </div>
          </div>
          <p class="option-desc">{{ opt.description }}</p>
          <div class="card-footer">
            <span class="section-tag">{{ opt.section }}</span>
          </div>
        </div>

        <div v-if="filteredOptions.length === 0" class="no-results">
          <p>No Solar options found matching "<strong>{{ searchQuery }}</strong>".</p>
          <p class="tip">Try switching to the <strong>📦 Nixpkgs Packages</strong> tab above to check upstream packages.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nix-search-container {
  margin-top: 1.5rem;
  font-family: var(--vp-font-family-base);
}

.search-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.tab-btn {
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}

.tab-btn.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.search-box-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 1.25rem;
}

.search-icon {
  position: absolute;
  left: 1rem;
  font-size: 1.2rem;
  pointer-events: none;
  opacity: 0.6;
}

.search-input {
  width: 100%;
  padding: 0.85rem 3rem 0.85rem 3rem;
  font-size: 1.05rem;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-1);
  border: 1.5px solid var(--vp-c-divider);
  border-radius: 10px;
  outline: none;
  transition: border-color 0.2s ease;
}

.search-input:focus {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 2px var(--vp-c-brand-soft);
}

.clear-btn {
  position: absolute;
  right: 1rem;
  background: none;
  border: none;
  color: var(--vp-c-text-3);
  font-size: 1.1rem;
  cursor: pointer;
}

.clear-btn:hover {
  color: var(--vp-c-text-1);
}

.category-pills {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
}

.pill-btn {
  padding: 0.35rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.82rem;
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-2);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pill-btn:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.pill-btn.active {
  background: var(--vp-c-brand-1);
  color: #ffffff;
  font-weight: 600;
}

.results-header {
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  margin-bottom: 0.75rem;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.option-card {
  padding: 1rem 1.2rem;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  transition: transform 0.1s ease, border-color 0.2s ease;
}

.option-card:hover {
  border-color: var(--vp-c-brand-soft);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.option-path {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-mute);
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  word-break: break-all;
}

.card-badges {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.badge {
  font-size: 0.75rem;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
}

.badge-type {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

.badge-default {
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-divider);
}

.copy-btn {
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
  color: var(--vp-c-text-1);
  transition: all 0.15s ease;
}

.copy-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.option-desc {
  font-size: 0.9rem;
  color: var(--vp-c-text-1);
  margin: 0.4rem 0 0.6rem 0;
  line-height: 1.45;
}

.card-footer {
  display: flex;
  align-items: center;
}

.section-tag {
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.external-search-card {
  padding: 2rem;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  text-align: center;
  margin-top: 1rem;
}

.external-search-card h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
  font-size: 1.25rem;
}

.external-search-card p {
  color: var(--vp-c-text-2);
  margin-bottom: 1.5rem;
}

.external-search-btn {
  display: inline-block;
  padding: 0.75rem 1.5rem;
  border-radius: 8px;
  background: var(--vp-c-brand-1);
  color: #ffffff;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.2s ease;
}

.external-search-btn:hover {
  background: var(--vp-c-brand-2);
}

.no-results {
  padding: 3rem 1rem;
  text-align: center;
  color: var(--vp-c-text-2);
}

.no-results .tip {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
}
</style>
