import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import NavBar from './components/ui/NavBar'
import ProtectedRoute from './components/ui/ProtectedRoute'

import LoginPage from './pages/login/LoginPage'
import AdminPage from './pages/admin/AdminPage'
import DisplayPage from './pages/display/DisplayPage'
import ProfessionalSchedulePage from './pages/display/ProfessionalSchedulePage'
import ControlPage from './pages/control/ControlPage'
import ClientPage from './pages/client/ClientPage'
import SettingsPage from './pages/settings/SettingsPage'
import { ClientVoiceProvider } from './pages/client/ClientVoiceContext'

function AppShell() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-white">
      <NavBar />
      <main className="app-route-content min-h-0 flex-1">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/display" element={<DisplayPage />} />
          <Route path="/schedule" element={<ProfessionalSchedulePage />} />
          <Route path="/client/:roomCode" element={<ClientPage />} />
          <Route path="/control" element={
            <ProtectedRoute requiredRole="nurse"><ControlPage /></ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute><SettingsPage /></ProtectedRoute>
          } />
          <Route path="/admin" element={
            <ProtectedRoute requiredRole="admin"><AdminPage /></ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/display" replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ClientVoiceProvider>
        <AppShell />
      </ClientVoiceProvider>
    </BrowserRouter>
  )
}
