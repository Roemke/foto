import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import UploadView from '../views/UploadView.vue'
import AdminTagsView from '../views/AdminTagsView.vue'
import TrashView from '../views/TrashView.vue'
import UsersView from '../views/UsersView.vue'
import DupesView from '../views/DupesView.vue'
import ImpressumView from '../views/ImpressumView.vue'
import DatenschutzView from '../views/DatenschutzView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/upload', name: 'upload', component: UploadView },
    { path: '/admin/tags', name: 'admin-tags', component: AdminTagsView },
    { path: '/trash', name: 'trash', component: TrashView },
    { path: '/admin/users', name: 'admin-users', component: UsersView },
    { path: '/admin/duplicates', name: 'admin-duplicates', component: DupesView },
    { path: '/impressum', name: 'impressum', component: ImpressumView, meta: { public: true } },
    {
      path: '/datenschutz',
      name: 'datenschutz',
      component: DatenschutzView,
      meta: { public: true },
    },
  ],
})

export default router
