import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/home/index.vue'),
    },
    {
      path: '/group-chat/:id',
      name: 'group-chat',
      component: () => import('@/pages/group-chat/index.vue'),
    },
    {
      path: '/private-chat/:id',
      name: 'private-chat',
      component: () => import('@/pages/private-chat/index.vue'),
    },
    {
      path: '/manage',
      name: 'manage',
      component: () => import('@/pages/manage/index.vue'),
    },
  ],
  history: createWebHashHistory(),
})

router.beforeEach((_to, _from, next) => {
  next()
})

router.afterEach((to) => {
  document.body.id = `page-${to.name as string}`
})
