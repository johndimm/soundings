'use client'

import { useState } from 'react'

export default function RequestAccessForm() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    try {
      const res = await fetch('/api/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setStatus(res.ok ? 'sent' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return <p className="text-zinc-400 text-sm">Request sent — you&apos;ll hear back soon.</p>
  }

  return (
    <form onSubmit={submit} className="flex flex-col items-center gap-2 w-full">
      <p className="text-zinc-500 text-xs">Request Spotify access</p>
      <div className="flex gap-2 w-full">
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={status === 'sending'}
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors"
        >
          {status === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </div>
      {status === 'error' && <p className="text-red-400 text-xs">Something went wrong. Try again.</p>}
    </form>
  )
}
