import AudioSilencer from '@/app/components/AudioSilencer'

export const metadata = { title: 'YouTube ToS Violation Response – Soundings' }

const BASE = 'https://earprint-six.vercel.app'

export default function YouTubeResponse() {
  return (
    <div className="min-h-screen bg-black text-white">
      <AudioSilencer />
      <div className="max-w-3xl mx-auto px-8 py-12">
        <a href="/docs" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">← Docs</a>

        <h1 className="text-3xl font-bold mt-6 mb-2">YouTube API — ToS Violations Response</h1>
        <p className="text-zinc-400 text-sm mb-2">Project Number: 390748913178 · API Client: Lean Software Development</p>
        <p className="text-zinc-400 text-sm mb-10">Report: V.1 · Response date: May 6, 2026</p>

        <p className="text-zinc-300 leading-relaxed mb-10">
          Thank you for the detailed review. We have addressed each violation below. All policy
          documents are now live and publicly accessible. Links below open directly to the relevant
          section of each document.
        </p>

        {/* Section D */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-1 text-zinc-100 border-b border-zinc-800 pb-2">
            D — Accessing YouTube API Services
          </h2>
          <p className="text-xs text-zinc-500 mb-4">Policy III.D.1c</p>

          <div className="bg-zinc-900 rounded-xl p-5">
            <p className="text-zinc-400 text-sm mb-3 italic">
              "[Confirm]: Please confirm if you use multiple project numbers for the given API Client."
            </p>
            <p className="text-zinc-200 leading-relaxed">
              We use a single Google Cloud project for this API client. The only project number
              associated with the Lean Software Development / Soundings API client is{' '}
              <strong className="text-white">390748913178</strong>. No other project numbers are in use
              for this application.
            </p>
          </div>
        </section>

        {/* Section A */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-1 text-zinc-100 border-b border-zinc-800 pb-2">
            A — API Client Terms of Use and Privacy Policies
          </h2>

          {/* III.A.1 */}
          <div className="mt-6">
            <p className="text-xs text-zinc-500 mb-1">Policy III.A.1</p>
            <p className="text-zinc-400 text-sm italic mb-3">
              "API Clients did not state in their own terms of use that, by using those API Clients,
              users are agreeing to be bound by the YouTube Terms of Service."
            </p>
            <div className="bg-zinc-900 rounded-xl p-5">
              <p className="text-zinc-200 leading-relaxed">
                <strong className="text-white">Resolved.</strong> Our Terms of Use now explicitly states:{' '}
                <em>"By using Soundings, you agree to be bound by the YouTube Terms of Service."</em>
              </p>
              <p className="mt-3">
                <a
                  href={`${BASE}/terms#youtube-tos`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 underline text-sm"
                >
                  {BASE}/terms#youtube-tos
                </a>
              </p>
            </div>
          </div>

          {/* III.A.2a */}
          <div className="mt-6">
            <p className="text-xs text-zinc-500 mb-1">Policy III.A.2a</p>
            <p className="text-zinc-400 text-sm italic mb-3">
              "API Client do not have a privacy policy."
            </p>
            <div className="bg-zinc-900 rounded-xl p-5">
              <p className="text-zinc-200 leading-relaxed">
                <strong className="text-white">Resolved.</strong> A privacy policy has been published.
              </p>
              <p className="mt-3">
                <a
                  href={`${BASE}/privacy`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 underline text-sm"
                >
                  {BASE}/privacy
                </a>
              </p>
            </div>
          </div>

          {/* III.A.2b */}
          <div className="mt-6">
            <p className="text-xs text-zinc-500 mb-1">Policy III.A.2b</p>
            <p className="text-zinc-400 text-sm italic mb-3">
              "The privacy policy does not notify users that the API Client uses YouTube API Services."
            </p>
            <div className="bg-zinc-900 rounded-xl p-5">
              <p className="text-zinc-200 leading-relaxed">
                <strong className="text-white">Resolved.</strong> The "YouTube API Services" section of
                our privacy policy explicitly notifies users that Soundings uses the YouTube API Services
                for music search and playback.
              </p>
              <p className="mt-3">
                <a
                  href={`${BASE}/privacy#youtube-api`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 underline text-sm"
                >
                  {BASE}/privacy#youtube-api
                </a>
              </p>
            </div>
          </div>

          {/* III.A.2c */}
          <div className="mt-6">
            <p className="text-xs text-zinc-500 mb-1">Policy III.A.2c</p>
            <p className="text-zinc-400 text-sm italic mb-3">
              "In the privacy policy there is no reference and link to the Google Privacy Policy at
              http://www.google.com/policies/privacy."
            </p>
            <div className="bg-zinc-900 rounded-xl p-5">
              <p className="text-zinc-200 leading-relaxed">
                <strong className="text-white">Resolved.</strong> The YouTube API Services section now
                includes a direct link to the Google Privacy Policy at{' '}
                <a
                  href="http://www.google.com/policies/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-300 underline"
                >
                  google.com/policies/privacy
                </a>
                .
              </p>
              <p className="mt-3">
                <a
                  href={`${BASE}/privacy#youtube-api`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 underline text-sm"
                >
                  {BASE}/privacy#youtube-api
                </a>
              </p>
            </div>
          </div>

          {/* III.A.2d */}
          <div className="mt-6">
            <p className="text-xs text-zinc-500 mb-1">Policy III.A.2d</p>
            <p className="text-zinc-400 text-sm italic mb-3">
              "The privacy policy does not explain to users what user information, including API Data
              relating to users, the API Client accesses, collects, stores and otherwise uses."
            </p>
            <div className="bg-zinc-900 rounded-xl p-5">
              <p className="text-zinc-200 leading-relaxed">
                <strong className="text-white">Resolved.</strong> The "Information We Collect" section
                enumerates all data the application accesses, with an explicit distinction between data
                stored only on the user's device (play history, ratings, preferences — never transmitted
                to our servers) and data that passes through our servers (search queries forwarded to
                YouTube, transient technical logs).
              </p>
              <p className="mt-3">
                <a
                  href={`${BASE}/privacy#data-collected`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 underline text-sm"
                >
                  {BASE}/privacy#data-collected
                </a>
              </p>
            </div>
          </div>

          {/* III.A.2e */}
          <div className="mt-6">
            <p className="text-xs text-zinc-500 mb-1">Policy III.A.2e</p>
            <p className="text-zinc-400 text-sm italic mb-3">
              "The privacy policy does not explain how the API Client uses, processes, and shares the
              user's information, including how the information is shared with either internal or
              external parties."
            </p>
            <div className="bg-zinc-900 rounded-xl p-5">
              <p className="text-zinc-200 leading-relaxed">
                <strong className="text-white">Resolved.</strong> The "How We Use Your Information" and
                "Data Sharing" sections describe usage (operating the service, fulfilling API requests,
                session management, debugging) and sharing (only with YouTube and Spotify APIs to fulfill
                user requests; no sharing with advertisers, brokers, or analytics providers).
              </p>
              <p className="mt-3 flex flex-wrap gap-4">
                <a
                  href={`${BASE}/privacy#data-use`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 underline text-sm"
                >
                  {BASE}/privacy#data-use
                </a>
                <a
                  href={`${BASE}/privacy#data-sharing`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 underline text-sm"
                >
                  {BASE}/privacy#data-sharing
                </a>
              </p>
            </div>
          </div>

          {/* III.A.2g */}
          <div className="mt-6">
            <p className="text-xs text-zinc-500 mb-1">Policy III.A.2g</p>
            <p className="text-zinc-400 text-sm italic mb-3">
              "The privacy policy does not disclose that the API Client stores, accesses or collects
              (or allows third parties to do so) information directly or indirectly on or from users'
              devices, including by placing, accessing or recognizing cookies or similar technology on
              users' devices or browsers."
            </p>
            <div className="bg-zinc-900 rounded-xl p-5">
              <p className="text-zinc-200 leading-relaxed">
                <strong className="text-white">Resolved.</strong> The "Cookies and Local Storage" section
                discloses use of HTTP cookies (Spotify session token), localStorage (play history,
                ratings, and preferences — the primary personalization store), and sessionStorage
                (temporary state). It also notes that YouTube and Spotify may set their own cookies.
              </p>
              <p className="mt-3">
                <a
                  href={`${BASE}/privacy#cookies`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 underline text-sm"
                >
                  {BASE}/privacy#cookies
                </a>
              </p>
            </div>
          </div>

          {/* III.A.2i */}
          <div className="mt-6">
            <p className="text-xs text-zinc-500 mb-1">Policy III.A.2i</p>
            <p className="text-zinc-400 text-sm italic mb-3">
              "API Client does not provide Contact Information."
            </p>
            <div className="bg-zinc-900 rounded-xl p-5">
              <p className="text-zinc-200 leading-relaxed">
                <strong className="text-white">Resolved.</strong> Contact information (email and GitHub
                issues) is now provided at the bottom of the privacy policy.
              </p>
              <p className="mt-3">
                <a
                  href={`${BASE}/privacy#contact`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-red-400 hover:text-red-300 underline text-sm"
                >
                  {BASE}/privacy#contact
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* Section F */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-1 text-zinc-100 border-b border-zinc-800 pb-2">
            F — User Experience / Branding
          </h2>
          <p className="text-xs text-zinc-500 mb-4">Policy III.F.2a,b</p>

          <div className="bg-zinc-900 rounded-xl p-5">
            <p className="text-zinc-400 text-sm italic mb-3">
              "YouTube logos and icons below do not follow our Branding guidelines… Kindly make changes
              to the YouTube icon color combination of 'Red and White' or 'Black and White'."
            </p>
            <p className="text-zinc-200 leading-relaxed">
              <strong className="text-white">Resolved.</strong> The YouTube icon on the Soundings landing
              page has been updated to use the approved Red and White color combination: a red (
              <code className="text-zinc-400">#FF0000</code>) rounded rectangle background with a white (
              <code className="text-zinc-400">#FFFFFF</code>) play triangle, rendered as two separate SVG
              paths per YouTube's branding guidelines.
            </p>
          </div>
        </section>

        <p className="text-zinc-500 text-sm border-t border-zinc-800 pt-8">
          All changes are live at{' '}
          <a href={BASE} target="_blank" rel="noopener noreferrer" className="text-zinc-300 underline">
            {BASE}
          </a>
          . Please let us know if any further action is required.
        </p>
      </div>
    </div>
  )
}
