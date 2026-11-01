import { useId } from 'react'

// Original DOORSTEP illustrations for categories (soft 3D style, drawn for DOORSTEP — not copied from any app).
// Every picture is a 64×64 SVG with a soft floor shadow, gradient bodies and a light highlight.

function Art({ children, label, defs }) {
  return <svg viewBox="0 0 64 64" width="100%" height="100%" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
    <defs>{defs}</defs>
    <ellipse cx="32" cy="57" rx="20" ry="3.4" fill="#0c261d" opacity=".14" />
    {children}
  </svg>
}
const lg = (id, from, to, x2 = 0, y2 = 1) => <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient>
const useIds = (...names) => { const base = useId().replace(/:/g, ''); return Object.fromEntries(names.map((name) => [name, `${base}${name}`])) }
const shine = (d) => <path d={d} fill="#fff" opacity=".45" />

export function Burger() {
  const i = useIds('bun', 'bunB', 'meat')
  return <Art defs={<>{lg(i.bun, '#ffcf6e', '#f29a2e')}{lg(i.bunB, '#f6b04a', '#d97a1c')}{lg(i.meat, '#8a4b2a', '#5a2c17')}</>}>
    <path d="M10 30c0-11 10-18 22-18s22 7 22 18z" fill={`url(#${i.bun})`} />
    {shine('M17 22c3-4 8-6 13-6-4 2-8 4-10 8z')}
    <g fill="#fff6dc"><ellipse cx="24" cy="21" rx="1.6" ry=".9" /><ellipse cx="33" cy="18" rx="1.6" ry=".9" /><ellipse cx="41" cy="22" rx="1.6" ry=".9" /></g>
    <path d="M8 32c4 3 7 0 10 3s6 0 9 3 6 0 9 3 6-3 9-1 7-2 11-8v3H8z" fill="#5bbf4a" />
    <rect x="9" y="34" width="46" height="5" rx="2.5" fill="#f2c230" />
    <rect x="9" y="37" width="46" height="8" rx="4" fill={`url(#${i.meat})`} />
    <path d="M11 45h42c0 5-4 8-9 8H20c-5 0-9-3-9-8z" fill={`url(#${i.bunB})`} />
  </Art>
}

export function Basket() {
  const i = useIds('b', 'h')
  return <Art defs={<>{lg(i.b, '#3fbf8f', '#13795a')}{lg(i.h, '#2a8f6b', '#145b43')}</>}>
    <circle cx="23" cy="22" r="8" fill="#ef4a3a" /><path d="M23 14c1-3 3-4 5-4-1 2-3 3-5 4z" fill="#4caf50" />
    <ellipse cx="39" cy="19" rx="5" ry="11" transform="rotate(25 39 19)" fill="#ffd23f" />
    <path d="M44 14l6-6 2 2-6 6z" fill="#7cc242" />
    <path d="M12 21c0-9 9-14 20-14s20 5 20 14" fill="none" stroke={`url(#${i.h})`} strokeWidth="3.4" strokeLinecap="round" />
    <path d="M7 27h50l-5 24c-.6 2.6-2.8 4-5.4 4H17.4c-2.6 0-4.8-1.4-5.4-4z" fill={`url(#${i.b})`} />
    <path d="M7 27h50v4H7z" fill="#0f6a4d" opacity=".35" />
    <g stroke="#e8fff5" strokeOpacity=".5" strokeWidth="2" strokeLinecap="round"><path d="M20 35v13" /><path d="M32 35v13" /><path d="M44 35v13" /></g>
  </Art>
}

