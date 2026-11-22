<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'

const files = ref([])
const anlass = ref('')
const photographer = ref('')
const date = ref('')
const eventTag = ref(false) //scheint mir nicht so sinnvoll.
const groups = ref([])
const selected = ref(new Set())
const busy = ref(false)
const result = ref(null)
const resEl = ref(null)
const error = ref('')
const drag = ref(false)
const progress = ref(0)
const phase = ref('')

async function loadTags() {
  const r = await fetch('/api/tags')
  groups.value = (await r.json())
    .map((g) => ({ ...g, tags: g.tags.filter((t) => !t.legacy) }))
    .filter((g) => g.tags.length)
}
const hasFiles = (e) => e.dataTransfer?.types?.includes('Files')
function winOver(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  drag.value = true
}
function winLeave(e) {
  if (!e.relatedTarget) drag.value = false
}
function winDrop(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  drag.value = false
  addFiles(e.dataTransfer.files)
}
onMounted(() => {
  loadTags()
  window.addEventListener('dragenter', winOver)
  window.addEventListener('dragover', winOver)
  window.addEventListener('dragleave', winLeave)
  window.addEventListener('drop', winDrop)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', winOver)
  window.removeEventListener('dragover', winOver)
  window.removeEventListener('dragleave', winLeave)
  window.removeEventListener('drop', winDrop)
})

function addFiles(list) {
  for (const f of list) {
    if (!files.value.some((x) => x.name === f.name && x.size === f.size)) files.value.push(f)
  }
}
function onDrop(e) {
  drag.value = false
  addFiles(e.dataTransfer.files)
}
function onPick(e) {
  addFiles(e.target.files)
  e.target.value = ''
}
function remove(i) {
  files.value.splice(i, 1)
}
function toggle(id) {
  const s = new Set(selected.value)
  if (s.has(id)) s.delete(id)
  else s.add(id)
  selected.value = s
}
const count = (g) => g.tags.filter((t) => selected.value.has(t.id)).length
const size = computed(() => files.value.reduce((a, f) => a + f.size, 0))
const mb = (n) => (n / 1048576).toFixed(1) + ' MB'
const label = computed(() =>
  busy.value
    ? phase.value === 'upload'
      ? `Lade hoch … ${progress.value} %`
      : 'Verarbeite …'
    : files.value.length + ' Foto(s) hochladen',
)
const canSend = computed(() => files.value.length > 0 && anlass.value.trim() && !busy.value)

function post(fd) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', '/api/upload')
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        progress.value = Math.round((e.loaded / e.total) * 100)
        if (e.loaded >= e.total) phase.value = 'verarbeite'
      }
    }
    x.upload.onload = () => {
      progress.value = 100
      phase.value = 'verarbeite'
    }
    x.onload = () => {
      let json = null
      try {
        json = JSON.parse(x.responseText)
      } catch {
        json = null
      }
      resolve({ ok: x.status >= 200 && x.status < 300, json })
    }
    x.onerror = () => reject(new Error('Verbindung fehlgeschlagen'))
    x.send(fd)
  })
}

