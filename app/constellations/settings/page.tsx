'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppHeader from '@/app/components/AppHeader'
const CONSTELLATIONS_GEMINI_MODEL_KEY = "soundings-constellations-gemini-model";
const SOUNDINGS_CONSTELLATIONS_SAVED_KEY = "soundings-constellations-saved-v1";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_MODEL_OPTIONS: { value: string; label: string; sub: string }[] = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", sub: "fast · default" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", sub: "smarter · slower" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", sub: "older fast" },
];

export default function ConstellationsSettingsPage() {
  const router = useRouter()
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL)
  const [mounted, setMounted] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CONSTELLATIONS_GEMINI_MODEL_KEY)
      if (saved) setModel(saved)
    } catch {}
    setMounted(true)
  }, [])

  const handleModelChange = (value: string) => {
    setModel(value)
    try {
      localStorage.setItem(CONSTELLATIONS_GEMINI_MODEL_KEY, value)
    } catch {}
  }

  const handleClearGraph = () => {
    try {
      localStorage.removeItem(SOUNDINGS_CONSTELLATIONS_SAVED_KEY)
    } catch {}
    router.push('/constellations')
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-white text-black flex flex-col">
        <AppHeader />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-black flex flex-col">
      <AppHeader />

      <div className="flex-1 p-6 max-w-[800px] mx-auto w-full flex flex-col gap-10">

        <div className="flex items-center gap-3">
          <a
            href="/constellations"
            className="text-sm text-zinc-500 hover:text-black transition-colors"
          >
            ← Back to Graph
          </a>
          <h1 className="text-lg font-semibold">Graph Settings</h1>
        </div>

        <hr className="border-zinc-200" />

        {/* LLM Model */}
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">Graph Model</h2>
            <p className="text-xs text-zinc-500 mt-0.5">The Gemini model used to build the knowledge graph.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {GEMINI_MODEL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleModelChange(opt.value)}
                className={`px-4 py-2 rounded-lg border text-sm transition-colors ${
                  model === opt.value
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-zinc-600 border-zinc-300 hover:border-zinc-500 hover:text-black'
                }`}
              >
                {opt.label}
                <span className="ml-1.5 text-xs opacity-60">{opt.sub}</span>
              </button>
            ))}
          </div>
        </section>

        <hr className="border-zinc-200" />

        {/* Clear graph */}
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">Clear Graph</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Remove the saved graph from this browser. The graph will start fresh next time you open Graph.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => setClearConfirm(true)}
              className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition-colors"
            >
              Clear graph
            </button>
          </div>
        </section>

      </div>

      {clearConfirm && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={e => { if (e.target === e.currentTarget) setClearConfirm(false) }}
        >
          <div
            className="bg-white border border-zinc-200 rounded-xl p-6 max-w-sm w-full shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-2">Clear graph?</h3>
            <p className="text-sm text-zinc-500 mb-6">
              This removes the saved graph from your browser. You cannot undo this.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setClearConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-zinc-300 text-zinc-600 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClearGraph}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white"
              >
                Clear graph
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
