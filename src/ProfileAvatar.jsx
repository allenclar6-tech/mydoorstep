import { UserCircle } from 'lucide-react'
import { useProfilePhoto } from './account/profilePhoto'

/** The signed-in person's photo, from the shared store so every avatar shows the same picture. */
export function ProfileAvatar({ className = '', size = 24 }) {
  const photoUrl = useProfilePhoto()
  return <span className={`profile-avatar ${className}`}>{photoUrl ? <img src={photoUrl} alt="" /> : <UserCircle size={size} />}</span>
}
