import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fly Parking Lab · NeuroMechFly v2 × MaleCNS',
  description:
    'In-browser 3D bio-robotic simulation of Carla, a fruit fly driving a classic Mini Cooper with MaleCNS connectome and MuJoCo physics.',
  other: {
    'codex-preview': 'development',
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
