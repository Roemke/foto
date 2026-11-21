<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({ photos: { type: Array, required: true } })
const emit = defineEmits(['close', 'saved'])

const groups = ref([])
const state = ref({})
const rating = ref(null)
const busy = ref(false)
const error = ref('')
const warn = ref('')

const ratingOptions = [
  { v: null, l: 'unverändert' },
  { v: 0, l: 'keine' },
  ...[1, 2, 3, 4, 5].map((k) => ({ v: k, l: '★'.repeat(k) })),
]
const n = computed(() => props.photos.length)

const counts = computed(() => {
  const m = new Map()
  for (const p of props.photos) {
    for (const t of p.tags ?? []) {
      const k = t.group + '\u0000' + t.name
      m.set(k, (m.get(k) ?? 0) + 1)
    }
  }
  return m
})
const cnt = (g, t) => counts.value.get(g.name + '\u0000' + t.name) ?? 0

function onEsc(e) {
  if (e.key === 'Escape') emit('close')
}
onMounted(async () => {
  window.addEventListener('keydown', onEsc)
  const r = await fetch('/api/tags')
  groups.value = await r.json()
})
onUnmounted(() => window.removeEventListener('keydown', onEsc))

function mode(g, t) {
  const s = state.value[t.id]
  if (s) return s
  const c = cnt(g, t)
  if (c === 0) return 'none'
  return c === n.value ? 'all' : 'some'
}

function click(g, t) {
  const c = cnt(g, t)
  const cur = state.value[t.id]
  const s = { ...state.value }
  if (!cur) s[t.id] = c === n.value ? 'remove' : 'add'
  else if (cur === 'add' && c > 0) s[t.id] = 'remove'
  else delete s[t.id]
  state.value = s
}

function label(g, t) {
  const m = mode(g, t)
  if (m === 'add') return '+ ' + t.name
  if (m === 'remove') return '− ' + t.name
  if (m === 'some') return `${t.name} (${cnt(g, t)}/${n.value})`
  return t.name
}

const groupOpen = (g) => g.tags.some((t) => cnt(g, t) > 0 || state.value[t.id])

function collect(kind) {
  const out = []
  for (const g of groups.value) {
    for (const t of g.tags) {
      if (state.value[t.id] === kind) out.push({ id: t.id, group: g.name, name: t.name })
    }
  }
  return out
}
const adds = computed(() => collect('add'))
const removes = computed(() => collect('remove'))
const changed = computed(
  () => rating.value !== null || adds.value.length > 0 || removes.value.length > 0,
)

async function save() {
  busy.value = true
  error.value = ''
  warn.value = ''
  const body = {
    ids: props.photos.map((p) => p.id),
    addTags: adds.value.map((t) => t.id),
    removeTags: removes.value.map((t) => t.id),
  }
  if (rating.value !== null) body.rating = rating.value
  try {
    const r = await fetch('/api/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok) {
      error.value = j.error || 'Fehler beim Speichern'
    } else {
      emit('saved', {
        ids: body.ids,
        rating: rating.value === null ? undefined : rating.value,
        adds: adds.value,
        removes: removes.value,
      })
      if (j.fileErrors?.length) {
        const files = j.fileErrors.reduce((a, e) => a + e.files, 0)
        warn.value = `Datenbank aktualisiert, aber ${files} Datei(en) konnten nicht beschrieben werden: ${j.fileErrors[0].message}`
      } else {
        emit('close')
      }
    }
  } catch {
    error.value = 'Verbindung fehlgeschlagen'
  }
  busy.value = false
}
</script>

<template>
  <div class="bk" @click.self="emit('close')">
    <div class="dlg" @click.stop>
      <header>
        <h2>{{ n }} {{ n === 1 ? 'Foto' : 'Fotos' }} bearbeiten</h2>
        <button class="x" @click="emit('close')">✕</button>
      </header>

      <h3>Sterne</h3>
      <div class="row">
        <button
          v-for="o in ratingOptions"
          :key="o.l"
          :class="{ on: rating === o.v }"
          @click="rating = o.v"
        >
          {{ o.l }}
        </button>
      </div>

      <h3>Tags <small>(Klick wechselt: hinzufügen +, entfernen −, unverändert)</small></h3>
      <details v-for="g in groups" :key="g.id" :open="groupOpen(g)">
        <summary>{{ g.name }}</summary>
        <div class="row">
          <button
            v-for="t in g.tags"
            :key="t.id"
            type="button"
            :class="['tag', mode(g, t), { legacy: t.legacy }]"
            @click="click(g, t)"
          >
            {{ label(g, t) }}
          </button>
        </div>
      </details>

      <p v-if="error" class="err">{{ error }}</p>
      <p v-if="warn" class="err">{{ warn }}</p>
      <footer>
        <button @click="emit('close')">{{ warn ? 'Schließen' : 'Abbrechen' }}</button>
        <button class="go" :disabled="!changed || busy" @click="save">
          {{ busy ? 'Speichere …' : 'Speichern' }}
        </button>
      </footer>
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
.dlg {
  background: #fff;
  color: #1f2937;
  width: min(720px, 94vw);
  max-height: 86vh;
  overflow-y: auto;
  border-radius: 14px;
  padding: 1rem 1.2rem;
  cursor: default;
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
.x {
  border: none;
  background: none;
  font-size: 1.1rem;
  cursor: pointer;
  color: #6b7280;
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
details {
  border-top: 1px solid #eef0f4;
  padding-top: 0.4rem;
  margin-top: 0.4rem;
}
summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.92rem;
}
.tag.legacy {
  opacity: 0.6;
}
.tag.all {
  background: #d6e2f7;
  color: #1f3a5f;
}
.tag.some {
  background: #f4f7fc;
  border-color: #8aa4cf;
  border-style: dashed;
}
.tag.add {
  background: #dcf3e2;
  color: #14612c;
}
.tag.remove {
  background: #fbe0dd;
  color: #9b1c10;
  text-decoration: line-through;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 1rem;
}
footer button {
  border: none;
  background: #eef0f4;
  border-radius: 999px;
  padding: 0.5rem 1.3rem;
  cursor: pointer;
}
footer .go {
  background: var(--accent);
  color: #fff;
}
footer .go:disabled {
  opacity: 0.4;
  cursor: default;
}
.err {
  color: #b42318;
}
</style>