export function ShoppingBag() {
  const i = useIds('b', 's')
  return <Art defs={<>{lg(i.b, '#7aa8ff', '#3c64d8')}{lg(i.s, '#ff8fb1', '#e0457a')}</>}>
    <path d="M38 24h16l2 29H36z" fill={`url(#${i.s})`} />
    <path d="M41 24c0-6 2-9 5-9s5 3 5 9" fill="none" stroke="#b8315f" strokeWidth="2.4" />
    <path d="M10 20h30l3 34H7z" fill={`url(#${i.b})`} />
    {shine('M12 22h5l-2 30h-5z')}
    <path d="M17 22c0-8 3-12 8-12s8 4 8 12" fill="none" stroke="#2b4aa8" strokeWidth="3" strokeLinecap="round" />
    <circle cx="17" cy="23" r="1.8" fill="#1e3a8a" /><circle cx="33" cy="23" r="1.8" fill="#1e3a8a" />
    <path d="M18 38l4 4 9-9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </Art>
}

export function Pharmacy() {
  const i = useIds('box', 'pill', 'lip')
  return <Art defs={<>{lg(i.box, '#ffffff', '#dfe8ee')}{lg(i.pill, '#ff7a8a', '#d93a54')}{lg(i.lip, '#ff5f8f', '#c21d55')}</>}>
    <rect x="8" y="20" width="30" height="34" rx="5" fill={`url(#${i.box})`} stroke="#c9d6de" />
    <rect x="11" y="14" width="24" height="8" rx="3" fill="#2fae7f" />
    <path d="M20 31h6v6h6v6h-6v6h-6v-6h-6v-6h6z" fill="#2fae7f" transform="translate(0 -3)" />
    <g transform="rotate(-35 46 40)"><rect x="37" y="33" width="20" height="10" rx="5" fill="#fff" stroke="#e3c7cd" /><path d="M47 33h5a5 5 0 010 10h-5z" fill={`url(#${i.pill})`} /></g>
    <rect x="44" y="12" width="9" height="14" rx="2" fill={`url(#${i.lip})`} />
    <rect x="43" y="25" width="11" height="11" rx="2" fill="#2b2b3a" />
    {shine('M46 13h2v11h-2z')}
  </Art>
}

export function Parcel() {
  const i = useIds('t', 'f', 's')
  return <Art defs={<>{lg(i.t, '#f6c27a', '#e39b45')}{lg(i.f, '#e29a4a', '#b8702b')}{lg(i.s, '#cf8a3c', '#9a5a1f')}</>}>
    <path d="M32 8l22 10-22 10-22-10z" fill={`url(#${i.t})`} />
    <path d="M10 18l22 10v26L10 44z" fill={`url(#${i.f})`} />
    <path d="M54 18L32 28v26l22-10z" fill={`url(#${i.s})`} />
    <path d="M21 13l22 10v8l-5 2v-8L16 15z" fill="#fff3d8" opacity=".9" />
    <path d="M38 41l10-4v4l-10 4z" fill="#fff" opacity=".55" />
    <circle cx="51" cy="12" r="7" fill="#123d2d" /><path d="M47.5 12l2.5 2.5 4.5-5" fill="none" stroke="#ffc244" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Art>
}

export function PercentTag() {
  const i = useIds('t')
  return <Art defs={lg(i.t, '#ffd45e', '#f29f0d')}>
    <path d="M30 8h20a4 4 0 014 4v20L32 54a4 4 0 01-5.7 0L10 37.7a4 4 0 010-5.7z" fill={`url(#${i.t})`} />
    <circle cx="45" cy="17" r="3.6" fill="#fff" />
    <g fill="#7a4a00"><circle cx="27" cy="31" r="3.2" /><circle cx="37" cy="41" r="3.2" /><path d="M24 44l17-17 2.4 2.4-17 17z" /></g>
    {shine('M31 11h10l-14 14-4-4z')}
  </Art>
}

export function Compass() {
  const i = useIds('c')
  return <Art defs={lg(i.c, '#3fbf8f', '#13795a')}>
    <circle cx="32" cy="30" r="22" fill={`url(#${i.c})`} /><circle cx="32" cy="30" r="17" fill="#e9fbf2" />
    <path d="M32 15l5 15h-10z" fill="#ef4a3a" /><path d="M32 45l-5-15h10z" fill="#123d2d" /><circle cx="32" cy="30" r="3" fill="#ffc244" />
  </Art>
}

