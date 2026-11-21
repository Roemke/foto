import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useAuth = defineStore('auth', () => {
  const user = ref(null)
  const loaded = ref(false)
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function load() {
    try {
      const r = await fetch('/api/auth/me')
      user.value = r.ok ? await r.json() : null
    } catch {
      user.value = null
    }
    loaded.value = true
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  return { user, loaded, isAdmin, load, logout }
})
