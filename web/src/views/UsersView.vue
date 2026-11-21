<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const users = ref([])
const email = ref('')
const role = ref('user')
const error = ref('')

async function load() {
  const r = await fetch('/api/users')
  if (r.ok) users.value = await r.json()
}

async function setRole(mail, newRole) {
  error.value = ''
  const r = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: mail, role: newRole }),
  })
  if (!r.ok) error.value = (await r.json()).error || 'Fehler'
  await load()
}

async function add() {
  await setRole(email.value, role.value)
  if (!error.value) email.value = ''
}

const fmt = (d) => (d ? new Date(d).toLocaleString('de-DE') : 'noch nie')

const sync = ref({ running: false, last: null })
let timer = null

async function loadSync() {
  const r = await fetch('/api/sync')
  if (r.ok) sync.value = await r.json()
  if (sync.value.running && !timer) timer = setInterval(loadSync, 3000)
  if (!sync.value.running && timer) {
    clearInterval(timer)
    timer = null
  }
}

async function startSync(dry) {
  error.value = ''
  const r = await fetch('/api/sync' + (dry ? '?dry=1' : ''), { method: 'POST' })
  if (!r.ok) error.value = (await r.json()).error || 'Fehler'
  await loadSync()
}

onMounted(() => {
  load()
  loadSync()
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <main class="wrap">
    <h1>Nutzer und Verwaltungsgruppe</h1>
    <p class="hint">
      Alle @bkrheinbach.de-Konten dürfen ansehen, herunterladen und hochladen. Verwalter dürfen
      zusätzlich bearbeiten, löschen und Tags verwalten.
    </p>
    <form class="add" @submit.prevent="add">
      <input v-model="email" placeholder="vorname.nachname@bkrheinbach.de" required />
      <select v-model="role">
        <option value="user">Nutzer</option>
        <option value="admin">Verwalter</option>
      </select>
      <button type="submit">Eintragen</button>
    </form>
    <p v-if="error" class="err">{{ error }}</p>
    <table>
      <thead>
        <tr>
          <th>Adresse</th>
          <th>Name</th>
          <th>Letzte Anmeldung</th>
          <th>Rolle</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in users" :key="u.email">
          <td>{{ u.email }}</td>
          <td>{{ u.name }}</td>
          <td>{{ fmt(u.last_login) }}</td>
          <td>
            <select :value="u.role" @change="setRole(u.email, $event.target.value)">
              <option value="user">Nutzer</option>
              <option value="admin">Verwalter</option>
            </select>
          </td>
        </tr>
      </tbody>
    </table>
    <h2>Archiv-Abgleich</h2>
    <p class="hint">
      Gleicht die Fotos auf der Platte mit der Datenbank ab: neue Dateien einlesen, geänderte neu
      einlesen (die Datei gewinnt), fehlende entfernen.
    </p>
    <div class="add">
      <button :disabled="sync.running" @click="startSync(true)">Nur prüfen</button>
      <button :disabled="sync.running" @click="startSync(false)">Jetzt abgleichen</button>
    </div>
    <p v-if="sync.running">Läuft …</p>
    <div v-else-if="sync.last">
      <p>Zuletzt beendet: {{ fmt(sync.last.finished) }}</p>
      <p v-if="sync.last.error" class="err">{{ sync.last.error }}</p>
      <pre v-else>{{ JSON.stringify(sync.last.result, null, 2) }}</pre>
    </div>
  </main>
</template>

<style scoped>
.wrap {
  max-width: 56rem;
  margin: 1.5rem auto;
  padding: 0 1rem;
}
.hint {
  color: #555;
}
.add {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
.add input {
  flex: 1;
  padding: 0.4rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid #ddd;
}
.err {
  color: #b00020;
}
</style>
