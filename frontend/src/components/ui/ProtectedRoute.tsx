import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

interface Props {
  children: React.ReactNode
  requiredRole?: 'admin' | 'nurse'
}

export default function ProtectedRoute({ children, requiredRole }: Props) {
  const { token, role } = useAuthStore()

  if (!token) return <Navigate to="/login" replace />
  // Admin can access any protected route; role check only applies to non-admins
  if (requiredRole && role !== requiredRole && role !== 'admin') return <Navigate to="/login" replace />

  return <>{children}</>
}
