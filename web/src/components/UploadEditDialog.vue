<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import EditDialog from '@/components/EditDialog.vue'

const props = defineProps({ photos: { type: Array, required: true } })
const emit = defineEmits(['close'])

const tab = ref('stars')
const i = ref(0)
const ratings = ref({})
const error = ref('')
const cur = computed(() => props.photos[i.value])

async function loadRating(p) {
  if (!p || ratings.value[p.id] !== undefined) return
  let v = 0
  try {
    const r = await fetch(`/api/photos/${p.id}`)
    if (r.ok) v = (await r.json()).rating ?? 0
  } catch {
    // Anzeige bleibt bei 0
  }
  ratings.value = { ...ratings.value, [p.id]: v }
}

watch(
  i,
  () => {
    loadRating(cur.value)
    const next = props.photos[i.value + 1]
    if (next) new Image().src = `/api/photos/${next.id}/thumb?size=1600`
  },
  { immediate: true },
)

function go(d) {
  const n = i.value + d
  if (n >= 0 && n < props.photos.length) i.value = n
}

async function setRating(n) {
  const p = cur.value
  if (!p) return
  const old = ratings.value[p.id] ?? 0
  ratings.value = { ...ratings.value, [p.id]: n }
  error.value = ''
  try {
    const r = await fetch('/api/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [p.id], rating: n }),
    })
    if (!r.ok) throw new Error((await r.json()).error || 'Fehler beim Speichern')
  } catch (e) {
    ratings.value = { ...ratings.value, [p.id]: old }
    error.value = e.message || 'Verbindung fehlgeschlagen'
  }
}

function onKey(e) {
  if (e.key === 'Escape') emit('close')
  else if (tab.value !== 'stars') return
  else if (e.key === 'ArrowRight') go(1)
  else if (e.key === 'ArrowLeft') go(-1)
  else if (/^[0-5]$/.test(e.key)) setRating(Number(e.key))
}
onMounted(() => window.addEventListener('keydown', onKey))
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

      <div v-if="tab === 'stars' && cur">
        <img class="pic" :src="`/api/photos/${cur.id}/thumb?size=1600`" alt="" />
        <div class="nav">
          <button :disabled="i === 0" @click="go(-1)">‹</button>
          <span>{{ i + 1 }} / {{ photos.length }}</span>
          <button :disabled="i === photos.length - 1" @click="go(1)">›</button>
        </div>
        <div class="starrow">
          <button
            v-for="n in 5"
            :key="n"
            class="s"
            :class="{ on: (ratings[cur.id] ?? 0) >= n }"
            @click="setRating(n)"
          >
            ★
          </button>
          <button @click="setRating(0)">keine</button>
        </div>
        <p class="hint">Pfeiltasten blättern, Tasten 1–5 vergeben Sterne, 0 entfernt sie.</p>
        <p v-if="error" class="err">{{ error }}</p>
      </div>

      <EditDialog v-if="tab === 'tags'" embedded :photos="photos" @close="emit('close')" />
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
.tabs button,
.nav button,
.starrow button {
  border: 1px solid transparent;
  background: #eef0f4;
  border-radius: 999px;
  padding: 0.3rem 0.9rem;
  cursor: pointer;
  font-size: 0.9rem;
}
.tabs button.on,
.starrow button.on {
  background: var(--accent);
  color: #fff;
}
.nav button:disabled {
  opacity: 0.4;
  cursor: default;
}
.pic {
  display: block;
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
  background: #f3f4f6;
  border-radius: 10px;
}
.nav {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  margin: 0.6rem 0;
}
.starrow {
  display: flex;
  justify-content: center;
  gap: 0.4rem;
  margin: 0.4rem 0;
}
.starrow .s {
  font-size: 1.5rem;
  padding: 0.2rem 0.7rem;
}
.hint {
  text-align: center;
  color: #6b7280;
  font-size: 0.85rem;
}
.err {
  color: #b42318;
  text-align: center;
}
</style>
