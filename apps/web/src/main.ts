import { createApp } from 'vue'
import App from './App.vue'
import { WebAppConfig } from './constants'
import './styles.css'

createApp(App).mount(WebAppConfig.mountSelector)
