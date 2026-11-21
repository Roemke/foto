<script setup>
import { onMounted, ref } from 'vue'

const items = ref([])
const selected = ref(new Set())
const msg = ref('')
const busy = ref(false)

async function load() {
  const r = await fetch('/api/trash')
  items.value = await r.json()
  selected.value = new Set()
}
onMounted(load)

function toggle(id) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}
const selectAll = () => (selected.value = new Set(items.value.map((i) => i.id)))
const base = (p) => p.slice(p.lastIndexOf('/') + 1)
const folder = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

async function post(url, body) {
  busy.value = true
  msg.value = ''
  const r = await fetch('/api/trash' + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  busy.value = false
  if (!r.ok) {
    msg.value = j.error || 'Fehler'
    return null
  }
  return j
}
const failText = (j) => (j.failed.length ? `, ${j.failed.length} Fehler: ${j.failed[0].error}` : '')

async function restore() {
  const ids = [...selected.value]
  if (!ids.length) return
  const j = await post('/restore', { ids })
  if (j) {
    await load()
    msg.value = `${j.restored} wiederhergestellt${failText(j)}`
  }
}
async function purge() {
  const ids = [...selected.value]
  if (!ids.length) return
  if (!confirm(`${ids.length} Foto(s) endgültig löschen? Das lässt sich nicht rückgängig machen.`))
    return
  const j = await post('/purge', { ids })
  if (j) {
    await load()
    msg.value = `${j.purged} endgültig gelöscht${failText(j)}`
  }
}
async function emptyAll() {
  if (!items.value.length) return
  if (!confirm('Den gesamten Papierkorb endgültig leeren? Das lässt sich nicht rückgängig machen.'))
    return
  const j = await post('/purge', { all: true })
  if (j) {
    await load()
    msg.value = `${j.purged} endgültig gelöscht${failText(j)}`
  }
}
</script>

<template>
  <main class="tr">
    <h1>Papierkorb</h1>
    <div class="bar">
      <strong>{{ selected.size }} ausgewählt</strong>
      <button :disabled="!items.length" @click="selectAll">Alle auswählen</button>
      <button :disabled="!selected.size || busy" @click="restore">Wiederherstellen</button>
      <button class="danger" :disabled="!selected.size || busy" @click="purge">
        Endgültig löschen
      </button>
      <button class="danger" :disabled="!items.length || busy" @click="emptyAll">
        Papierkorb leeren
      </button>
    </div>
    <p v-if="msg" class="msg">{{ msg }}</p>
    <p v-if="!items.length" class="empty">Der Papierkorb ist leer.</p>
    <div class="grid">
      <figure
        v-for="i in items"
        :key="i.id"
        :class="{ selected: selected.has(i.id) }"
        @click="toggle(i.id)"
      >
        <img :src="`/api/trash/${i.id}/thumb`" loading="lazy" :alt="base(i.orig_rel_path)" />
        <figcaption>
          <strong>{{ base(i.orig_rel_path) }}</strong>
          <small>{{ folder(i.orig_rel_path) }}</small>
          <small>gelöscht am {{ i.trashed_at.slice(0, 10) }}</small>
        </figcaption>
      </figure>
    </div>
  </main>
</template>

<style scoped>
.tr {
  max-width: 1100px;
  margin: 1.5rem auto;
  padding: 0 1rem;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 0.6rem 0;
}
button {
  border: none;
  background: #eef0f4;
  border-radius: 999px;
  padding: 0.3rem 0.9rem;
  font-size: 0.85rem;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: #e0e5ee;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.danger {
  color: #9b1c10;
}
.msg {
  background: #eef3fc;
  border-radius: 10px;
  padding: 0.5rem 0.9rem;
}
.empty {
  color: #6b7280;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.6rem;
}
figure {
  margin: 0;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
figure.selected {
  outline: 3px solid var(--accent);
}
figure img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  display: block;
  background: #ddd;
}
figcaption {
  display: flex;
  flex-direction: column;
  padding: 0.4rem 0.6rem;
  font-size: 0.8rem;
  word-break: break-word;
}
figcaption small {
  color: #6b7280;
}
</style>
