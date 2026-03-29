import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import PlayerClientWrapper from './PlayerClientWrapper'

export default async function PlayerPage() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('spotify_access_token')?.value

  if (!accessToken) {
    redirect('/')
  }

  return <PlayerClientWrapper accessToken={accessToken!} />
}
