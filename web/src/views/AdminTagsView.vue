<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const groups = ref([])
const job = ref({ running: false, label: '', done: 0, total: 0, errors: [] })
const error = ref('')
const newGroup = ref('')
const newTag = ref({})
const editId = ref(null)
const editName = ref('')
const mergeId = ref(null)
const mergeTo = ref('')
const showLegacy = ref(true)
let timer = null

async function api(method, url, body) {
  if (method !== 'GET') error.value = ''
  const r = await fetch('/api/admin' + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    error.value = j.error || 'Fehler'
    return null
  }
  return j
}

async function load() {
  const j = await api('GET', '/tags')
  if (j) groups.value = j
}

async function pollJob() {
  const j = await api('GET', '/job')
  if (!j) return
  const was = job.value.running
  job.value = j
  if (j.running && !timer) timer = setInterval(pollJob, 1000)
  if (!j.running && timer) {
    clearInterval(timer)
    timer = null
  }
  if (was && !j.running) load()
}

async function act(method, url, body) {
  const j = await api(method, url, body)
  if (j) {
    await load()
    pollJob()
  }
  return j
}

onMounted(() => {
  load()
  pollJob()
})
onUnmounted(() => clearInterval(timer))

const allTags = computed(() =>
  groups.value.flatMap((g) => g.tags.map((t) => ({ id: t.id, label: `${g.name}: ${t.name}` }))),
)
const visibleTags = (g) => (showLegacy.value ? g.tags : g.tags.filter((t) => !t.legacy))

async function addGroup() {
  const name = newGroup.value.trim()
  if (name && (await act('POST', '/groups', { name }))) newGroup.value = ''
}
async function addTag(g) {
  const name = (newTag.value[g.id] ?? '').trim()
  if (name && (await act('POST', '/tags', { groupId: g.id, name }))) newTag.value[g.id] = ''
}
function startEdit(t) {
  editId.value = t.id
  editName.value = t.name
}
async function saveEdit(t) {
  if (editId.value !== t.id) return
  const name = editName.value.trim()
  editId.value = null
  if (name && name !== t.name) await act('PATCH', `/tags/${t.id}`, { name })
}
const toggleActive = (t) => act('PATCH', `/tags/${t.id}`, { active: !t.active })
const toggleVisible = (g) => act('PATCH', `/groups/${g.id}`, { visible: !g.visible })

async function moveGroup(g, d) {
  const list = [...groups.value]
  const i = list.findIndex((x) => x.id === g.id)
  const j = i + d
  if (j < 0 || j >= list.length) return
  list.splice(j, 0, list.splice(i, 1)[0])
  for (const [k, x] of list.entries()) {
    if (x.sort !== k * 10) await api('PATCH', `/groups/${x.id}`, { sort: k * 10 })
  }
  await load()
}
async function removeGroup(g) {
  if (confirm(`Gruppe „${g.name}“ löschen?`)) await act('DELETE', `/groups/${g.id}`)
}

async function moveTag(t, e) {
  const groupId = Number(e.target.value)
  e.target.value = ''
  if (!groupId) return
  const g = groups.value.find((x) => x.id === groupId)
  if (!confirm(`„${t.name}“ in die Gruppe „${g.name}“ verschieben?`)) return
  await act('PATCH', `/tags/${t.id}`, { groupId })
}
function openMerge(t) {
  mergeId.value = t.id
  mergeTo.value = ''
}
async function doMerge(t) {
  const into = Number(mergeTo.value)
  const target = allTags.value.find((x) => x.id === into)
  if (!target) return
  const msg = `„${t.name}“ (${t.count} Fotos) in „${target.label}“ zusammenführen? „${t.name}“ wird danach gelöscht.`
  if (!confirm(msg)) return
  mergeId.value = null
  await act('POST', `/tags/${t.id}/merge`, { into })
}
async function removeTag(t) {
  const msg = `Tag „${t.name}“ löschen? Er wird bei ${t.count} Foto(s) entfernt, auch in den Dateien.`
  if (confirm(msg)) await act('DELETE', `/tags/${t.id}`)
}
</script>

