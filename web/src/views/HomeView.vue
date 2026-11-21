<script setup>
import { onMounted, ref } from 'vue'
import { usePhotosStore } from '@/stores/photos'

const store = usePhotosStore()
const current = ref(null)

onMounted(async () => {
  await store.loadTags()
  await store.load()
})

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
    </aside>

    <main>
      <p class="count">{{ store.total }} Fotos</p>
      <div class="grid">
        <figure v-for="p in store.photos" :key="p.id" @click="current = p">
          <img :src="`/api/photos/${p.id}/thumb?size=400`" loading="lazy" :alt="p.file_name" />
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
</style>
