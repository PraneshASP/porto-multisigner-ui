import './globals.css';
import { Providers } from '@/lib/wagmi';
import { Geist, Geist_Mono } from 'next/font/google'
const geist = Geist_Mono({
  subsets: ['latin'],
})
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={geist.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}