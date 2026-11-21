<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { usePhotosStore } from '@/stores/photos'

const store = usePhotosStore()
const current = ref(null)

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
  if (current.value) {
    if (e.key === 'ArrowRight') step(1)
    else if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'Escape') current.value = null
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

watch(
  () => [store.rating, [...store.selectedTags], store.from, store.to],
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
  } else if (e.ctrlKey || e.metaKey) {
    s = new Set(selected.value)
    if (s.has(p.id)) s.delete(p.id)
    else s.add(p.id)
    anchor = p.id
  } else if (selected.value.has(p.id)) {
    s = new Set(selected.value)
    s.delete(p.id)
    anchor = p.id
  } else {
    s = new Set([p.id])
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
      <section>
        <h3>Sterne</h3>
        <div class="chips">
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
        <label>von <input v-model="store.from" type="date" @change="store.load()" /></label>
        <label>bis <input v-model="store.to" type="date" @change="store.load()" /></label>
      </section>
      <details v-for="g in store.groups" :key="g.id" :open="groupOpen(g)">
        <summary>{{ g.name }}</summary>
        <div class="chips">
          <button
            v-for="t in g.tags"
            :key="t.id"
            :class="{ on: store.selectedTags.includes(t.id) }"
            @click="store.toggleTag(t.id)"
          >
            {{ t.name }} <small>{{ t.count }}</small>
          </button>
        </div>
      </details>
      <button class="reset" @click="store.reset()">Filter zurücksetzen</button>
      <button class="reset" @click="store.allYears()">Alle Jahre</button>
    </aside>

    <main @click.self="selected = new Set()">
      <p class="count">
        {{ store.total }} Fotos
        <span class="selbar" :class="{ idle: !selected.size }">
          <strong>{{ selected.size }} ausgewählt</strong>
          <button @click="selectAllLoaded">Alle geladenen auswählen</button>
          <button :disabled="!selected.size" @click="selected = new Set()">Auswahl aufheben</button>
          <button :disabled="!selected.size" @click="downloadZip">Als ZIP herunterladen</button>
        </span>
      </p>
      <div class="grid" @click.self="selected = new Set()">
        <figure v-for="p in store.photos" :key="p.id" :class="{ selected: selected.has(p.id) }">
          <span class="sel" :class="{ on: selected.has(p.id) }" @click.stop="select(p, $event)">{{
            selected.has(p.id) ? '✓' : ''
          }}</span>
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

    <div v-if="current" class="overlay" @click="current = null">
      <button class="nav prev" @click.stop="step(-1)">‹</button>
      <button class="nav next" @click.stop="step(1)">›</button>
      <img :src="`/api/photos/${current.id}/thumb?size=1600`" :alt="current.file_name" />
      <p>
        {{ current.file_name }} · {{ fmt(current) }} · {{ stars(current.rating) }}<br />
        {{ current.tags.map((t) => t.group + ': ' + t.name).join(', ') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1rem;
  padding: 1rem;
  align-items: start;
}
.filters {
  background: #fff;
  padding: 0.8rem;
  border-radius: 6px;
  position: sticky;
  top: 0.5rem;
  max-height: calc(100vh - 1rem);
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
</style>
