import AudioSilencer from '@/app/components/AudioSilencer'

export const metadata = { title: 'Terms of Use – Soundings' }

export default function TermsOfUse() {
  return (
    <div className="min-h-screen bg-black text-white">
      <AudioSilencer />
      <div className="max-w-3xl mx-auto px-8 py-12">
        <a href="/" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">← Home</a>

        <h1 className="text-3xl font-bold mt-6 mb-2">Terms of Use</h1>
        <p className="text-zinc-400 text-sm mb-10">Last updated: May 6, 2026</p>

        <section id="acceptance" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Acceptance of Terms</h2>
          <p className="text-zinc-300 leading-relaxed">
            By using Soundings (formerly Earprint), you agree to these Terms of Use. If you do not agree, please do not
            use the service.
          </p>
        </section>

        <section id="youtube-tos" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">YouTube Terms of Service</h2>
          <p className="text-zinc-300 leading-relaxed mb-3">
            Soundings uses the YouTube API Services to provide music search and playback features.{' '}
            <strong className="text-white">
              By using Soundings, you agree to be bound by the{' '}
              <a
                href="https://www.youtube.com/t/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-400 hover:text-red-300 underline"
              >
                YouTube Terms of Service
              </a>
              .
            </strong>
          </p>
          <p className="text-zinc-300 leading-relaxed">
            YouTube's terms govern your use of YouTube content accessed through Soundings, including
            restrictions on downloading, reproducing, or redistributing content.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Spotify Terms of Service</h2>
          <p className="text-zinc-300 leading-relaxed">
            If you log in with Spotify, you also agree to the{' '}
            <a
              href="https://www.spotify.com/legal/end-user-agreement/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-300 underline"
            >
              Spotify Terms of Service
            </a>
            . Use of the Spotify integration requires a Spotify Premium account.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Permitted Use</h2>
          <p className="text-zinc-300 leading-relaxed mb-3">
            Soundings is provided for personal, non-commercial music discovery. You may not:
          </p>
          <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-2">
            <li>Use Soundings to download, record, or redistribute copyrighted content.</li>
            <li>Attempt to circumvent API rate limits or access controls.</li>
            <li>Use Soundings in any way that violates applicable law or the terms of YouTube or Spotify.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Disclaimer of Warranties</h2>
          <p className="text-zinc-300 leading-relaxed">
            Soundings is provided "as is" without warranties of any kind. We do not guarantee
            uninterrupted availability or that search results will meet your expectations. API
            availability is subject to YouTube's and Spotify's own uptime and quota limits.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Limitation of Liability</h2>
          <p className="text-zinc-300 leading-relaxed">
            To the fullest extent permitted by law, Soundings and its creator shall not be liable for
            any indirect, incidental, or consequential damages arising from your use of the service.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Changes to These Terms</h2>
          <p className="text-zinc-300 leading-relaxed">
            We may update these terms from time to time. Continued use of Soundings after changes
            constitutes acceptance of the updated terms.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Contact</h2>
          <p className="text-zinc-300 leading-relaxed">
            Questions about these terms:{' '}
            <a href="mailto:john.leansoftware@gmail.com" className="text-zinc-100 hover:text-white underline">
              john.leansoftware@gmail.com
            </a>
          </p>
        </section>
      </div>
    </div>
  )
}
