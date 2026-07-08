'use client'

import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Expose setter via a data attribute so future phases can wire a toggle
  // without threading props. Remove when a real toggle UI exists.
  useEffect(() => {
    (window as Window & { __setTheme?: (t: Theme) => void }).__setTheme = setTheme
    return () => { delete (window as Window & { __setTheme?: (t: Theme) => void }).__setTheme }
  }, [setTheme])

  return <>{children}</>
}
