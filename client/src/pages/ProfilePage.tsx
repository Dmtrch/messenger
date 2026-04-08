import { useNavigate } from 'react-router-dom'
import Profile from '@/components/Profile/Profile'

export default function ProfilePage() {
  const navigate = useNavigate()
  return <Profile onBack={() => navigate('/')} />
}
