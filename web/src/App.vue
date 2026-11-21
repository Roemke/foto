<script setup>
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header class="top">
    <RouterLink to="/">Schulfotos</RouterLink>
    <RouterLink to="/upload">Hochladen</RouterLink>
  </header>
  <RouterView />
</template>

<style scoped>
.top {
  padding: 0.6rem 1rem;
  background: #1f3a5f;
  color: #fff;
  font-weight: 600;
  font-size: 1.1rem;
}
.top {
  display: flex;
  gap: 1.5rem;
  align-items: center;
}
.top a {
  color: #fff;
  text-decoration: none;
}
.top a.router-link-exact-active {
  text-decoration: underline;
}
</style>