// Food sub-categories ----------------------------------------------------------------------------------------------
export function Jollof() {
  const i = useIds('p', 'r')
  return <Art defs={<>{lg(i.p, '#ffffff', '#dde5e9')}{lg(i.r, '#ff8a3d', '#d4471b')}</>}>
    <ellipse cx="32" cy="40" rx="26" ry="11" fill={`url(#${i.p})`} />
    <path d="M12 38c0-9 9-16 20-16s20 7 20 16c-6 4-34 4-40 0z" fill={`url(#${i.r})`} />
    <g fill="#ffd9a8" opacity=".8"><circle cx="20" cy="33" r="1.2" /><circle cx="27" cy="28" r="1.2" /><circle cx="35" cy="30" r="1.2" /><circle cx="42" cy="34" r="1.2" /><circle cx="31" cy="35" r="1.2" /></g>
    <path d="M38 24c4-4 10-3 12 1-3 3-8 4-12-1z" fill="#c8722d" /><circle cx="14" cy="36" r="3.2" fill="#3fa34d" /><circle cx="50" cy="38" r="3" fill="#f2c230" />
  </Art>
}
export function Soup() {
  const i = useIds('b', 's')
  return <Art defs={<>{lg(i.b, '#6b4a3a', '#3e2a20')}{lg(i.s, '#f0a33c', '#c96f12')}</>}>
    <path d="M8 30h48c0 13-10 22-24 22S8 43 8 30z" fill={`url(#${i.b})`} />
    <ellipse cx="32" cy="30" rx="24" ry="6" fill={`url(#${i.s})`} />
    <g fill="#3a8f3a"><circle cx="24" cy="29" r="2.2" /><circle cx="38" cy="31" r="2" /></g><circle cx="31" cy="29" r="2.4" fill="#fff4dc" />
    <path d="M22 22c-2-3 2-5 0-9M32 21c-2-3 2-5 0-9M42 22c-2-3 2-5 0-9" fill="none" stroke="#c7d3cd" strokeWidth="2" strokeLinecap="round" />
    <circle cx="48" cy="44" r="7" fill="#fff6e6" /><circle cx="48" cy="44" r="4.5" fill="#f5e3b5" />
  </Art>
}
export function Shawarma() {
  const i = useIds('w', 'p')
  return <Art defs={<>{lg(i.w, '#f7e1b0', '#d9b26a')}{lg(i.p, '#ffffff', '#e8eef1')}</>}>
    <g transform="rotate(-20 32 32)">
      <path d="M22 10h20l-4 44H26z" fill={`url(#${i.w})`} />
      <path d="M22 10c3-4 17-4 20 0-3 3-17 3-20 0z" fill="#9b5a2c" /><g fill="#4caf50"><circle cx="27" cy="9" r="2" /><circle cx="36" cy="8" r="2" /></g><circle cx="31" cy="7" r="1.8" fill="#ef4a3a" />
      <path d="M21 30h22l-3 24H24z" fill={`url(#${i.p})`} /><path d="M24 30l3 24M40 30l-3 24" stroke="#d8e1e5" />
      {shine('M25 13h3l-1 15h-3z')}
    </g>
  </Art>
}
export function Suya() {
  const i = useIds('m')
  return <Art defs={lg(i.m, '#b4552a', '#6e2c12')}>
    <path d="M8 50L56 14" stroke="#c49a6c" strokeWidth="2.6" strokeLinecap="round" />
    {[[18, 42], [28, 34.5], [38, 27], [48, 19.5]].map(([x, y]) => <g key={x}><rect x={x - 6} y={y - 5} width="12" height="10" rx="3" transform={`rotate(-37 ${x} ${y})`} fill={`url(#${i.m})`} /><circle cx={x - 1} cy={y - 1} r="1" fill="#f3c06a" /><circle cx={x + 2} cy={y + 1} r=".8" fill="#ff5a3c" /></g>)}
    <path d="M44 46c4-1 8 1 10 4-4 2-8 1-10-4z" fill="#a8d96c" /><path d="M14 22c3 0 6 2 6 5-3 0-6-2-6-5z" fill="#ef4a3a" />
  </Art>
}
export function Drumstick() {
  const i = useIds('m')
  return <Art defs={lg(i.m, '#f0a24a', '#b9601c')}>
    <path d="M14 26c0-10 8-16 18-16s18 7 16 17c-1 8-9 13-17 12l-8 8-6-6 6-7c-6-1-9-4-9-8z" fill={`url(#${i.m})`} />
    {shine('M20 20c3-5 8-6 12-5-4 2-8 4-10 8z')}
    <path d="M17 44l-5 5" stroke="#f6efe3" strokeWidth="5" strokeLinecap="round" /><circle cx="10" cy="47" r="3.4" fill="#f6efe3" /><circle cx="14" cy="51" r="3.4" fill="#f6efe3" />
    <g fill="#8a3d10" opacity=".5"><circle cx="30" cy="22" r="1.2" /><circle cx="38" cy="26" r="1.2" /><circle cx="26" cy="30" r="1.2" /></g>
  </Art>
}
export function Pizza() {
  const i = useIds('c')
  return <Art defs={lg(i.c, '#ffd36b', '#f2a22c')}>
    <path d="M32 54L8 16c15-8 33-8 48 0z" fill={`url(#${i.c})`} />
    <path d="M8 16c15-8 33-8 48 0l-2 4c-14-7-30-7-44 0z" fill="#c9711f" />
    <g fill="#d63a2f"><circle cx="24" cy="24" r="4" /><circle cx="39" cy="25" r="4" /><circle cx="32" cy="38" r="3.6" /></g>
    <g fill="#4caf50"><circle cx="31" cy="26" r="1.6" /><circle cx="27" cy="33" r="1.4" /><circle cx="37" cy="33" r="1.4" /></g>
  </Art>
}
export function Pastry() {
  const i = useIds('p')
  return <Art defs={lg(i.p, '#f9c873', '#d48a2c')}>
    <path d="M8 42c0-12 11-20 24-20s24 8 24 20c0 4-3 6-6 6H14c-3 0-6-2-6-6z" fill={`url(#${i.p})`} />
    <path d="M12 42c3-3 6-3 8 0s5 3 8 0 5-3 8 0 5 3 8 0 5-3 8 0" fill="none" stroke="#b56d1c" strokeWidth="2" strokeLinecap="round" />
    {shine('M16 32c4-5 9-7 15-7-5 2-10 5-12 9z')}
    <g fill="#a85a16" opacity=".5"><path d="M30 28l4 4M24 30l3 3M37 30l3 3" stroke="#a85a16" strokeWidth="1.6" strokeLinecap="round" /></g>
  </Art>
}
export function Drink() {
  const i = useIds('g', 'l')
  return <Art defs={<>{lg(i.g, '#e8f6ff', '#bfe3f5')}{lg(i.l, '#ff7a59', '#d6332b')}</>}>
    <path d="M38 6l-6 18" stroke="#2fae7f" strokeWidth="3" strokeLinecap="round" />
    <path d="M16 20h32l-4 32c-.3 2.3-2.3 4-4.6 4H24.6c-2.3 0-4.3-1.7-4.6-4z" fill={`url(#${i.g})`} />
    <path d="M18 28h28l-3 24c-.3 2-2 3.4-4 3.4H25c-2 0-3.7-1.4-4-3.4z" fill={`url(#${i.l})`} />
    <rect x="23" y="32" width="6" height="6" rx="1.5" fill="#fff" opacity=".6" /><rect x="33" y="36" width="6" height="6" rx="1.5" fill="#fff" opacity=".5" />
    <circle cx="46" cy="21" r="6" fill="#ffd23f" /><circle cx="46" cy="21" r="3.6" fill="#fff6c2" />
  </Art>
}

