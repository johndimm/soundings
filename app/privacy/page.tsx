import AudioSilencer from '@/app/components/AudioSilencer'

export const metadata = { title: 'Privacy Policy – Soundings' }

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-black text-white">
      <AudioSilencer />
      <div className="max-w-3xl mx-auto px-8 py-12">
        <a href="/" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">← Home</a>

        <h1 className="text-3xl font-bold mt-6 mb-2">Privacy Policy</h1>
        <p className="text-zinc-400 text-sm mb-10">Last updated: May 6, 2026</p>

        <section id="overview" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Overview</h2>
          <p className="text-zinc-300 leading-relaxed mb-3">
            Soundings (formerly Earprint) ("we", "us", "our") is a music discovery application that
            learns your taste from your listening and rating history. This policy explains what
            information is collected, where it lives, how it is used, and your rights over it.
          </p>
          <p className="text-zinc-300 leading-relaxed">
            <strong className="text-white">The short version:</strong> your personal data — ratings,
            listening history, and preferences — never leaves your device. It is stored exclusively in
            your browser's localStorage. We have no user accounts and no server-side database of user
            data.
          </p>
        </section>

        <section id="no-accounts" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">No User Accounts</h2>
          <p className="text-zinc-300 leading-relaxed mb-3">
            Soundings does not require you to create an account. There is no sign-up, no username, and
            no password for the application itself.
          </p>
          <p className="text-zinc-300 leading-relaxed">
            The one exception is <strong className="text-white">Spotify</strong>: if you choose to use
            Spotify as your music source, you will be asked to log in with your existing Spotify account
            via OAuth. That login is handled entirely by Spotify — Soundings receives only a temporary
            access token and never sees your Spotify password. YouTube mode requires no login at all.
          </p>
        </section>

        <section id="local-data" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Your Listening History and Ratings</h2>
          <p className="text-zinc-300 leading-relaxed mb-3">
            Soundings uses your activity to recommend music it thinks you will find interesting. Your
            play history and ratings are stored in your browser's localStorage. To generate
            recommendations, a summary of your listening history is sent to a language model through
            our backend. This data is used solely to produce your recommendations and is not stored
            on our servers or shared with any third party beyond the language model provider.
          </p>
          <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-2">
            <li>
              <strong className="text-white">Play history:</strong> Tracks you have played or skipped,
              used to surface new recommendations.
            </li>
            <li>
              <strong className="text-white">Ratings:</strong> Explicit thumbs-up/thumbs-down or
              star ratings you assign to tracks, artists, or albums.
            </li>
            <li>
              <strong className="text-white">Preferences:</strong> Settings such as your preferred music
              source (Spotify or YouTube) and UI options.
            </li>
          </ul>
          <p className="text-zinc-300 leading-relaxed mt-3">
            Because this data lives only in your browser, clearing your browser's site data or
            switching browsers will remove it. Soundings has no way to restore it.
          </p>
        </section>

        <section id="data-export" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Exporting Your Data</h2>
          <p className="text-zinc-300 leading-relaxed">
            You can download a complete copy of your ratings and listening history at any time as a
            JSON file from the app settings. This gives you full portability of your data —
            you own it and can inspect, back up, or delete it freely.
          </p>
        </section>

        <section id="youtube-api" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">YouTube API Services</h2>
          <p className="text-zinc-300 leading-relaxed mb-3">
            Soundings uses the <strong className="text-white">YouTube API Services</strong> to search for
            and play music videos. By using Soundings's YouTube mode, you are also subject to Google's
            terms and privacy policy:
          </p>
          <ul className="list-disc list-inside text-zinc-300 space-y-1 ml-2">
            <li>
              <a
                href="https://www.youtube.com/t/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-400 hover:text-red-300 underline"
              >
                YouTube Terms of Service
              </a>
            </li>
            <li>
              <a
                href="http://www.google.com/policies/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-red-400 hover:text-red-300 underline"
              >
                Google Privacy Policy
              </a>
            </li>
          </ul>
          <p className="text-zinc-400 text-sm mt-3">
            You can revoke Soundings's access to YouTube data via the{' '}
            <a
              href="https://security.google.com/settings/security/permissions"
              target="_blank"
              rel="noopener noreferrer"
              className="text-red-400 hover:text-red-300 underline"
            >
              Google security settings page
            </a>
            .
          </p>
        </section>

        <section id="data-collected" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Information We Collect</h2>
          <p className="text-zinc-300 leading-relaxed mb-3">
            We distinguish between data that stays on your device and technical data our servers may briefly see:
          </p>
          <p className="text-sm font-medium text-zinc-400 mb-2 mt-4">Stored only on your device</p>
          <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-2 mb-6">
            <li>Play history, ratings, and listening preferences (localStorage)</li>
            <li>UI settings and playback state (localStorage / sessionStorage)</li>
            <li>Spotify access token (browser cookie, scoped to this domain)</li>
          </ul>
          <p className="text-sm font-medium text-zinc-400 mb-2">Sent to our backend (not stored)</p>
          <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-2">
            <li>
              <strong className="text-white">Listening history summary:</strong> To generate
              recommendations, a summary of your play history and ratings is sent to a language model
              through our backend. This is used only to produce your recommendations and is not
              retained on our servers.
            </li>
            <li>
              <strong className="text-white">YouTube API search queries:</strong> Your search terms are
              forwarded to the YouTube Data API to return results. We do not log or store them.
            </li>
            <li>
              <strong className="text-white">Technical request logs:</strong> Standard web server logs
              (timestamps, HTTP status codes, IP addresses) may be retained briefly for debugging and
              are then deleted. They contain no music preference data.
            </li>
          </ul>
        </section>

        <section id="data-use" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">How We Use Your Information</h2>
          <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-2">
            <li>Your local history and ratings are used entirely on your device to personalize recommendations.</li>
            <li>Search queries are forwarded to YouTube or Spotify solely to fulfill your request.</li>
            <li>Your Spotify token is used to authenticate playback API calls on your behalf.</li>
            <li>Technical logs are used only for debugging and are not linked to any individual.</li>
          </ul>
          <p className="text-zinc-300 leading-relaxed mt-3">
            We do not sell, rent, or trade your information. We do not use your data for advertising.
            No user profiling is done on our servers.
          </p>
        </section>

        <section id="cookies" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Cookies and Local Storage</h2>
          <p className="text-zinc-300 leading-relaxed mb-3">
            Soundings stores information on your device using:
          </p>
          <ul className="list-disc list-inside text-zinc-300 space-y-2 ml-2">
            <li>
              <strong className="text-white">HTTP cookies:</strong> Used only to store your Spotify
              authentication token. Scoped to this domain; not used for cross-site tracking.
            </li>
            <li>
              <strong className="text-white">localStorage:</strong> Used to store your play history,
              ratings, and preferences. This is the primary store for all personalization data and
              never leaves your browser.
            </li>
            <li>
              <strong className="text-white">sessionStorage:</strong> Used for temporary state such as
              pending share links. Cleared when you close the tab.
            </li>
          </ul>
          <p className="text-zinc-300 leading-relaxed mt-3">
            Soundings itself places no third-party tracking cookies. YouTube and Spotify may set their
            own cookies when their players or auth flows are active, subject to their own privacy policies.
          </p>
        </section>

        <section id="data-sharing" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Data Sharing</h2>
          <p className="text-zinc-300 leading-relaxed">
            Search and playback requests are forwarded to the YouTube Data API and/or Spotify Web API
            to fulfill what you asked for. No other sharing occurs. We do not share any data with
            analytics providers, advertisers, or data brokers.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Data Retention</h2>
          <p className="text-zinc-300 leading-relaxed">
            Your personal data (history, ratings, preferences) persists in your browser's localStorage
            until you clear it or use the in-app delete option. We hold no copy of it. Server-side
            technical logs are retained briefly for debugging and then deleted. Spotify session cookies
            expire when the token expires or you log out.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Beta Notice — Future Changes</h2>
          <p className="text-zinc-300 leading-relaxed">
            Soundings is currently in beta. If the beta is successful, we plan to offer optional user
            accounts. At that point, users who choose to create an account would be able to store their
            ratings on our servers (for backup and cross-device access) and, in aggregate and anonymised
            form, ratings may be used to improve recommendations for all users. Any such change will be
            announced in advance, will require explicit opt-in, and this policy will be updated to
            reflect it.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Children's Privacy</h2>
          <p className="text-zinc-300 leading-relaxed">
            Soundings is not directed at children under 13. We do not knowingly collect personal
            information from children.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Changes to This Policy</h2>
          <p className="text-zinc-300 leading-relaxed">
            We may update this policy from time to time. Material changes will be reflected by an
            updated date at the top of this page.
          </p>
        </section>

        <section id="contact" className="mb-10">
          <h2 className="text-lg font-semibold mb-3 text-zinc-100 border-b border-zinc-800 pb-2">Contact</h2>
          <p className="text-zinc-300 leading-relaxed">
            Questions or concerns about this privacy policy can be directed to:
          </p>
          <ul className="list-disc list-inside text-zinc-300 space-y-1 mt-2 ml-2">
            <li>
              Email:{' '}
              <a href="mailto:john.leansoftware@gmail.com" className="text-zinc-100 hover:text-white underline">
                john.leansoftware@gmail.com
              </a>
            </li>
            <li>
              GitHub:{' '}
              <a
                href="https://github.com/johndimm/film-and-music/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-100 hover:text-white underline"
              >
                github.com/johndimm/film-and-music/issues
              </a>
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}
