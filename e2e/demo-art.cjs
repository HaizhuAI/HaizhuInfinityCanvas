// Demo pictures for screenshots: small original SVG scenes that stand in for model results, so the
// screenshot run needs no real provider. Drawn for this project; `v` varies a scene a little (a new
// "generation"), `style` renders the same subject three ways (the three demo image models).
const W = 1024, H = 576

const wrap = (body, defs = '', w = W, h = H) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${w}" height="${h}"><defs>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .22 0"/></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="14"/></filter><filter id="softer"><feGaussianBlur stdDeviation="36"/></filter>
  ${defs}</defs>${body}</svg>`
const grain = `<rect width="${W}" height="${H}" filter="url(#grain)" style="mix-blend-mode:overlay"/>`
const rnd = (seed) => { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 } }

/** a lighthouse on a headland at dusk */
function lighthouse(style = 'photo', v = 0) {
  const sx = 300 + v * 46, sy = 306 - v * 10
  if (style === 'illustration') {
    const r = rnd(3 + v)
    const clouds = Array.from({ length: 4 }, (_, i) => { const x = 80 + i * 240 + r() * 60, y = 70 + r() * 110, w = 120 + r() * 80; return `<rect x="${x}" y="${y}" width="${w}" height="26" rx="13" fill="#fff6e4" opacity=".9"/><rect x="${x + 30}" y="${y - 16}" width="${w * 0.5}" height="26" rx="13" fill="#fff6e4" opacity=".9"/>` }).join('')
    const waves = [0, 1, 2, 3].map((i) => `<path d="M0 ${410 + i * 42} ${Array.from({ length: 9 }, (_, k) => `q 32 ${i % 2 ? -18 : 18} 64 0 t 64 0`).join(' ')} V${H} H0Z" fill="${['#2f8f9d', '#237b8b', '#1a6678', '#124f61'][i]}"/>`).join('')
    return wrap(`<rect width="${W}" height="${H}" fill="#ffd9a0"/><rect width="${W}" height="250" fill="#ff9e7a"/><rect width="${W}" height="130" fill="#f2716b"/>
      <circle cx="${sx}" cy="${sy - 60}" r="92" fill="#fff1c9"/>${clouds}${waves}
      <path d="M640 ${H} L700 430 Q790 380 880 420 L1024 470 V${H}Z" fill="#3a2f4a"/>
      <g transform="translate(770 150)"><path d="M-34 262 L-22 40 H22 L34 262Z" fill="#fff8ec"/><path d="M-30.5 196 L-27 132 H27 L30.5 196Z" fill="#e4433f"/><path d="M-24.5 86 L-22.5 48 H22.5 L24.5 86Z" fill="#e4433f"/>
        <rect x="-30" y="22" width="60" height="18" fill="#3a2f4a"/><rect x="-18" y="-14" width="36" height="36" fill="#ffe27a"/><path d="M-26 -14 H26 L0 -44Z" fill="#e4433f"/><rect x="-6" y="214" width="12" height="48" rx="6" fill="#3a2f4a"/></g>
      <path d="M752 146 L250 60 L250 190Z" fill="#fff1c9" opacity=".55"/>`)
  }
  if (style === '3d') {
    return wrap(`<rect width="${W}" height="${H}" fill="url(#bg3)"/>
      <ellipse cx="512" cy="492" rx="330" ry="40" fill="#5b4a8a" opacity=".28" filter="url(#soft)"/>
      <ellipse cx="512" cy="446" rx="300" ry="62" fill="url(#isle)"/><ellipse cx="512" cy="432" rx="300" ry="56" fill="url(#grass)"/>
      <g transform="translate(${520 + v * 10} 96)"><path d="M-52 330 Q-44 60 -34 40 H34 Q44 60 52 330 Q0 348 -52 330Z" fill="url(#tower)"/>
        <path d="M-48.500 250 Q-45 180 -43 150 H43 Q45 180 48.500 250 Q0 264 -48.500 250Z" fill="url(#band)"/>
        <rect x="-46" y="14" width="92" height="30" rx="15" fill="url(#cap)"/><rect x="-28" y="-40" width="56" height="58" rx="18" fill="url(#lamp)"/><path d="M-38 -36 Q0 -92 38 -36 Q0 -24 -38 -36Z" fill="url(#band)"/>
        <ellipse cx="-16" cy="140" rx="7" ry="70" fill="#fff" opacity=".35"/><rect x="-12" y="270" width="24" height="52" rx="12" fill="#5b4a8a"/></g>
      ${[[170, 150, 1], [800, 110, 0.8], [690, 250, 0.55]].map(([x, y, s]) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="6" cy="30" rx="78" ry="14" fill="#5b4a8a" opacity=".16" filter="url(#soft)"/><circle cx="-38" r="30" fill="#fff"/><circle cx="2" cy="-14" r="40" fill="#fff"/><circle cx="44" r="28" fill="#fff"/><rect x="-66" y="-2" width="136" height="32" rx="16" fill="#fff"/></g>`).join('')}
      <circle cx="${520 + v * 10}" cy="84" r="70" fill="#ffe9a8" opacity=".5" filter="url(#softer)"/>`,
    `<linearGradient id="bg3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9b8ff"/><stop offset="1" stop-color="#ffd3e2"/></linearGradient>
     <linearGradient id="isle" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b08968"/><stop offset="1" stop-color="#7f5f48"/></linearGradient>
     <linearGradient id="grass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a8e6a1"/><stop offset="1" stop-color="#5fbf8a"/></linearGradient>
     <linearGradient id="tower" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d9d3ee"/></linearGradient>
     <linearGradient id="band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff8a80"/><stop offset="1" stop-color="#e2574c"/></linearGradient>
     <linearGradient id="cap" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7d6bb5"/><stop offset="1" stop-color="#5b4a8a"/></linearGradient>
     <linearGradient id="lamp" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6c9"/><stop offset="1" stop-color="#ffd166"/></linearGradient>`)
  }
  const r = rnd(11 + v)
  const stars = Array.from({ length: 46 }, () => `<circle cx="${r() * W}" cy="${r() * 190}" r="${0.6 + r() * 1.2}" fill="#fff" opacity="${0.25 + r() * 0.5}"/>`).join('')
  const glints = Array.from({ length: 34 }, () => { const y = 392 + r() * 170, w = 20 + r() * 110; return `<rect x="${sx - w / 2 + (r() - 0.5) * 220 * ((y - 380) / 190)}" y="${y}" width="${w}" height="${1.5 + r() * 2}" rx="1" fill="#ffd9a0" opacity="${0.12 + r() * 0.35}"/>` }).join('')
  return wrap(`<rect width="${W}" height="${H}" fill="url(#sky)"/>${stars}
    <circle cx="${sx}" cy="${sy}" r="150" fill="#ffb37a" opacity=".55" filter="url(#softer)"/><circle cx="${sx}" cy="${sy}" r="34" fill="#fff0cf"/>
    <path d="M0 330 Q140 300 260 322 T520 316 T780 326 T1024 312 V392 H0Z" fill="#3b3560" opacity=".55"/>
    <rect y="384" width="${W}" height="192" fill="url(#sea)"/>${glints}
    <path d="M600 ${H} L650 470 Q700 404 770 392 Q850 380 900 410 L1024 452 V${H}Z" fill="#14122a"/>
    <path d="M790 152 L120 70 L120 250Z" fill="url(#beam)"/>
    <g transform="translate(800 150)"><path d="M-26 250 L-17 40 H17 L26 250Z" fill="url(#twr)"/><path d="M-23.400 190 L-21 134 H21 L23.400 190Z" fill="#b8423f"/>
      <rect x="-24" y="26" width="48" height="14" fill="#1b1830"/><rect x="-14" y="-6" width="28" height="32" fill="#fff3c4"/><path d="M-20 -6 H20 L0 -30Z" fill="#1b1830"/>
      <circle cy="10" r="46" fill="#ffe9a8" opacity=".75" filter="url(#soft)"/></g>${grain}`,
  `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#141a3c"/><stop offset=".45" stop-color="#5a3f73"/><stop offset=".72" stop-color="#e2735f"/><stop offset=".86" stop-color="#f6b56c"/><stop offset="1" stop-color="#f9d9a0"/></linearGradient>
   <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9795f"/><stop offset=".18" stop-color="#5b4670"/><stop offset="1" stop-color="#0d1330"/></linearGradient>
   <linearGradient id="beam" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#fff3c4" stop-opacity=".7"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></linearGradient>
   <linearGradient id="twr" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f4ede6"/><stop offset="1" stop-color="#a99fb5"/></linearGradient>`)
}

