<script setup>
import { onMounted } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useAuth } from './stores/auth'

const auth = useAuth()
const route = useRoute()
const loginMsg = new URLSearchParams(location.search).get('login')

onMounted(() => auth.load())
</script>

<template>
  <div class="page">
    <div class="content">
      <template v-if="auth.loaded">
        <template v-if="auth.user">
          <header class="top">
            <RouterLink to="/">Schulfotos</RouterLink>
            <RouterLink to="/upload">Hochladen</RouterLink>
            <RouterLink v-if="auth.isAdmin" to="/admin/tags">Tags verwalten</RouterLink>
            <RouterLink v-if="auth.isAdmin" to="/trash">Papierkorb</RouterLink>
            <RouterLink v-if="auth.isAdmin" to="/admin/duplicates">Dubletten</RouterLink>
            <RouterLink v-if="auth.isAdmin" to="/admin/users">Nutzer</RouterLink>
            <span class="spacer"></span>
            <span class="user">{{ auth.user.name || auth.user.email }}</span>
            <button class="out" @click="auth.logout()">Abmelden</button>
          </header>
          <RouterView />
        </template>
        <RouterView v-else-if="route.meta.public" />
        <div v-else class="login">
          <h1>Schulfotos</h1>
          <p>Anmeldung mit dem Schulkonto (@bkrheinbach.de)</p>
          <p v-if="loginMsg === 'denied'" class="err">Dieses Konto hat keinen Zugang.</p>
          <p v-else-if="loginMsg === 'failed'" class="err">Anmeldung fehlgeschlagen.</p>
          <a class="btn" href="/api/auth/login">Mit Microsoft anmelden</a>
        </div>
      </template>
    </div>
    <footer class="foot">
      <RouterLink to="/impressum">Impressum</RouterLink>
      <RouterLink to="/datenschutz">Datenschutz</RouterLink>
    </footer>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.content {
  flex: 1;
  padding-bottom: 2.6rem;
}
.top {
  padding: 0.6rem 1rem;
  background: #1f3a5f;
  color: #fff;
  font-weight: 600;
  font-size: 1.1rem;
  display: flex;
  gap: 1.5rem;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 5;
  height: 3rem;
  padding-top: 0;
  padding-bottom: 0;
}
.top a {
  color: #fff;
  text-decoration: none;
}
.top a.router-link-exact-active {
  text-decoration: underline;
}
.spacer {
  flex: 1;
}
.user {
  font-weight: 400;
  font-size: 0.9rem;
}
.out {
  background: transparent;
  color: #fff;
  border: 1px solid #fff8;
  border-radius: 4px;
  padding: 0.2rem 0.6rem;
  cursor: pointer;
}
.login {
  max-width: 24rem;
  margin: 15vh auto;
  padding: 2rem;
  text-align: center;
  border: 1px solid #ddd;
  border-radius: 8px;
}
.err {
  color: #b00020;
}
.btn {
  display: inline-block;
  margin-top: 1rem;
  padding: 0.6rem 1.2rem;
  background: var(--accent);
  color: #fff;
  border-radius: 4px;
  text-decoration: none;
}
.foot {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  height: 2.2rem;
  display: flex;
  gap: 1.2rem;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  background: #fff;
  border-top: 1px solid #e3e6ea;
}
.foot a {
  color: #555;
}
</style>
