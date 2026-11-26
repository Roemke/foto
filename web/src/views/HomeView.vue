<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePhotosStore } from '@/stores/photos'
import PhotoEditDialog from '@/components/PhotoEditDialog.vue'
import { useAuth } from '@/stores/auth'

const store = usePhotosStore()
const auth = useAuth()
const current = ref(null)

const editIds = ref(null)
const editPhotos = computed(() => {
  if (!editIds.value) return []
  const set = new Set(editIds.value)
  return store.photos.filter((p) => set.has(p.id))
})
function openEdit(ids) {
  if (ids.length) editIds.value = ids
}
async function trashPhotos(ids) {
  if (!ids.length) return
  const msg =
    ids.length === 1
      ? 'Dieses Foto in den Papierkorb verschieben?'
      : `${ids.length} Fotos in den Papierkorb verschieben?`
  if (!confirm(msg)) return
  const r = await fetch('/api/trash', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    alert(j.error || 'Fehler beim Löschen')
    return
  }
  const failed = new Set((j.failed ?? []).map((f) => f.id))
  const gone = new Set(ids.filter((id) => !failed.has(id)))
  if (current.value && gone.has(current.value.id)) {
    const i = store.photos.findIndex((x) => x.id === current.value.id)
    const after = store.photos.slice(i + 1).find((x) => !gone.has(x.id))
    const before = store.photos
      .slice(0, i)
      .reverse()
      .find((x) => !gone.has(x.id))
    current.value = after ?? before ?? null
  }
  store.photos = store.photos.filter((x) => !gone.has(x.id))
  store.total = Math.max(0, store.total - gone.size)
  selected.value = new Set([...selected.value].filter((id) => !gone.has(id)))
  store.loadTags()
  if (failed.size)
    alert(`${failed.size} Foto(s) konnten nicht verschoben werden: ${j.failed[0].error}`)
}
async function onSaved({ ids, rating, date, adds, removes }) {
  const set = new Set(ids)
  for (const p of store.photos) {
    if (!set.has(p.id)) continue
    if (rating !== undefined) p.rating = rating || null
    if (date) {
      const certain = p.date_source === 'exif' || p.date_source === 'manual'
      const tm = certain && p.taken_at ? p.taken_at.slice(11) : '00:00:00'
      p.taken_at = `${date} ${tm}`
      p.date_source = 'manual'
      p.date_precision = 'day'
    }
    p.tags = (p.tags ?? []).filter(
      (x) => !removes.some((r) => r.group === x.group && r.name === x.name),
    )
    for (const a of adds) {
      if (!p.tags.some((x) => x.group === a.group && x.name === a.name)) {
        p.tags.push({ group: a.group, name: a.name })
      }
    }
  }
  store.loadTags()
  if (showInfo.value && current.value) {
    const r = await fetch(`/api/photos/${current.value.id}`)
    info.value = await r.json()
  }
}

onMounted(async () => {
  await store.loadTags()
  await store.load()
})

function step(d) {
  if (!current.value) return
  const i = store.photos.findIndex((p) => p.id === current.value.id) + d
  if (i >= 0 && i < store.photos.length) current.value = store.photos[i]
  if (i >= store.photos.length - 5 && store.photos.length < store.total && !store.loading) {
    store.load(false)
  }
}

function onKey(e) {
  if (editIds.value) return
  if (current.value) {
    if (e.key === 'ArrowRight') step(1)
    else if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'Escape') current.value = null
    else if (e.key === 'i' || e.key === 'I') showInfo.value = !showInfo.value
    return
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    selectAllLoaded()
  } else if (e.key === 'Escape') {
    selected.value = new Set()
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

const selected = ref(new Set())
let anchor = null

const query = ref(store.q)
let searchTimer = null
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setQuery(query.value), 350)
}
watch(
  () => store.q,
  (v) => {
    if (v !== query.value) query.value = v
  },
)

watch(
  () => [store.rating, [...store.selectedTags], store.from, store.to, store.q],
  () => {
    selected.value = new Set()
    anchor = null
  },
)

