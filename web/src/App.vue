<script setup>
import { RouterView } from 'vue-router'
</script>

<template>
  <header class="top">Schulfotos</header>
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
</style>
