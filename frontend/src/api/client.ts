import axios from 'axios'

const api = axios.create({ baseURL: '/' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401 && window.location.pathname !== '/login') {
      const hadToken = Boolean(localStorage.getItem('token'))
      localStorage.removeItem('token')
      localStorage.removeItem('role')
      localStorage.removeItem('name')
      localStorage.removeItem('nurseId')
      // Only force a reload when we actually had a (now-invalid) session to clear.
      // An already-logged-out client hitting a protected endpoint would otherwise
      // keep reloading into /login, remounting components that immediately retry
      // the same unauthenticated request — an infinite redirect loop.
      if (hadToken) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

export default api