/** misty mountains over a lake (used as an uploaded reference picture) */
function mountains(v = 0) {
  const ridge = (y, amp, seed, fill, op = 1) => { const r = rnd(seed); let d = `M0 ${y}`; for (let x = 0; x <= W; x += 64) d += ` L${x} ${y - r() * amp}`; return `<path d="${d} L${W} ${H} L0 ${H}Z" fill="${fill}" opacity="${op}"/>` }
  const r = rnd(5 + v)
  const pines = Array.from({ length: 26 }, () => { const x = r() * W, s = 0.5 + r() * 0.9, y = 452 + r() * 16; return `<path d="M${x} ${y - 70 * s} l${16 * s} ${34 * s} h-${7 * s} l${13 * s} ${30 * s} h-${44 * s} l${13 * s} -${30 * s} h-${7 * s}Z" fill="#0f2b2e"/>` }).join('')
  return wrap(`<rect width="${W}" height="${H}" fill="url(#msky)"/><circle cx="700" cy="150" r="46" fill="#fff6e0"/><circle cx="700" cy="150" r="130" fill="#ffe7c2" opacity=".5" filter="url(#softer)"/>
    ${ridge(300, 150, 21, '#8fa9b5', 0.7)}${ridge(350, 120, 22, '#5f8794', 0.85)}<rect y="330" width="${W}" height="60" fill="#e9f1f0" opacity=".5" filter="url(#soft)"/>${ridge(410, 90, 23, '#2f5d66')}
    <rect y="456" width="${W}" height="120" fill="url(#lake)"/>${pines}
    ${Array.from({ length: 12 }, (_, i) => `<rect x="${60 + i * 80 + r() * 30}" y="${476 + r() * 80}" width="${50 + r() * 90}" height="2" rx="1" fill="#e9f1f0" opacity="${0.15 + r() * 0.25}"/>`).join('')}${grain}`,
  `<linearGradient id="msky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc3cf"/><stop offset=".6" stop-color="#e6efe9"/><stop offset="1" stop-color="#f6efe0"/></linearGradient>
   <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b6f78"/><stop offset="1" stop-color="#143a40"/></linearGradient>`)
}

