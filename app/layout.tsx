import type { Metadata } from 'next'
import ThemeProvider from '@/app/components/ThemeProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'GenPop',
  description: 'The civic forum for everyone.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
