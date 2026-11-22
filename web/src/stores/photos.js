import { defineStore } from 'pinia'
import { ref } from 'vue'

const PAGE = 60
const YEAR = new Date().getFullYear()
const DEFAULT_FROM = `${YEAR}-01-01`
const DEFAULT_TO = `${YEAR}-12-31`

export const usePhotosStore = defineStore('photos', () => {
  const groups = ref([])
  const photos = ref([])
  const total = ref(0)
  const loading = ref(false)
  const rating = ref(0)
  const selectedTags = ref([])
  const from = ref(DEFAULT_FROM)
  const to = ref(DEFAULT_TO)
  const q = ref('')
  let seq = 0

  // Mit Suchbegriff gilt die Suche für alle Jahre, ohne Begriff der eingestellte Zeitraum.
  function addRange(p) {
    if (q.value.trim()) {
      p.set('q', q.value.trim())
      return
    }
    if (from.value) p.set('from', from.value)
    if (to.value) p.set('to', to.value)
  }

  async function loadTags() {
    const p = new URLSearchParams()
    if (rating.value) p.set('rating', rating.value)
    if (selectedTags.value.length) p.set('tags', selectedTags.value.join(','))
    addRange(p)
    const r = await fetch('/api/tags?' + p)
    groups.value = await r.json()
  }

  function buildQuery(offset) {
    const p = new URLSearchParams({ limit: PAGE, offset })
    if (rating.value) p.set('rating', rating.value)
    if (selectedTags.value.length) p.set('tags', selectedTags.value.join(','))
    addRange(p)
    return p
  }

  async function load(reset = true) {
    if (reset) loadTags()
    const my = ++seq
    loading.value = true
    const offset = reset ? 0 : photos.value.length
    const r = await fetch('/api/photos?' + buildQuery(offset))
    const data = await r.json()
    if (my !== seq) return
    photos.value = reset ? data.photos : [...photos.value, ...data.photos]
    total.value = data.total
    loading.value = false
  }

  function setRating(n) {
    rating.value = n
    load()
  }

  function toggleTag(id) {
    const i = selectedTags.value.indexOf(id)
    if (i >= 0) selectedTags.value.splice(i, 1)
    else selectedTags.value.push(id)
    load()
  }

  function setQuery(v) {
    q.value = v
    load()
  }

  function reset() {
    rating.value = 0
    selectedTags.value = []
    from.value = DEFAULT_FROM
    to.value = DEFAULT_TO
    q.value = ''
    load()
  }

  function clearTags(ids) {
    selectedTags.value = selectedTags.value.filter((id) => !ids.includes(id))
    load()
  }

  function allYears() {
    from.value = ''
    to.value = ''
    load()
  }

  return {
    groups,
    photos,
    total,
    loading,
    rating,
    selectedTags,
    from,
    to,
    q,
    setQuery,
    loadTags,
    load,
    setRating,
    toggleTag,
    reset,
    allYears,
    clearTags,
  }
})