// Groceries ---------------------------------------------------------------------------------------------------------
export function Provisions() {
  const i = useIds('c', 'k')
  return <Art defs={<>{lg(i.c, '#ffd45e', '#f29f0d')}{lg(i.k, '#ef4a3a', '#b5221a')}</>}>
    <rect x="8" y="20" width="22" height="34" rx="4" fill={`url(#${i.k})`} /><rect x="8" y="30" width="22" height="12" fill="#fff" opacity=".85" /><path d="M12 36h14" stroke="#b5221a" strokeWidth="2" />
    <rect x="32" y="26" width="24" height="28" rx="11" fill={`url(#${i.c})`} /><ellipse cx="44" cy="27" rx="12" ry="4" fill="#ffe9a8" /><path d="M36 38h16" stroke="#123d2d" strokeWidth="2.4" strokeLinecap="round" />
    {shine('M11 22h3v30h-3z')}
  </Art>
}
export function RiceSack() {
  const i = useIds('s')
  return <Art defs={lg(i.s, '#fbf3e1', '#d9c7a1')}>
    <path d="M16 16c4 2 28 2 32 0l4 6c4 10 4 22-2 30-6 3-30 3-36 0-6-8-6-20-2-30z" fill={`url(#${i.s})`} />
    <path d="M16 16c4-4 28-4 32 0" fill="none" stroke="#b79a64" strokeWidth="3" strokeLinecap="round" />
    <rect x="20" y="30" width="24" height="14" rx="3" fill="#2fae7f" /><path d="M26 37h12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    <g fill="#fff"><ellipse cx="26" cy="12" rx="1.6" ry="1" /><ellipse cx="32" cy="10" rx="1.6" ry="1" /><ellipse cx="38" cy="12" rx="1.6" ry="1" /></g>
  </Art>
}
export function Produce() {
  const i = useIds('t', 'p')
  return <Art defs={<>{lg(i.t, '#ff6a4d', '#d1281c')}{lg(i.p, '#62c94a', '#2b8a2a')}</>}>
    <path d="M40 18c8 0 14 8 12 20s-10 16-14 12c-4-3 0-10-2-18s-4-14 4-14z" fill={`url(#${i.p})`} /><path d="M41 18c0-4 3-7 6-7" stroke="#2b6a1f" strokeWidth="2.4" fill="none" strokeLinecap="round" />
    <circle cx="25" cy="38" r="15" fill={`url(#${i.t})`} /><path d="M19 24l6 4 6-4-3 6 5 2-8 1-8-1 5-2z" fill="#3fa34d" />
    {shine('M16 34c1-5 4-8 8-9-3 3-5 6-5 10z')}
  </Art>
}
export function Spray() {
  const i = useIds('b')
  return <Art defs={lg(i.b, '#6fd1ff', '#1f8fd1')}>
    <path d="M22 26h20v24c0 3-2 5-5 5H27c-3 0-5-2-5-5z" fill={`url(#${i.b})`} />
    <path d="M26 14h10v12H26z" fill="#e8eef1" /><path d="M24 12h16l6 4-2 4h-6l-2-2H24z" fill="#2fae7f" /><path d="M44 18l6 2" stroke="#2fae7f" strokeWidth="2" strokeLinecap="round" />
    <g fill="#bfe8ff"><circle cx="52" cy="14" r="1.6" /><circle cx="55" cy="20" r="1.4" /><circle cx="51" cy="24" r="1.2" /></g>
    <rect x="25" y="34" width="14" height="10" rx="2" fill="#fff" opacity=".8" />
  </Art>
}

