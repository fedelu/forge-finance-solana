import '../styles/globals.css'
import type { AppProps } from 'next/app'
import Head from 'next/head'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <link rel="icon" type="image/png" href="/forgo%20logo%20straight.png" />
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
      <div className="app-content">
        <Component {...pageProps} />
      </div>
    </>
  )
}