function range(p) {
  const list = store.photos
  const idx = list.findIndex((x) => x.id === p.id)
  const a = list.findIndex((x) => x.id === anchor)
  const [lo, hi] = a < 0 ? [idx, idx] : a < idx ? [a, idx] : [idx, a]
  return list.slice(lo, hi + 1).map((x) => x.id)
}

function select(p, e) {
  let s
  if (e.shiftKey) {
    s = new Set(range(p))
    if (anchor === null) anchor = p.id
  } else {
    s = new Set(selected.value)
    if (s.has(p.id)) s.delete(p.id)
    else s.add(p.id)
    anchor = p.id
  }
  selected.value = s
}

function downloadZip() {
  if (!selected.value.size) return
  if (selected.value.size > 500) {
    alert('Maximal 500 Fotos pro ZIP-Datei.')
    return
  }
  const f = document.createElement('form')
  f.method = 'POST'
  f.action = '/api/download'
  const i = document.createElement('input')
  i.type = 'hidden'
  i.name = 'ids'
  i.value = [...selected.value].join(',')
  f.appendChild(i)
  document.body.appendChild(f)
  f.submit()
  f.remove()
}

function selectAllLoaded() {
  selected.value = new Set(store.photos.map((p) => p.id))
}

const activeTags = computed(() =>
  store.groups.flatMap((g) =>
    g.tags
      .filter((t) => store.selectedTags.includes(t.id))
      .map((t) => ({ id: t.id, name: t.name, group: g.name })),
  ),
)

function selCount(g) {
  return g.tags.filter((t) => store.selectedTags.includes(t.id)).length
}

const showInfo = ref(false)
const info = ref(null)

watch([current, showInfo], async () => {
  info.value = null
  if (!current.value || !showInfo.value) return
  const id = current.value.id
  const r = await fetch(`/api/photos/${id}`)
  const data = await r.json()
  if (current.value && current.value.id === id) info.value = data
})

function folderOf(rel) {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '(oberster Ordner)' : rel.slice(0, i)
}

function mb(n) {
  return n ? (n / 1048576).toFixed(1) : '?'
}

function sourceText(p) {
  const prec = { year: 'nur Jahr', month: 'nur Monat', day: '' }[p.date_precision]
  switch (p.date_source) {
    case 'exif':
      return 'aus den Bilddaten'
    case 'filename':
      return 'aus dem Dateinamen, unsicher'
    case 'folder':
      return `aus dem Ordnernamen${prec ? ', ' + prec : ''}, unsicher`
    case 'mtime':
      return 'Dateidatum, unsicher'
    case 'manual':
      return 'manuell eingetragen'
    default:
      return 'unbekannt'
  }
}

function tagsByGroup(p) {
  const m = {}
  for (const t of p.tags ?? []) (m[t.group] ??= []).push(t.name)
  return m
}

function fmt(p) {
  if (!p.taken_at) return ''
  const [y, m, d] = p.taken_at.split(' ')[0].split('-')
  if (p.date_precision === 'year') return y
  if (p.date_precision === 'month') return `${m}.${y}`
  return `${d}.${m}.${y}`
}

function stars(n) {
  return n ? '★'.repeat(n) + '☆'.repeat(5 - n) : ''
}

function certain(p) {
  return p.date_source === 'exif' || p.date_source === 'manual'
}

function groupOpen(g) {
  return g.tags.some((t) => store.selectedTags.includes(t.id))
}
</script>