// Shops ---------------------------------------------------------------------------------------------------------------
export function Phone() {
  const i = useIds('b', 's')
  return <Art defs={<>{lg(i.b, '#3b3f55', '#15172a')}{lg(i.s, '#7fd3ff', '#3c64d8', 1, 1)}</>}>
    <rect x="18" y="6" width="28" height="48" rx="6" fill={`url(#${i.b})`} /><rect x="21" y="11" width="22" height="36" rx="3" fill={`url(#${i.s})`} />
    <rect x="28" y="8" width="8" height="1.8" rx=".9" fill="#5b607a" /><circle cx="32" cy="50.5" r="1.6" fill="#5b607a" />
    <rect x="24" y="15" width="7" height="7" rx="2" fill="#ffc244" /><rect x="33" y="15" width="7" height="7" rx="2" fill="#ff8fb1" /><rect x="24" y="24" width="7" height="7" rx="2" fill="#7cdb9a" />
    {shine('M23 12h4l-5 14v-12z')}
  </Art>
}
export function Headphones() {
  const i = useIds('h')
  return <Art defs={lg(i.h, '#ff8f5a', '#e2502a')}>
    <path d="M12 38c0-13 9-24 20-24s20 11 20 24" fill="none" stroke="#2b2f45" strokeWidth="4.5" strokeLinecap="round" />
    <rect x="8" y="34" width="12" height="18" rx="5" fill={`url(#${i.h})`} /><rect x="44" y="34" width="12" height="18" rx="5" fill={`url(#${i.h})`} />
    {shine('M10 37h3v12h-3z')}
  </Art>
}
export function Shirt() {
  const i = useIds('s')
  return <Art defs={lg(i.s, '#6fd39d', '#1f9a63')}>
    <path d="M22 10l-14 8 6 11 6-3v28h24V26l6 3 6-11-14-8c-1 4-5 6-10 6s-9-2-10-6z" fill={`url(#${i.s})`} />
    <path d="M22 10c1 4 5 6 10 6s9-2 10-6" fill="none" stroke="#147a4b" strokeWidth="2" /><path d="M24 30h16" stroke="#fff" strokeOpacity=".6" strokeWidth="2.4" strokeLinecap="round" />
  </Art>
}
export function HomeLamp() {
  const i = useIds('s')
  return <Art defs={lg(i.s, '#ffd45e', '#f29f0d')}>
    <path d="M20 10h24l8 20H12z" fill={`url(#${i.s})`} /><rect x="30" y="30" width="4" height="18" fill="#7a5a3a" />
    <ellipse cx="32" cy="51" rx="12" ry="3.6" fill="#5a4030" /><path d="M24 30c0 4 4 6 8 6s8-2 8-6" fill="#fff6c2" opacity=".7" />
  </Art>
}
export function Gift() {
  const i = useIds('g')
  return <Art defs={lg(i.g, '#b18cff', '#6b3fd6')}>
    <rect x="10" y="26" width="44" height="28" rx="4" fill={`url(#${i.g})`} /><rect x="8" y="20" width="48" height="10" rx="3" fill="#8b62ef" />
    <rect x="28" y="20" width="8" height="34" fill="#ffc244" />
    <path d="M32 20c-4-8-14-10-14-4s10 4 14 4zM32 20c4-8 14-10 14-4s-10 4-14 4z" fill="#ffc244" />
  </Art>
}