<template>
  <main class="adm">
    <h1>Tags verwalten</h1>

    <div v-if="job.label" class="job" :class="{ run: job.running, bad: job.errors.length }">
      <template v-if="job.running">
        Schreibe Dateien … {{ job.done }} / {{ job.total }} – {{ job.label }}
      </template>
      <template v-else>
        Fertig: {{ job.label }} ({{ job.total }} Dateien)
        <span v-if="job.errors.length"> – {{ job.errors.length }} Fehler: {{ job.errors[0] }}</span>
      </template>
    </div>
    <p v-if="error" class="err">{{ error }}</p>

    <div class="bar">
      <input v-model="newGroup" placeholder="Neue Gruppe" @keyup.enter="addGroup" />
      <button @click="addGroup">Gruppe anlegen</button>
      <label class="chk"><input v-model="showLegacy" type="checkbox" /> Alt-Tags anzeigen</label>
    </div>

    <section v-for="(g, gi) in groups" :key="g.id" class="grp" :class="{ hidden: !g.visible }">
      <header>
        <h2>
          {{ g.name }} <small>{{ g.tags.length }} Tags</small>
        </h2>
        <span class="acts">
          <button :disabled="gi === 0" title="Nach oben" @click="moveGroup(g, -1)">▲</button>
          <button :disabled="gi === groups.length - 1" title="Nach unten" @click="moveGroup(g, 1)">
            ▼
          </button>
          <button @click="toggleVisible(g)">{{ g.visible ? 'Ausblenden' : 'Einblenden' }}</button>
          <button v-if="!g.tags.length" class="del" @click="removeGroup(g)">Löschen</button>
        </span>
      </header>

      <ul>
        <li v-for="t in visibleTags(g)" :key="t.id" :class="{ off: !t.active }">
          <input
            v-if="editId === t.id"
            v-model="editName"
            class="ren"
            @keyup.enter="saveEdit(t)"
            @keyup.esc="editId = null"
            @blur="saveEdit(t)"
          />
          <span v-else class="nm" title="Klicken zum Umbenennen" @click="startEdit(t)">{{
            t.name
          }}</span>
          <small class="cnt">{{ t.count }}</small>
          <small v-if="t.legacy" class="lg">Alt</small>
          <span class="acts">
            <button @click="toggleActive(t)">{{ t.active ? 'Ausblenden' : 'Einblenden' }}</button>
            <button @click="openMerge(t)">Zusammenführen</button>
            <select @change="moveTag(t, $event)">
              <option value="">Verschieben …</option>
              <option v-for="o in groups.filter((x) => x.id !== g.id)" :key="o.id" :value="o.id">
                {{ o.name }}
              </option>
            </select>
            <button class="del" @click="removeTag(t)">Löschen</button>
          </span>
          <div v-if="mergeId === t.id" class="merge">
            In
            <select v-model="mergeTo">
              <option value="">Ziel wählen …</option>
              <option v-for="o in allTags.filter((x) => x.id !== t.id)" :key="o.id" :value="o.id">
                {{ o.label }}
              </option>
            </select>
            zusammenführen
            <button :disabled="!mergeTo" @click="doMerge(t)">OK</button>
            <button @click="mergeId = null">Abbrechen</button>
          </div>
        </li>
      </ul>

      <div class="add">
        <input v-model="newTag[g.id]" placeholder="Neuer Tag" @keyup.enter="addTag(g)" />
        <button @click="addTag(g)">Hinzufügen</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.adm {
  max-width: 900px;
  margin: 1.5rem auto;
  padding: 0 1rem;
}
.job {
  background: #eef3fc;
  border-radius: 10px;
  padding: 0.6rem 1rem;
  margin-bottom: 0.8rem;
  font-size: 0.9rem;
}
.job.run {
  background: #fff4d6;
}
.job.bad,
.err {
  color: #b42318;
}
.bar,
.add {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin: 0.6rem 0;
}
input:not([type='checkbox']),
select {
  border: 1px solid #d9dde5;
  border-radius: 8px;
  padding: 0.3rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  background: #fff;
}
button {
  border: none;
  background: #eef0f4;
  border-radius: 999px;
  padding: 0.25rem 0.8rem;
  font-size: 0.82rem;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: #e0e5ee;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.del {
  color: #9b1c10;
}
.grp {
  background: #fff;
  border-radius: 14px;
  padding: 0.8rem 1rem;
  margin: 1rem 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.grp.hidden {
  opacity: 0.6;
}
.grp header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h2 {
  margin: 0;
  font-size: 1.05rem;
}
h2 small,
.cnt {
  color: #6b7280;
  font-weight: 400;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0;
}
li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border-top: 1px solid #f0f1f4;
}
li.off .nm {
  text-decoration: line-through;
  color: #9ca3af;
}
.nm {
  cursor: text;
  min-width: 8rem;
}
.ren {
  min-width: 8rem;
}
.lg {
  background: #f1e7c9;
  border-radius: 999px;
  padding: 0 0.5rem;
}
.acts {
  margin-left: auto;
  display: flex;
  gap: 0.3rem;
  align-items: center;
}
.merge {
  flex-basis: 100%;
  background: #f4f7fc;
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
  font-size: 0.85rem;
}
.chk {
  font-size: 0.85rem;
  color: #4b5563;
}
</style>
