import DefaultTheme from 'vitepress/theme'
import './custom.css'
import NixSearch from './NixSearch.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }: { app: any }) {
    app.component('NixSearch', NixSearch)
  }
}
