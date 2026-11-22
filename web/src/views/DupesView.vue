<script setup>
import { ref, computed, onMounted } from 'vue'

const groups = ref([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const busy = ref(null)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/duplicates?limit=20')
    if (!res.ok) throw new Error('Fehler ' + res.status)
    const data = await res.json()
    groups.value = data.groups
    total.value = data.total
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function trash(p) {
  busy.value = p.id
  error.value = ''
  try {
    const res = await fetch('/api/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [p.id] }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Fehler ' + res.status)
    if (data.failed?.length) throw new Error(data.failed[0].error)
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = null
  }
}

const mb = (n) => (Number(n) / 1048576).toFixed(1) + ' MB'
const day = (d) => (d ? new Date(d).toLocaleDateString('de-DE') : '–')

const summary = computed(() => {
  const n = total.value
  const head = n === 1 ? 'Eine Gruppe' : `${n} Gruppen`
  const part = n > groups.value.length ? ` (angezeigt: die ersten ${groups.value.length})` : ''
  return `${head} mit identischen Dateien${part}. Gelöschte Fotos landen im Papierkorb, die letzte Datei einer Gruppe bleibt erhalten.`
})

onMounted(load)
</script>

<template>
  <h1>Dubletten</h1>
  <p v-if="error" class="err">{{ error }}</p>
  <p v-if="!loading && !total">Keine Dubletten gefunden.</p>
  <p v-else-if="total">{{ summary }}</p>
  <section v-for="g in groups" :key="g.key" class="grp">
    <div v-for="p in g.photos" :key="p.id" class="card">
      <img :src="`/api/photos/${p.id}/thumb?size=400`" loading="lazy" :alt="p.rel_path" />
      <div class="path">{{ p.rel_path }}</div>
      <div class="meta">
        {{ p.width }}×{{ p.height }} · {{ mb(p.file_size) }} · {{ day(p.taken_at) }}
      </div>
      <div class="meta">Bewertung: {{ p.rating ?? '–' }}</div>
      <div class="meta">Tags: {{ p.tags.length ? p.tags.join(', ') : '–' }}</div>
      <button :disabled="busy !== null" @click="trash(p)">In den Papierkorb</button>
    </div>
  </section>
</template>

<style scoped>
.grp {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  padding: 0.8rem;
  margin-bottom: 1rem;
  border: 1px solid #ccc;
  border-radius: 6px;
}
.card {
  width: 260px;
}
.card img {
  width: 100%;
  height: 200px;
  object-fit: contain;
  background: #f0f0f0;
}
.path {
  font-size: 0.8rem;
  word-break: break-all;
  margin: 0.3rem 0;
}
.meta {
  font-size: 0.85rem;
}
.err {
  color: #b00020;
}
</style>
