import React from 'react'
import { WalletButton } from './WalletButton'

const NAV_ITEMS = [
  { label: 'Demo', href: '/demo', active: false },
  { label: 'Lending', href: '/lending', active: false },
  { label: 'Crucibles', href: '#', active: true },
  { label: 'Heat', href: '#', active: false },
  { label: 'Sparks', href: '#', active: false },
  { label: 'Governance', href: '#', active: false },
]

export const Header: React.FC = () => {
  return (
    <header className="sticky top-0 z-50 px-4 pt-4">
      <div className="mx-auto max-w-7xl">
        <div className="relative">
          <div className="pointer-events-none absolute inset-x-6 -bottom-px h-px bg-gradient-to-r from-transparent via-fogo-primary/60 to-transparent opacity-70" />
          <div className="relative overflow-hidden rounded-2xl panel px-6 py-4">
            <div className="pointer-events-none absolute inset-0 opacity-60 mix-blend-screen bg-gradient-to-r from-fogo-primary/25 via-transparent to-fogo-secondary/25 blur-3xl" />
            <div className="pointer-events-none absolute -inset-x-40 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-60" />
            <div className="relative flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 rounded-xl bg-fogo-primary/30 blur-2xl opacity-60" />
                <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-black/50 shadow-[0_10px_25px_rgba(255,106,0,0.25)]">
                  <img
                    src="/forgo logo straight.png"
                    alt="Forge Logo"
                    className="h-7 w-7 object-contain transition-transform duration-300 group-hover:scale-110"
                  />
                </div>
              </div>
              <div className="flex flex-col">
                <span className="text-[0.65rem] uppercase tracking-[0.42em] text-fogo-gray-400 font-heading">
                  Forge Protocol
                </span>
                <h1 className="text-lg font-heading text-white">
                  Real Yield Infrastructure
                </h1>
              </div>
            </div>

              <nav className="hidden md:flex items-center gap-2">
                {NAV_ITEMS.map(({ label, href, active }) => (
                  <a
                    key={label}
                    href={href}
                    className={`relative inline-flex items-center justify-center rounded-xl px-5 py-2 transition-all duration-300 uppercase tracking-[0.2em] text-[0.7rem] font-heading border ${
                      active
                        ? 'bg-gradient-to-r from-fogo-primary to-fogo-primary-light text-white shadow-[0_10px_30px_rgba(255,106,0,0.35)] border-white/20'
                        : 'text-fogo-gray-300/90 border-white/10 hover:text-white hover:bg-white/10 hover:border-white/20'
                    }`}
                  >
                    {label}
                    {active && (
                      <span className="pointer-events-none absolute inset-x-3 bottom-1 h-px bg-white/50 opacity-60" />
                    )}
                  </a>
                ))}
              </nav>

              <div className="flex items-center gap-3">
                <WalletButton />
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
