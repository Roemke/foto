<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import RatePhotos from '@/components/RatePhotos.vue'

const props = defineProps({ photos: { type: Array, required: true } })
const emit = defineEmits(['close', 'saved'])

const tab = ref('stars')
const groups = ref([])
const counts = ref(new Map())
const openIds = ref(new Set())
const legacyShown = ref(new Set())
const date = ref('')
const photographer = ref('')
const status = ref('')
const statusErr = ref(false)
const n = computed(() => props.photos.length)
const ids = computed(() => props.photos.map((p) => p.id))
const visibleGroups = computed(() =>
  groups.value
    .map((g) => ({ ...g, tags: g.tags.filter((t) => !t.legacy || legacyShown.value.has(t.id)) }))
    .filter((g) => g.tags.length),
)

const cnt = (t) => counts.value.get(t.id) ?? 0
function mode(t) {
  const c = cnt(t)
  if (c === 0) return 'none'
  return c === n.value ? 'all' : 'some'
}
const label = (t) => (mode(t) === 'some' ? `${t.name} (${cnt(t)}/${n.value})` : t.name)
function setCount(t, c) {
  const next = new Map(counts.value)
  next.set(t.id, c)
  counts.value = next
}

// Speichern nacheinander, nie gleichzeitig (exiftool schreibt dieselben Dateien)
let queue = Promise.resolve()
function save(body, undo, payload = {}) {
  queue = queue.then(async () => {
    try {
      const r = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids.value, ...body }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Fehler beim Speichern')
      statusErr.value = !!j.fileErrors?.length
      status.value = j.fileErrors?.length
        ? 'Datenbank gespeichert, Datei nicht beschreibbar: ' + j.fileErrors[0].message
        : 'Gespeichert'
      emit('saved', { ids: ids.value, adds: [], removes: [], ...payload })
    } catch (e) {
      undo?.()
      statusErr.value = true
      status.value = 'Fehler: ' + (e.message || 'Verbindung fehlgeschlagen')
    }
  })
}

function toggleTag(g, t) {
  const old = cnt(t)
  const on = mode(t) === 'all'
  const tag = { id: t.id, group: g.name, name: t.name }
  setCount(t, on ? 0 : n.value)
  save(
    { [on ? 'removeTags' : 'addTags']: [t.id] },
    () => setCount(t, old),
    on ? { removes: [tag] } : { adds: [tag] },
  )
}
function saveDate() {
  if (date.value) save({ date: date.value }, null, { date: date.value })
}
function savePhotographer() {
  const v = photographer.value.trim()
  if (v) save({ photographer: v })
}
function removePhotographer() {
  photographer.value = ''
  save({ photographer: null })
}
function onRated(e) {
  emit('saved', { ids: [e.id], rating: e.rating, adds: [], removes: [] })
}
function onToggle(id, e) {
  const next = new Set(openIds.value)
  if (e.target.open) next.add(id)
  else next.delete(id)
  openIds.value = next
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
onMounted(async () => {
  window.addEventListener('keydown', onKey)
  try {
    const r = await fetch('/api/tags')
    groups.value = await r.json()
  } catch {
    status.value = 'Tags konnten nicht geladen werden'
    statusErr.value = true
    return
  }
  const c = new Map()
  const open = new Set()
  const leg = new Set()
  for (const g of groups.value) {
    for (const t of g.tags) {
      const k = props.photos.filter((p) =>
        (p.tags ?? []).some((x) => x.group === g.name && x.name === t.name),
      ).length
      if (k) {
        c.set(t.id, k)
        open.add(g.id)
        if (t.legacy) leg.add(t.id)
      }
    }
  }
  counts.value = c
  openIds.value = open
  legacyShown.value = leg
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="bk" @click.self="emit('close')">
    <div class="box">
      <header>
        <h2>{{ n }} {{ n === 1 ? 'Foto' : 'Fotos' }} bearbeiten</h2>
        <button class="x" @click="emit('close')">✕</button>
      </header>
      <nav class="tabs">
        <button :class="{ on: tab === 'stars' }" @click="tab = 'stars'">Sterne (einzeln)</button>
        <button :class="{ on: tab === 'tags' }" @click="tab = 'tags'">
          Tags &amp; Datum (alle)
        </button>
      </nav>

      <RatePhotos v-if="tab === 'stars'" :photos="photos" @rated="onRated" />

      <div v-else class="pane">
        <h3>Aufnahmedatum <small>(für alle Fotos, speichert beim Verlassen des Felds)</small></h3>
        <input v-model="date" type="date" @change="saveDate" />
        <h3>Fotograf <small>(für alle Fotos, speichert beim Verlassen des Felds)</small></h3>
        <div class="row">
          <input v-model="photographer" placeholder="Name" @change="savePhotographer" />
          <button type="button" @click="removePhotographer">Fotograf entfernen</button>
        </div>
        <h3>
          Tags <small>(ein Klick setzt oder entfernt sofort, „2/5“ = nur ein Teil der Fotos)</small>
        </h3>
        <details
          v-for="g in visibleGroups"
          :key="g.id"
          :open="openIds.has(g.id)"
          @toggle="onToggle(g.id, $event)"
        >
          <summary>{{ g.name }}</summary>
          <div class="row">
            <button
              v-for="t in g.tags"
              :key="t.id"
              type="button"
              :class="{ on: mode(t) === 'all', some: mode(t) === 'some' }"
              @click="toggleTag(g, t)"
            >
              {{ label(t) }}
            </button>
          </div>
        </details>
        <p class="status" :class="{ err: statusErr }">{{ status }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bk {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.box {
  background: #fff;
  color: #1f2937;
  width: min(900px, 96vw);
  max-height: 92vh;
  overflow-y: auto;
  border-radius: 14px;
  padding: 1rem 1.2rem;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h2 {
  margin: 0;
  font-size: 1.2rem;
}
.x {
  border: none;
  background: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: #6b7280;
}
.tabs {
  display: flex;
  gap: 0.3rem;
  margin: 0.8rem 0;
}
.tabs button {
  border: 1px solid transparent;
  background: #eef0f4;
  border-radius: 999px;
  padding: 0.3rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
}
.tabs button.on {
  background: var(--accent);
  color: #fff;
}
h3 {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #6b7280;
  margin: 1.1rem 0 0.4rem;
}
h3 small {
  text-transform: none;
  letter-spacing: 0;
}
.pane input {
  border: 1px solid #d9dde5;
  border-radius: 8px;
  padding: 0.3rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
}
.pane details {
  border-top: 1px solid #eef0f4;
  padding-top: 0.4rem;
  margin-top: 0.4rem;
}
.pane summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.92rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0.4rem 0;
}
.row button {
  border: 1px solid transparent;
  background: #eef0f4;
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  font-size: 0.85rem;
  cursor: pointer;
}
.row button.some {
  background: #f4f7fc;
  border-color: #8aa4cf;
  border-style: dashed;
}
.row button.on {
  background: var(--accent);
  color: #fff;
}
.status {
  position: sticky;
  bottom: 0;
  margin: 0.8rem 0 0;
  padding: 0.5rem 0;
  min-height: 1.2em;
  text-align: center;
  color: #14612c;
  background: #fff;
  border-top: 1px solid #eef0f4;
}
.err {
  color: #b42318;
}
</style>
