import '../styles/globals.css'
import type { AppProps } from 'next/app'
import Head from 'next/head'
import { useEffect, useState } from 'react'
import { SolanaWalletAdapterProvider } from '../contexts/SolanaWalletAdapterProvider'
import { WalletProvider } from '../contexts/WalletContext'
import { PriceProvider } from '../contexts/PriceContext'
import { CrucibleProvider } from '../hooks/useCrucible'

export default function App({ Component, pageProps }: AppProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <>
      <Head>
        <link rel="icon" type="image/png" href="/favicon.png" />
      </Head>
      <div className="background-video-wrapper" aria-hidden="true">
        <video
          className="background-video"
          src="/background.mp4"
          autoPlay
          loop
          muted
          playsInline
        />
      </div>
      <SolanaWalletAdapterProvider>
        <WalletProvider>
          <PriceProvider>
            <CrucibleProvider>
              <div className="app-content">
                <Component {...pageProps} />
              </div>
            </CrucibleProvider>
          </PriceProvider>
        </WalletProvider>
      </SolanaWalletAdapterProvider>
    </>
  )
}