<template>
  <div class="layout">
    <aside class="filters">
      <h2>Filter</h2>
      <div class="search">
        <input
          v-model="query"
          type="search"
          placeholder="Suchen: Tag, Datum, Ordner …"
          @input="onSearch"
        />
        <small v-if="store.q.trim()">Zeitraum der Treffer, änderbar</small>
      </div>
      <div class="resets">
        <button class="reset" @click="store.reset()">Filter zurücksetzen</button>
        <button class="reset" @click="store.allYears()">Alle Jahre</button>
      </div>
      <div v-if="activeTags.length" class="active">
        <button v-for="t in activeTags" :key="t.id" @click="store.toggleTag(t.id)">
          {{ t.group }}: {{ t.name }} ✕
        </button>
      </div>
      <section>
        <h3>Sterne</h3>
        <div class="chips rating">
          <button :class="{ on: store.rating === 0 }" @click="store.setRating(0)">alle</button>
          <button
            v-for="n in [5, 4, 3, 2, 1]"
            :key="n"
            :class="{ on: store.rating === n }"
            @click="store.setRating(n)"
          >
            ab {{ n }} ★
          </button>
        </div>
      </section>
      <section>
        <h3>Zeitraum</h3>
        <div class="range">
          <input v-model="store.from" type="date" @change="store.load()" />
          <span>–</span>
          <input v-model="store.to" type="date" @change="store.load()" />
        </div>
      </section>
      <details v-for="g in store.groups" :key="g.id" :open="groupOpen(g)">
        <summary>
          {{ g.name
          }}<span
            v-if="selCount(g)"
            class="badge"
            title="Auswahl dieser Gruppe aufheben"
            @click.prevent.stop="store.clearTags(g.tags.map((t) => t.id))"
            >{{ selCount(g) }} ✕</span
          >
        </summary>
        <div class="chips">
          <button
            v-for="t in g.tags"
            :key="t.id"
            :class="{ on: store.selectedTags.includes(t.id), zero: t.count === 0 }"
            @click="store.toggleTag(t.id)"
          >
            {{ t.name }} <small>{{ t.count }}</small>
          </button>
        </div>
      </details>
    </aside>

    <main @click.self="selected = new Set()">
      <p class="count">
        {{ store.total }} Fotos
        <span class="selbar" :class="{ idle: !selected.size }">
          <strong>{{ selected.size }} ausgewählt</strong>
          <button @click="selectAllLoaded">Alle geladenen auswählen</button>
          <button :disabled="!selected.size" @click="selected = new Set()">Auswahl aufheben</button>
          <button :disabled="!selected.size" @click="downloadZip">Als ZIP herunterladen</button>
          <button
            v-if="auth.isAdmin"
            class="danger"
            :disabled="!selected.size"
            @click="trashPhotos([...selected])"
          >
            Löschen
          </button>
          <button v-if="auth.isAdmin" :disabled="!selected.size" @click="openEdit([...selected])">
            Bearbeiten …
          </button>
        </span>
      </p>
      <div class="grid" @click.self="selected = new Set()">
        <figure v-for="p in store.photos" :key="p.id" :class="{ selected: selected.has(p.id) }">
          <span class="sel" :class="{ on: selected.has(p.id) }" @click.stop="select(p, $event)">{{
            selected.has(p.id) ? '✓' : ''
          }}</span>
          <a
            class="dl"
            :href="`/api/photos/${p.id}/original`"
            title="Original herunterladen"
            @click.stop
            >⬇</a
          >
          <img
            :src="`/api/photos/${p.id}/thumb?size=400`"
            loading="lazy"
            @click="current = p"
            :alt="p.file_name"
          />
          <figcaption>
            <span
              :class="{ unsure: !certain(p) }"
              :title="certain(p) ? '' : 'Datum unsicher (' + p.date_source + ')'"
              >{{ fmt(p) }}</span
            >
            <span class="stars">{{ stars(p.rating) }}</span>
          </figcaption>
        </figure>
      </div>
      <button
        v-if="store.photos.length < store.total"
        class="more"
        :disabled="store.loading"
        @click="store.load(false)"
      >
        Mehr laden
      </button>
    </main>

    <div v-if="current" class="overlay" :class="{ withInfo: showInfo }" @click="current = null">
      <button class="nav prev" @click.stop="step(-1)">‹</button>
      <button class="nav next" @click.stop="step(1)">›</button>
      <div class="tools" @click.stop>
        <button @click="showInfo = !showInfo">ⓘ Info</button>
        <button v-if="auth.isAdmin" @click="openEdit([current.id])">✎ Bearbeiten</button>
        <button v-if="auth.isAdmin" @click="trashPhotos([current.id])">Löschen</button>
        <a class="btn" :href="`/api/photos/${current.id}/original`">Original herunterladen</a>
        <button @click="current = null">✕</button>
      </div>
      <aside v-if="showInfo" class="info" @click.stop>
        <h3>Foto-Informationen</h3>
        <dl v-if="info">
          <dt>Datei</dt>
          <dd>{{ info.file_name }}</dd>
          <dt>Ordner im Archiv</dt>
          <dd>{{ folderOf(info.rel_path) }}</dd>
          <dt>Aufnahmedatum</dt>
          <dd>
            {{ fmt(info) }} <small>({{ sourceText(info) }})</small>
          </dd>
          <dt>Größe</dt>
          <dd>{{ info.width }} × {{ info.height }} px, {{ mb(info.file_size) }} MB</dd>
          <dt>Sterne</dt>
          <dd>{{ stars(info.rating) || 'keine' }}</dd>
          <dt>Fotograf</dt>
          <dd>{{ info.photographer || '–' }}</dd>
          <template v-for="(names, g) in tagsByGroup(current)" :key="g">
            <dt>{{ g }}</dt>
            <dd>{{ names.join(', ') }}</dd>
          </template>
        </dl>
      </aside>
      <img :src="`/api/photos/${current.id}/thumb?size=1600`" :alt="current.file_name" />
      <p>
        {{ current.file_name }} · {{ fmt(current) }} · {{ stars(current.rating) }}<br />
        {{ current.tags.map((t) => t.group + ': ' + t.name).join(', ') }}
      </p>
    </div>

    <PhotoEditDialog v-if="editIds" :photos="editPhotos" @close="editIds = null" @saved="onSaved" />
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 1rem;
  padding: 1rem;
  align-items: start;
}
.filters {
  background: #fff;
  padding: 0.8rem;
  border-radius: 6px;
  position: sticky;
  top: 3.5rem;
  max-height: calc(100vh - 6.5rem);
  overflow-y: auto;
}
.filters h2,
.filters h3 {
  margin: 0.4rem 0;
  font-size: 1rem;
}
.filters label {
  display: block;
  margin: 0.2rem 0;
}
details {
  margin: 0.4rem 0;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0.4rem 0;
}
.chips button,
.reset,
.more {
  border: 1px solid #bbb;
  background: #fafafa;
  border-radius: 14px;
  padding: 0.15rem 0.6rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.chips button.on {
  background: #1f3a5f;
  color: #fff;
  border-color: #1f3a5f;
}
.reset {
  margin-top: 0.6rem;
}
.more {
  display: block;
  margin: 1rem auto;
  padding: 0.5rem 1.5rem;
}
.count {
  margin: 0 0 0.5rem;
  color: #555;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.6rem;
}
figure {
  margin: 0;
  background: #fff;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
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
  justify-content: space-between;
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
}
.unsure {
  color: #a66;
}
.stars {
  color: #c90;
}
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #eee;
  cursor: zoom-out;
  z-index: 10;
}
.overlay img {
  max-width: 95vw;
  max-height: 85vh;
}
.overlay p {
  text-align: center;
  font-size: 0.85rem;
}
.nav {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  border: none;
  font-size: 3rem;
  padding: 0.3rem 1rem;
  cursor: pointer;
  border-radius: 6px;
}
.nav:hover {
  background: rgba(255, 255, 255, 0.3);
}
.prev {
  left: 1rem;
}
.next {
  right: 1rem;
}
figure {
  position: relative;
  user-select: none;
}
.sel {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 20px;
  height: 20px;
  cursor: pointer;
  opacity: 0.6;
}
figure:hover .sel,
figure.selected .sel {
  opacity: 1;
}
figure.selected {
  outline: 3px solid #1f3a5f;
}
.selbar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: #dfe8f5;
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  margin-bottom: 0.6rem;
}
.selbar button {
  border: 1px solid #bbb;
  background: #fafafa;
  border-radius: 14px;
  padding: 0.15rem 0.6rem;
  cursor: pointer;
}
.sel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 2px solid #fff;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  opacity: 1;
}
.sel.on {
  background: #1f3a5f;
}
.count {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}
.selbar {
  margin-bottom: 0;
  font-size: 0.85rem;
}
.selbar.idle {
  background: #eceef1;
  color: #8a8f98;
}
.selbar button:disabled {
  opacity: 0.5;
  cursor: default;
}
.search {
  display: grid;
  gap: 0.2rem;
  margin-bottom: 0.6rem;
}
.search input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d9dde5;
  border-radius: 8px;
  padding: 0.4rem 0.5rem;
  font: inherit;
}
.search small {
  color: #6b7280;
}
.resets {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
}
.resets .reset {
  margin-top: 0;
}
.chips button.zero {
  opacity: 0.45;
}
.dl {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  border-radius: 4px;
  text-decoration: none;
  font-size: 14px;
  opacity: 0;
}
figure:hover .dl {
  opacity: 1;
}
@media (hover: none) {
  .dl {
    opacity: 1;
  }
}
.tools {
  position: fixed;
  top: 0.8rem;
  right: 0.8rem;
  display: flex;
  gap: 0.5rem;
  z-index: 11;
}
.tools button,
.tools .btn {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  border: none;
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  text-decoration: none;
}
.tools button:hover,
.tools .btn:hover {
  background: rgba(255, 255, 255, 0.3);
}
.info {
  position: fixed;
  top: 3.4rem;
  right: 0.8rem;
  bottom: 0.8rem;
  width: 320px;
  background: rgba(20, 20, 20, 0.92);
  color: #eee;
  padding: 0.8rem 1rem;
  border-radius: 8px;
  overflow-y: auto;
  cursor: default;
  text-align: left;
  z-index: 11;
}
.info h3 {
  margin: 0 0 0.6rem;
  font-size: 1rem;
}
.info dt {
  font-size: 0.75rem;
  color: #aaa;
  margin-top: 0.5rem;
}
.info dd {
  margin: 0;
  font-size: 0.9rem;
  word-break: break-word;
}
.withInfo .next {
  right: 350px;
}
.badge {
  margin-left: 0.4rem;
  background: #1f3a5f;
  color: #fff;
  border-radius: 10px;
  padding: 0 0.45rem;
  font-size: 0.75rem;
}
.active {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0.4rem 0;
}
.active button {
  border: 1px solid #1f3a5f;
  background: #1f3a5f;
  color: #fff;
  border-radius: 14px;
  padding: 0.15rem 0.6rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.badge {
  cursor: pointer;
}

/* --- modernes Erscheinungsbild --- */
.filters {
  padding: 1rem;
  border-radius: 14px;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.06),
    0 6px 20px rgba(0, 0, 0, 0.04);
}
.filters h2 {
  font-size: 1.2rem;
  margin: 0 0 0.4rem;
}
.filters h3 {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #6b7280;
  margin: 1rem 0 0.4rem;
}
.chips button,
.reset,
.more {
  border: 1px solid transparent;
  background: #eef0f4;
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  font-size: 0.82rem;
  transition:
    background 0.15s,
    color 0.15s;
}
.chips button:hover,
.reset:hover,
.more:hover {
  background: #e0e5ee;
}
.chips button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.range {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.range span {
  color: #9ca3af;
}
.range input {
  flex: 1;
  min-width: 0;
  border: 1px solid #d9dde5;
  border-radius: 8px;
  padding: 0.3rem 0.4rem;
  font: inherit;
  font-size: 0.82rem;
  background: #fff;
}
details {
  border-top: 1px solid #eef0f4;
  padding-top: 0.5rem;
}
summary {
  font-size: 0.92rem;
}
figure {
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  transition:
    transform 0.15s,
    box-shadow 0.15s;
}
figure:hover {
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
}

.chips.rating {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.35rem;
  padding: 0.45rem;
  border: 1px solid #d9dde5;
  border-radius: 12px;
}
.chips.rating button {
  text-align: center;
  padding: 0.3rem 0;
}

.selbar button.danger {
  color: #9b1c10;
}
</style>
