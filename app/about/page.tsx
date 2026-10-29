import Link from 'next/link';

const GARDEN_URL = 'https://johndimm.org';
const GITHUB_URL = 'https://github.com/johndimm/soundings';

export const metadata = {
  title: 'About · Soundings',
  description: 'Music discovery that learns your taste',
};

const wrap: React.CSSProperties = { minHeight: '100vh', background: '#000', color: '#e5e5e5', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' };
const bar: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid #202024' };
const iconBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #2a2a2e', background: '#151517', color: '#a1a1aa', borderRadius: 10, padding: '8px 12px', fontSize: 13, textDecoration: 'none' };
const main: React.CSSProperties = { maxWidth: 680, margin: '0 auto', padding: '56px 24px' };
const tag: React.CSSProperties = { border: '1px solid #26262a', background: '#141416', color: '#c4c4c8', borderRadius: 8, padding: '6px 12px', fontSize: 13 };

export default function About() {
  return (
    <div style={wrap}>
      <div style={bar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a href={GARDEN_URL} title="All apps — John Dimm" style={iconBtn} aria-label="All apps">🏠</a>
          <span style={{ fontSize: 17, fontWeight: 600, color: '#fff' }}>Soundings</span>
        </div>
        <Link href="/" style={iconBtn}>Open app ↗</Link>
      </div>
      <main style={main}>
        <h1 style={{ fontSize: 34, fontWeight: 700, color: '#fff', margin: 0 }}>Soundings</h1>
        <p style={{ fontSize: 18, color: '#a1a1aa', marginTop: 10 }}>Music discovery that learns your taste</p>
        <div style={{ marginTop: 28, fontSize: 15.5, lineHeight: 1.6, color: '#d4d4d8', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p>Soundings picks a song, plays it for you, and watches your reaction to learn the boundary between your likes and dislikes. Instead of asking you to rate a long list up front, it feels its way toward your taste one track at a time, taking soundings the way a ship measures the depth of unfamiliar water.</p>
          <p>It plays through Spotify for signed-in Spotify users and falls back to YouTube for everyone else, so you can start listening without an account. A language model proposes the next song based on what you have kept and skipped, gradually mapping the coastline between the music you want and the music you don&apos;t.</p>
        </div>
        <div style={{ marginTop: 30 }}>
          <h2 style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717a' }}>Built with</h2>
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['React / Next.js', 'Spotify', 'YouTube', 'LLM'].map((t) => (<span key={t} style={tag}>{t}</span>))}
          </div>
        </div>
        <div style={{ marginTop: 36, paddingTop: 22, borderTop: '1px solid #202024', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20, fontSize: 14 }}>
          <Link href="/" style={{ background: '#f4f4f5', color: '#18181b', fontWeight: 600, borderRadius: 10, padding: '10px 18px', textDecoration: 'none' }}>Open Soundings ↗</Link>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#a1a1aa', textDecoration: 'none' }}>GitHub</a>
          <a href={GARDEN_URL} style={{ marginLeft: 'auto', color: '#71717a', textDecoration: 'none' }}>← All apps</a>
        </div>
      </main>
    </div>
  );
}
