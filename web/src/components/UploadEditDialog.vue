<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import RatePhotos from '@/components/RatePhotos.vue'

const props = defineProps({ photos: { type: Array, required: true } })
const emit = defineEmits(['close'])

const tab = ref('stars')
const groups = ref([])
const applied = ref(new Set())
const openIds = ref(new Set())
const date = ref('')
const photographer = ref('')
const status = ref('')
const statusErr = ref(false)
const visibleGroups = computed(() =>
  groups.value
    .map((g) => ({ ...g, tags: g.tags.filter((t) => !t.legacy) }))
    .filter((g) => g.tags.length),
)

// Speichern nacheinander, nie gleichzeitig (exiftool schreibt dieselben Dateien)
let queue = Promise.resolve()
function save(body, undo) {
  queue = queue.then(async () => {
    try {
      const r = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: props.photos.map((p) => p.id), ...body }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Fehler beim Speichern')
      statusErr.value = !!j.fileErrors?.length
      status.value = j.fileErrors?.length
        ? 'Datenbank gespeichert, Datei nicht beschreibbar: ' + j.fileErrors[0].message
        : 'Gespeichert'
    } catch (e) {
      undo?.()
      statusErr.value = true
      status.value = 'Fehler: ' + (e.message || 'Verbindung fehlgeschlagen')
    }
  })
}

function toggleTag(t) {
  const on = applied.value.has(t.id)
  const flip = () => {
    const next = new Set(applied.value)
    if (next.has(t.id)) next.delete(t.id)
    else next.add(t.id)
    applied.value = next
  }
  flip()
  save({ [on ? 'removeTags' : 'addTags']: [t.id] }, flip)
}
function saveDate() {
  if (date.value) save({ date: date.value })
}
function savePhotographer() {
  const v = photographer.value.trim()
  if (v) save({ photographer: v })
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
  const on = new Set()
  const open = new Set()
  for (const g of groups.value) {
    for (const t of g.tags) {
      const all = props.photos.every((p) =>
        (p.tags ?? []).some((x) => x.group === g.name && x.name === t.name),
      )
      if (all) {
        on.add(t.id)
        open.add(g.id)
      }
    }
  }
  applied.value = on
  openIds.value = open
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="bk" @click.self="emit('close')">
    <div class="box">
      <header>
        <h2>{{ photos.length }} {{ photos.length === 1 ? 'Foto' : 'Fotos' }} bearbeiten</h2>
        <button class="x" @click="emit('close')">✕</button>
      </header>
      <nav class="tabs">
        <button :class="{ on: tab === 'stars' }" @click="tab = 'stars'">Sterne (einzeln)</button>
        <button :class="{ on: tab === 'tags' }" @click="tab = 'tags'">
          Tags &amp; Datum (alle)
        </button>
      </nav>

      <RatePhotos v-if="tab === 'stars'" :photos="photos" />

      <div v-else class="pane">
        <h3>Aufnahmedatum <small>(für alle Fotos, speichert beim Verlassen des Felds)</small></h3>
        <input v-model="date" type="date" @change="saveDate" />
        <h3>Fotograf <small>(für alle Fotos, speichert beim Verlassen des Felds)</small></h3>
        <input v-model="photographer" placeholder="Name" @change="savePhotographer" />
        <h3>Tags <small>(ein Klick setzt oder entfernt sofort)</small></h3>
        <details v-for="g in visibleGroups" :key="g.id" :open="openIds.has(g.id)">
          <summary>{{ g.name }}</summary>
          <div class="row">
            <button
              v-for="t in g.tags"
              :key="t.id"
              type="button"
              :class="{ on: applied.has(t.id) }"
              @click="toggleTag(t)"
            >
              {{ t.name }}
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
.row button.on {
  background: var(--accent);
  color: #fff;
}
.status {
  min-height: 1.2em;
  text-align: center;
  color: #14612c;
}
.err {
  color: #b42318;
}
</style>