async function send() {
  busy.value = true
  error.value = ''
  result.value = null
  const fd = new FormData()
  fd.append('anlass', anlass.value)
  fd.append('photographer', photographer.value)
  if (date.value) fd.append('date', date.value)
  fd.append('tags', [...selected.value].join(','))
  fd.append('eventTag', eventTag.value ? '1' : '0')
  for (const f of files.value) fd.append('files', f)
  try {
    progress.value = 0
    phase.value = 'upload'
    const { ok, json: j } = await post(fd)
    if (!ok) {
      error.value = j?.error || 'Fehler beim Hochladen'
    } else {
      result.value = j
      files.value = []
      loadTags()
      await nextTick()
      resEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  } catch {
    error.value = 'Verbindung fehlgeschlagen'
  }
  busy.value = false
  phase.value = ''
}
</script>

<template>
  <main class="up">
    <h1>Fotos hochladen</h1>

    <div
      class="drop"
      :class="{ over: drag }"
      @dragover.prevent="drag = true"
      @drop.prevent.stop="onDrop"
    >
      <p>{{ drag ? 'Zum Hinzufügen loslassen' : 'JPEG-Dateien oder eine ZIP hierher ziehen' }}</p>
      <label class="pick">
        Dateien wählen
        <input type="file" multiple accept=".jpg,.jpeg,.zip" hidden @change="onPick" />
      </label>
    </div>

    <ul v-if="files.length" class="flist">
      <li v-for="(f, i) in files" :key="f.name + f.size">
        <span class="fn">{{ f.name }}</span>
        <span class="fs">{{ mb(f.size) }}</span>
        <button type="button" title="Entfernen" @click="remove(i)">✕</button>
      </li>
    </ul>
    <p v-if="files.length" class="sum">{{ files.length }} Datei(en), {{ mb(size) }}</p>

    <div class="form">
      <label
        >Anlass (kurzer Text) *
        <input v-model="anlass" maxlength="80" placeholder="z.B. Abschlussfeier BFS" />
      </label>
      <label
        >Fotograf (optional)
        <input v-model="photographer" />
      </label>
      <label
        >Datum für alle (nur für Fotos ohne Aufnahmedatum)
        <input v-model="date" type="date" />
      </label>
      <!--
      <label class="chk">
        <input v-model="eventTag" type="checkbox" /> Anlass auch als Event-Tag anlegen
      </label> -->
    </div>

    <button class="go" :disabled="!canSend" @click="send">
      {{ label }}
    </button>
    <p v-if="error" class="err">{{ error }}</p>
    <div v-if="busy" class="prog">
      <div class="track">
        <div
          class="bar"
          :class="{ work: phase !== 'upload' }"
          :style="{ width: (phase === 'upload' ? progress : 100) + '%' }"
        ></div>
      </div>
      <small>{{
        phase === 'upload'
          ? progress + ' % von ' + mb(size)
          : 'Fotos werden verarbeitet, bitte warten …'
      }}</small>
    </div>

    <section v-if="result" ref="resEl" class="res">
      <h2>
        {{ result.ok }} gespeichert<span v-if="result.failed"
          >, {{ result.failed }} fehlgeschlagen</span
        >
      </h2>
      <ul>
        <li v-for="(f, i) in result.files" :key="i" :class="{ bad: f.error }">
          {{ f.name }} → {{ f.error ?? f.rel ?? 'bereits vorhanden: ' + f.duplicate }}
          <small v-if="f.source === 'manual'">(Datum für alle)</small>
        </li>
      </ul>
    </section>

    <h2>Tags für alle Fotos</h2>
    <details v-for="g in groups" :key="g.id">
      <summary>
        {{ g.name }}<span v-if="count(g)" class="n">{{ count(g) }}</span>
      </summary>
      <div class="chips">
        <button
          v-for="t in g.tags"
          :key="t.id"
          type="button"
          :class="{ on: selected.has(t.id) }"
          @click="toggle(t.id)"
        >
          {{ t.name }}
        </button>
      </div>
    </details>

    <button class="go" :disabled="!canSend" @click="send">
      {{ label }}
    </button>
    <p v-if="error" class="err">{{ error }}</p>
    <div v-if="busy" class="prog">
      <div class="track">
        <div
          class="bar"
          :class="{ work: phase !== 'upload' }"
          :style="{ width: (phase === 'upload' ? progress : 100) + '%' }"
        ></div>
      </div>
      <small>{{
        phase === 'upload'
          ? progress + ' % von ' + mb(size)
          : 'Fotos werden verarbeitet, bitte warten …'
      }}</small>
    </div>
  </main>
</template>

<style scoped>
.up {
  max-width: 760px;
  margin: 1.5rem auto;
  padding: 0 1rem;
}
.res {
  scroll-margin-top: 4rem;
}
.drop {
  border: 2px dashed #c5cbd6;
  border-radius: 14px;
  padding: 2rem;
  text-align: center;
  background: #fff;
}
.drop.over {
  border-color: var(--accent);
  border-style: solid;
  background: #dbe7fb;
  font-weight: 600;
}
.pick {
  display: inline-block;
  margin-top: 0.5rem;
  background: var(--accent);
  color: #fff;
  padding: 0.45rem 1rem;
  border-radius: 999px;
  cursor: pointer;
}
.flist {
  list-style: none;
  padding: 0;
  margin: 0.8rem 0 0;
  background: #fff;
  border-radius: 12px;
  max-height: 220px;
  overflow: auto;
}
.flist li {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  padding: 0.3rem 0.8rem;
  border-bottom: 1px solid #f0f1f4;
}
.fn {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fs,
.sum {
  color: #6b7280;
  font-size: 0.85rem;
}
.flist button {
  border: none;
  background: none;
  cursor: pointer;
  color: #9ca3af;
}
.form {
  display: grid;
  gap: 0.7rem;
  margin-top: 1rem;
  background: #fff;
  padding: 1rem;
  border-radius: 14px;
}
.form label {
  display: grid;
  gap: 0.25rem;
  font-size: 0.85rem;
  color: #4b5563;
}
.form input:not([type='checkbox']) {
  border: 1px solid #d9dde5;
  border-radius: 8px;
  padding: 0.4rem 0.5rem;
  font: inherit;
}
.form .chk {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
h2 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #6b7280;
  margin: 1.2rem 0 0.4rem;
}
details {
  background: #fff;
  border-radius: 12px;
  padding: 0.5rem 0.8rem;
  margin: 0.4rem 0;
}
summary {
  cursor: pointer;
  font-weight: 600;
}
.n {
  margin-left: 0.5rem;
  background: var(--accent);
  color: #fff;
  border-radius: 999px;
  padding: 0 0.5rem;
  font-size: 0.75rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0.5rem 0;
}
.chips button {
  border: 1px solid transparent;
  background: #eef0f4;
  border-radius: 999px;
  padding: 0.25rem 0.75rem;
  font-size: 0.82rem;
  cursor: pointer;
}
.chips button.on {
  background: var(--accent);
  color: #fff;
}
.go {
  margin-top: 1rem;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: 0.6rem 1.6rem;
  font-size: 1rem;
  cursor: pointer;
}
.go:disabled {
  opacity: 0.4;
  cursor: default;
}
.res {
  margin-top: 1rem;
  background: #fff;
  border-radius: 14px;
  padding: 1rem;
}
.res ul {
  padding-left: 1.1rem;
  margin: 0.4rem 0;
  font-size: 0.85rem;
}
.err,
.bad {
  color: #b42318;
}
.prog {
  margin-top: 0.6rem;
}
.track {
  background: #e5e7eb;
  border-radius: 999px;
  height: 0.6rem;
  overflow: hidden;
}
.bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}
.bar.work {
  animation: puls 1s ease-in-out infinite alternate;
}
@keyframes puls {
  from {
    opacity: 0.35;
  }
  to {
    opacity: 1;
  }
}
.prog small {
  color: #6b7280;
}
</style>