// Pharmacy & Beauty ---------------------------------------------------------------------------------------------------
export function PillBottle() {
  const i = useIds('b')
  return <Art defs={lg(i.b, '#ff9f43', '#e06a10')}>
    <rect x="18" y="8" width="28" height="9" rx="3" fill="#fff" stroke="#d7dee2" /><rect x="16" y="16" width="32" height="38" rx="6" fill={`url(#${i.b})`} />
    <rect x="20" y="26" width="24" height="16" rx="2" fill="#fff" /><path d="M29 30h6v4h4v6h-4v4h-6v-4h-4v-6h4z" fill="#2fae7f" transform="scale(.55) translate(26 26)" />
    {shine('M19 20h3v30h-3z')}
  </Art>
}
export function CareTube() {
  const i = useIds('t')
  return <Art defs={lg(i.t, '#7fd3ff', '#2f8fd8')}>
    <path d="M18 14h28l-4 32H22z" fill={`url(#${i.t})`} /><rect x="27" y="46" width="10" height="8" rx="2" fill="#fff" stroke="#c9d6de" />
    <path d="M18 14h28v4H18z" fill="#1f6fb0" /><path d="M26 26h12M27 32h10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
  </Art>
}
export function Lipstick() {
  const i = useIds('l', 'c')
  return <Art defs={<>{lg(i.l, '#ff5f8f', '#c21d55')}{lg(i.c, '#3a3a4f', '#16161f')}</>}>
    <path d="M26 10l12 4v14H26z" fill={`url(#${i.l})`} /><rect x="23" y="27" width="18" height="8" rx="2" fill="#e6b84c" />
    <rect x="21" y="34" width="22" height="20" rx="3" fill={`url(#${i.c})`} />{shine('M28 13h3v13h-3z')}
    <circle cx="50" cy="20" r="5" fill="#ffd6e3" /><circle cx="14" cy="26" r="3" fill="#ffd6e3" />
  </Art>
}
export function BabyBottle() {
  const i = useIds('b')
  return <Art defs={lg(i.b, '#e8f6ff', '#b9dcf2')}>
    <path d="M28 6c-2 0-3 2-3 4v4h14v-4c0-2-1-4-3-4z" fill="#ffb4c8" /><rect x="22" y="14" width="20" height="6" rx="2" fill="#7cc8f2" />
    <rect x="20" y="20" width="24" height="34" rx="7" fill={`url(#${i.b})`} stroke="#9fd0ee" /><path d="M24 30h6M24 36h8M24 42h6" stroke="#5aaee0" strokeWidth="2" strokeLinecap="round" />
    <path d="M22 44h20v4c0 3-3 5-6 5h-8c-3 0-6-2-6-5z" fill="#fff6dc" />
  </Art>
}


