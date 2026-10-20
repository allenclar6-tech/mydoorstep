import { useEffect, useState } from 'react'
import { UserCircle } from 'lucide-react'
import { apiBase } from './config/apiBase'


export function ProfileAvatar({ className = '', size = 24 }) {
  const [photoUrl, setPhotoUrl] = useState(null)

  useEffect(() => {
    const token = localStorage.getItem('doorstep-token')
    if (!token) {
      setPhotoUrl(null)
      return undefined
    }

    let objectUrl
    let cancelled = false
    const headers = { Authorization: `Bearer ${token}` }
    const loadPhoto = async () => {
      const accountResponse = await fetch(`${apiBase}/api/auth/me`, { headers })
      if (!accountResponse.ok) return
      const { user } = await accountResponse.json()
      if (!user?.profileImageKey) return
      const photoResponse = await fetch(`${apiBase}/api/profile/photo`, { headers })
      if (!photoResponse.ok) return
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = URL.createObjectURL(await photoResponse.blob())
      if (!cancelled) setPhotoUrl(objectUrl)
    }

    loadPhoto().catch(() => {
      if (!cancelled) setPhotoUrl(null)
    })
    window.addEventListener('doorstep-profile-photo-change', loadPhoto)
    return () => {
      cancelled = true
      window.removeEventListener('doorstep-profile-photo-change', loadPhoto)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [])

  return <span className={`profile-avatar ${className}`}>{photoUrl ? <img src={photoUrl} alt="" /> : <UserCircle size={size} />}</span>
}
