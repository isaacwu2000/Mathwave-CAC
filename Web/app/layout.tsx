import type { Metadata } from 'next';
import './globals.css';
import { picoIcon } from '@/components/ui/pico-icon';
export const metadata: Metadata = {
  title: 'Mathwave',
  icons: { icon: picoIcon },
  description:
    'A voice-controlled math worksheet for dyslexic students. Speak, explore, and revise equations, graphs, data, and diagrams.',
  metadataBase: new URL('https://math-audio.rare-olm-9650.chatgpt.site'),
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {process.env.NODE_ENV === 'development' && (
          <script type="module" async src="/@mathwave/dev-instance.js" />
        )}
        <div
          hidden
          dangerouslySetInnerHTML={{
            __html:
              '<!-- THESIS: A student-controlled voice worksheet. OWN-WORLD: Instrument Sans, STIX math, white, red, peach, layered shadows. STORY: Speak, review, revise; retain later branches. FIRST VIEWPORT: Account left, audio and Pico right, centered equations, graph alongside. FORM: User-approved Figma/Paper Instrument Sans composition; seed not applicable. -->',
          }}
        />
        {children}
      </body>
    </html>
  );
}