const leaf = (x, y, s, rot, fill) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 -30 L7 -12 L22 -20 L16 -3 L32 2 L17 10 L22 26 L6 18 L0 34 L-6 18 L-22 26 L-17 10 L-32 2 L-16 -3 L-22 -20 L-7 -12Z" fill="${fill}"/><rect x="-1.500" y="28" width="3" height="16" fill="${fill}"/></g>`
const cupTop = (cx, cy, r) => `<circle cx="${cx + 8}" cy="${cy + 14}" r="${r + 16}" fill="#000" opacity=".28" filter="url(#soft)"/><circle cx="${cx}" cy="${cy}" r="${r + 26}" fill="#f6efe6"/><circle cx="${cx}" cy="${cy}" r="${r + 14}" fill="#e7ddd0"/>
  <path d="M${cx + r + 6} ${cy - 22} q54 22 0 44" fill="none" stroke="#f6efe6" stroke-width="18" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#f6efe6"/><circle cx="${cx}" cy="${cy}" r="${r - 10}" fill="url(#coffee)"/>
  <g transform="translate(${cx} ${cy})" fill="#fbf1e0">${[0, 1, 2, 3].map((i) => `<path d="M0 ${-r * 0.5 + i * r * 0.26} q${r * (0.42 - i * 0.07)} ${r * 0.1} 0 ${r * 0.3} q-${r * (0.42 - i * 0.07)} -${r * 0.2} 0 -${r * 0.3}Z" opacity="${0.95 - i * 0.08}"/>`).join('')}<rect x="-2" y="${-r * 0.55}" width="4" height="${r * 1.15}" rx="2" fill="#b98556" opacity=".5"/></g>`
