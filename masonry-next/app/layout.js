import './globals.css'

export const metadata = {
  title: 'Pretext Masonry',
  description: 'A Next.js recreation of the Pretext masonry demo backed by SQLite.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
