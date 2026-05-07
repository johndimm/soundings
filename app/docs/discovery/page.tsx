export const metadata = { title: 'How Discovery Works – Soundings' }

export default function DiscoveryPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto px-8 py-12">
        <a href="/docs" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">← Docs</a>

        <h1 className="text-3xl font-bold mt-6 mb-2">How Discovery Works</h1>
        <p className="text-zinc-400 text-sm mb-10">
          Soundings (formerly Earprint) uses a prompt to get started — but it works very differently from Spotify's playlist generator.
        </p>

        <section id="vs-spotify" className="mb-12">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">
            How is this different from Spotify's "make me a playlist"?
          </h2>
          <p className="text-zinc-300 leading-relaxed mb-4">
            Spotify's prompt-to-playlist feature generates a static list of tracks from a single
            natural-language request. You describe what you want, you get a playlist, and you listen
            to it.
          </p>
          <p className="text-zinc-300 leading-relaxed mb-4">
            Soundings works differently in three ways: the interaction model, how recommendations are
            tuned over time, and who controls your data.
          </p>
        </section>

        <section id="interaction" className="mb-12">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">
            Interaction model — just click Next
          </h2>
          <p className="text-zinc-300 leading-relaxed mb-4">
            There is no playlist to browse. Soundings surfaces one track at a time. When the current
            track ends — or whenever you want — you click <strong className="text-white">Next</strong>
            and the app finds the next recommendation based on everything it knows about your taste so
            far.
          </p>
          <p className="text-zinc-300 leading-relaxed mb-4">
            Tracks are pushed to you rather than chosen from a list. This keeps the experience low-friction:
            you are not scrolling through options, second-guessing yourself, or managing a queue.
            You just listen, react, and move on.
          </p>
          <p className="text-zinc-300 leading-relaxed">
            Your reactions — implicit (did you skip it immediately?) and explicit (did you give it a
            thumbs up?) — are used to shape what comes next.
          </p>
        </section>

        <section id="tuning" className="mb-12">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">
            Tuning — the prompt is just the starting point
          </h2>
          <p className="text-zinc-300 leading-relaxed mb-4">
            A Spotify playlist generated from a prompt is static. The prompt is a one-shot instruction
            and the result doesn't change based on how you respond to the tracks.
          </p>
          <p className="text-zinc-300 leading-relaxed mb-4">
            In Soundings, the text prompt you enter is only the seed. Every subsequent recommendation
            request includes a summary of your ratings and listening history alongside the original
            prompt. As you rate tracks, the language model has more to work with — it can identify
            artists and styles you like, avoid things you skipped or disliked, and explore adjacent
            territory.
          </p>
          <p className="text-zinc-300 leading-relaxed">
            The app also uses key tracks — songs you rated highly — to directly probe for related
            artists and works, not just rely on descriptive text.
          </p>
        </section>

        <section id="control" className="mb-12">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">
            Control — you own your data
          </h2>
          <p className="text-zinc-300 leading-relaxed mb-4">
            Soundings stores your ratings and listening history exclusively in your browser's
            localStorage. There are no user accounts and no server-side database of your preferences.
          </p>
          <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-2 mb-4">
            <li>
              <strong className="text-white">View it:</strong> Open your browser's developer tools
              and inspect localStorage, or use the export feature.
            </li>
            <li>
              <strong className="text-white">Edit it:</strong> You can delete individual ratings or
              clear the whole history at any time from the app settings.
            </li>
            <li>
              <strong className="text-white">Export it:</strong> Download a complete copy of your
              ratings and history as a JSON file. You own the data and can take it anywhere.
            </li>
          </ul>
          <p className="text-zinc-300 leading-relaxed">
            The only time any of this data leaves your device is when a summary is sent to the language
            model to generate your next recommendation — and even then, it is not stored on our servers.
            See the <a href="/privacy#local-data" className="text-zinc-300 underline hover:text-white">Privacy Policy</a> for
            full details.
          </p>
        </section>
      </div>
    </div>
  )
}