const coffeeDefs = `<radialGradient id="coffee"><stop offset="0" stop-color="#c79a6b"/><stop offset="1" stop-color="#8a5a34"/></radialGradient>
  <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5a3a"/><stop offset="1" stop-color="#4f2f1f"/></linearGradient>
  <linearGradient id="warm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7c873"/><stop offset="1" stop-color="#e8873a"/></linearGradient>`
const AUTUMN = ['#e8612c', '#f29c38', '#c9402a', '#f6c04d', '#a8361f']

/** four shots of an autumn coffee-shop spot: 0 street, 1 pouring, 2 cup by the window, 3 closing card */
function coffee(shot = 0, v = 0) {
  const r = rnd(31 + shot * 7 + v)
  const falling = (n, y0 = 0, y1 = H) => Array.from({ length: n }, () => leaf(r() * W, y0 + r() * (y1 - y0), 0.35 + r() * 0.55, r() * 360, AUTUMN[Math.floor(r() * AUTUMN.length)])).join('')
  const bokeh = (n, colors) => Array.from({ length: n }, () => `<circle cx="${r() * W}" cy="${r() * 330}" r="${18 + r() * 46}" fill="${colors[Math.floor(r() * colors.length)]}" opacity="${0.12 + r() * 0.25}"/>`).join('')
  if (shot === 0) return wrap(`<rect width="${W}" height="${H}" fill="url(#dusk)"/>
    <rect x="250" y="120" width="560" height="360" fill="#3a2a2a"/><rect x="250" y="120" width="560" height="26" fill="#2a1d1d"/>
    <path d="M232 190 H828 L800 250 H260Z" fill="#c9402a"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="M${260 + i * 78} 250 q39 26 78 0Z" fill="${i % 2 ? '#f6efe6' : '#c9402a'}"/>`).join('')}
    <rect x="290" y="282" width="210" height="150" rx="6" fill="url(#warm)"/><rect x="560" y="282" width="210" height="198" rx="6" fill="url(#warm)"/><rect x="390" y="282" width="6" height="150" fill="#3a2a2a"/><rect x="290" y="352" width="210" height="6" fill="#3a2a2a"/><rect x="662" y="282" width="6" height="198" fill="#3a2a2a"/>
    <circle cx="395" cy="340" r="120" fill="#f7c873" opacity=".35" filter="url(#softer)"/><circle cx="665" cy="370" r="130" fill="#f7c873" opacity=".35" filter="url(#softer)"/>
    <circle cx="530" cy="160" r="26" fill="#f6efe6"/><path d="M518 154 h20 v10 a10 10 0 0 1 -20 0Z M538 156 q8 4 0 9" fill="none" stroke="#3a2a2a" stroke-width="3"/>
    <rect y="480" width="${W}" height="96" fill="#2b2530"/><rect y="480" width="${W}" height="6" fill="#463c4a"/>
    <rect x="120" y="250" width="16" height="232" fill="#3b2a22"/><circle cx="128" cy="200" r="96" fill="#e8612c"/><circle cx="70" cy="250" r="62" fill="#f29c38"/><circle cx="190" cy="246" r="66" fill="#c9402a"/><circle cx="140" cy="130" r="56" fill="#f6c04d"/>
    <rect x="900" y="300" width="12" height="182" fill="#3b2a22"/><circle cx="906" cy="262" r="70" fill="#f29c38"/><circle cx="950" cy="300" r="46" fill="#e8612c"/>
    ${falling(16, 60, 560)}${grain}`,
  coffeeDefs + `<linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4a72"/><stop offset=".7" stop-color="#d98a6a"/><stop offset="1" stop-color="#f1c38a"/></linearGradient>`)
  if (shot === 1) return wrap(`<rect width="${W}" height="${H}" fill="url(#wood)"/>${Array.from({ length: 9 }, (_, i) => `<rect y="${i * 64 + 20}" width="${W}" height="2" fill="#000" opacity=".12"/>`).join('')}
    ${cupTop(470 + v * 12, 310, 150)}
    <g transform="translate(700 70) rotate(28)"><rect x="-10" y="20" width="150" height="170" rx="26" fill="#d9dde2"/><rect x="2" y="32" width="126" height="146" rx="18" fill="#bfc5cc"/><path d="M-10 60 l-58 -34 l20 -22 l44 26Z" fill="#d9dde2"/><path d="M140 70 q60 40 0 90" fill="none" stroke="#d9dde2" stroke-width="18" stroke-linecap="round"/></g>
    <path d="M640 150 Q560 190 500 270" fill="none" stroke="#fbf1e0" stroke-width="12" stroke-linecap="round"/>
    ${leaf(150, 450, 1.3, -24, '#e8612c')}${leaf(230, 500, 0.9, 40, '#f6c04d')}${leaf(880, 470, 1.1, 150, '#c9402a')}${grain}`, coffeeDefs)
  if (shot === 2) return wrap(`<rect width="${W}" height="${H}" fill="url(#win)"/>${bokeh(26, ['#f7c873', '#f29c38', '#fff1c9', '#e8612c'])}
    <rect y="396" width="${W}" height="180" fill="url(#wood)"/><rect y="396" width="${W}" height="5" fill="#b98556" opacity=".6"/>
    <ellipse cx="520" cy="470" rx="190" ry="20" fill="#000" opacity=".35" filter="url(#soft)"/>
    <ellipse cx="520" cy="452" rx="178" ry="22" fill="#efe6da"/><path d="M400 280 H640 Q640 430 580 446 H460 Q400 430 400 280Z" fill="url(#cup)"/><ellipse cx="520" cy="280" rx="120" ry="20" fill="#f6efe6"/><ellipse cx="520" cy="282" rx="104" ry="14" fill="url(#coffee)"/>
    <path d="M640 310 q78 6 60 62 q-12 36 -72 40" fill="none" stroke="#efe6da" stroke-width="20" stroke-linecap="round"/>
    ${[0, 1, 2].map((i) => `<path d="M${476 + i * 44} 250 q-22 -40 0 -80 q22 -40 0 -84" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".32" filter="url(#soft)"/>`).join('')}
    ${leaf(770 + v * 10, 438, 1.5, 18, '#e8612c')}${leaf(250, 448, 1.0, -50, '#f6c04d')}${grain}`,
  coffeeDefs + `<linearGradient id="win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3b2e"/><stop offset="1" stop-color="#b8683a"/></linearGradient>
   <linearGradient id="cup" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fbf6ef"/><stop offset="1" stop-color="#d8cbbb"/></linearGradient>`)
  return wrap(`<rect width="${W}" height="${H}" fill="url(#card)"/><circle cx="512" cy="288" r="230" fill="#f7c873" opacity=".28" filter="url(#softer)"/>
    ${Array.from({ length: 14 }, (_, i) => { const a = (i / 14) * Math.PI * 2; return leaf(512 + Math.cos(a) * 212, 288 + Math.sin(a) * 212, 0.9, (a * 180) / Math.PI + 90, AUTUMN[i % AUTUMN.length]) }).join('')}
    ${cupTop(512, 288, 112)}${grain}`,
  coffeeDefs + `<radialGradient id="card"><stop offset="0" stop-color="#7a4a2e"/><stop offset="1" stop-color="#2e1a14"/></radialGradient>`)
}

/** pick a scene from what was asked for (prompt text) and which demo model was used */
function sceneFor(prompt, model = '', v = 0) {
  const p = String(prompt)
  const style = /illustration|插画/.test(model) ? 'illustration' : /3d/i.test(model) ? '3d' : 'photo'
  if (/街角|店面|storefront/.test(p)) return coffee(0, v)
  if (/拉花|pour/.test(p)) return coffee(1, v)
  if (/落版|品牌|closing/.test(p)) return coffee(3, v)
  if (/枫叶|窗边|window/.test(p)) return coffee(2, v)
  if (/山|湖|mountain|lake/.test(p) && !/灯塔|lighthouse/.test(p)) return mountains(v)
  return lighthouse(style, v)
}

module.exports = { W, H, lighthouse, mountains, coffee, sceneFor }