// People & places for partner pages ------------------------------------------------------------------------------------
export function Scooter() {
  const i = useIds('b', 'box')
  return <Art defs={<>{lg(i.b, '#2fae7f', '#0f6a4d')}{lg(i.box, '#ffd45e', '#f29f0d')}</>}>
    <rect x="34" y="14" width="18" height="16" rx="3" fill={`url(#${i.box})`} /><path d="M38 20h10" stroke="#123d2d" strokeWidth="2" strokeLinecap="round" />
    <path d="M14 42h22l6-10h8l2 10" fill="none" stroke="#123d2d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 44c0-6 5-10 12-10h12l-4 10z" fill={`url(#${i.b})`} />
    <path d="M18 18l4-6 4 2-2 8" fill="#123d2d" /><circle cx="24" cy="12" r="5" fill="#ffc244" /><path d="M20 22h10l2 12H18z" fill="#2b4aa8" />
    <circle cx="16" cy="48" r="6" fill="#2b2f45" /><circle cx="16" cy="48" r="2.4" fill="#cfd6da" />
    <circle cx="50" cy="48" r="6" fill="#2b2f45" /><circle cx="50" cy="48" r="2.4" fill="#cfd6da" />
  </Art>
}
export function Storefront() {
  const i = useIds('w', 'a')
  return <Art defs={<>{lg(i.w, '#ffffff', '#e4ebef')}{lg(i.a, '#ff8a3d', '#d4471b')}</>}>
    <rect x="10" y="24" width="44" height="30" rx="3" fill={`url(#${i.w})`} stroke="#cfd9de" />
    <path d="M8 14h48l-2 12H10z" fill="#123d2d" />
    {[0, 1, 2, 3, 4, 5].map((n) => <path key={n} d={`M${10 + n * 7.3} 26c0 4 7.3 4 7.3 0`} fill={n % 2 ? '#fff' : `url(#${i.a})`} />)}
    <path d="M10 26h44" stroke="#c9d6de" />
    <rect x="16" y="34" width="14" height="12" rx="2" fill="#bfe3f5" /><rect x="35" y="34" width="12" height="20" rx="2" fill="#ffc244" /><circle cx="44" cy="45" r="1.2" fill="#123d2d" />
    <rect x="22" y="8" width="20" height="8" rx="3" fill="#ffc244" /><path d="M27 12h10" stroke="#123d2d" strokeWidth="2" strokeLinecap="round" />
  </Art>
}
export function MoneyBag() {
  const i = useIds('m')
  return <Art defs={lg(i.m, '#62c94a', '#2b8a2a')}>
    <path d="M24 16h16l-4 6h-8z" fill="#2b8a2a" /><path d="M26 10h12l-3 6h-6z" fill={`url(#${i.m})`} />
    <path d="M28 22h8c10 4 16 14 16 22 0 7-6 10-20 10s-20-3-20-10c0-8 6-18 16-22z" fill={`url(#${i.m})`} />
    <text x="32" y="46" textAnchor="middle" fontSize="16" fontWeight="900" fill="#fff" fontFamily="Manrope, sans-serif">₦</text>
    {shine('M18 40c1-6 5-11 10-14-3 4-6 9-6 14z')}
  </Art>
}
export function PhoneOrders() {
  const i = useIds('b')
  return <Art defs={lg(i.b, '#3b3f55', '#15172a')}>
    <rect x="16" y="6" width="32" height="50" rx="7" fill={`url(#${i.b})`} /><rect x="19" y="11" width="26" height="40" rx="3" fill="#fffdf7" />
    <rect x="22" y="15" width="20" height="9" rx="2" fill="#e2f2e8" /><circle cx="26" cy="19.5" r="2" fill="#2fae7f" /><path d="M30 19.5h9" stroke="#2fae7f" strokeWidth="2" strokeLinecap="round" />
    <rect x="22" y="27" width="20" height="9" rx="2" fill="#fff1c9" /><circle cx="26" cy="31.5" r="2" fill="#f29f0d" /><path d="M30 31.5h9" stroke="#f29f0d" strokeWidth="2" strokeLinecap="round" />
    <rect x="22" y="39" width="20" height="8" rx="4" fill="#007c63" /><path d="M28 43h8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    <circle cx="48" cy="10" r="7" fill="#ef4a3a" /><text x="48" y="13.5" textAnchor="middle" fontSize="9" fontWeight="900" fill="#fff" fontFamily="Manrope, sans-serif">3</text>
  </Art>
}
export function MapPinArt() {
  const i = useIds('p')
  return <Art defs={lg(i.p, '#ff7a59', '#d6332b')}>
    <path d="M10 44l14-6 16 6 14-6v14l-14 6-16-6-14 6z" fill="#e2f2e8" stroke="#bcd9c8" /><path d="M24 38v14M40 44v14" stroke="#bcd9c8" />
    <path d="M32 6c-8 0-14 6-14 14 0 10 14 24 14 24s14-14 14-24c0-8-6-14-14-14z" fill={`url(#${i.p})`} /><circle cx="32" cy="20" r="5" fill="#fff" />
  </Art>
}

export const CATEGORY_ART = { FOOD: Burger, GROCERIES: Basket, SHOPS: ShoppingBag, PHARMACY_BEAUTY: Pharmacy, PACKAGE: Parcel, OFFERS: PercentTag, DISCOVER: Compass }
export const SUB_ART = {
  promo: PercentTag, local: Soup, rice: Jollof, shawarma: Shawarma, grills: Suya, chicken: Drumstick, pizza: Pizza, burgers: Burger, snacks: Pastry, drinks: Drink,
  provisions: Provisions, staples: RiceSack, fresh: Produce, household: Spray,
  phones: Phone, electronics: Headphones, fashion: Shirt, home: HomeLamp, gifts: Gift,
  medicine: PillBottle, personal: CareTube, beauty: Lipstick, baby: BabyBottle,
}
