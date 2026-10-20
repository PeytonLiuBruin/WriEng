export default function JourneyArt({compact=false}:{compact?:boolean}) {
  return <div className={`journey-art ${compact?'compact':''}`} aria-label="等距词汇邮局：信件从新词岛出发，经过回忆桥，送往长久记忆" role="img">
    <div className="orbit orbit-one"/><div className="orbit orbit-two"/>
    <svg viewBox="0 0 620 460" aria-hidden="true">
      <defs>
        <linearGradient id="land" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e0eac2"/><stop offset="1" stopColor="#abc19b"/></linearGradient>
        <linearGradient id="roof" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e5a16d"/><stop offset="1" stopColor="#be7751"/></linearGradient>
        <filter id="shadow"><feGaussianBlur stdDeviation="10"/></filter>
        <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#93a38d" opacity=".25"/></pattern>
      </defs>
      <ellipse cx="320" cy="384" rx="220" ry="25" fill="#385346" opacity=".12" filter="url(#shadow)"/>
      <path d="M61 284L262 181 540 282 344 405Z" fill="#b7c2a3"/><path d="M61 263L262 160 540 261 344 384 61 284Z" fill="#c7d1ad"/>
      <path d="M61 263L262 160 540 261 344 365Z" fill="url(#land)"/><path d="M61 263L262 160 540 261 344 365Z" fill="url(#dots)"/>
      <path d="M162 286L260 237Q280 227 303 239L402 278Q418 286 400 297L333 332" fill="none" stroke="#f8f2da" strokeWidth="28" strokeLinecap="round"/>
      <path d="M164 286L260 237Q280 227 303 239L402 278Q418 286 400 297L333 332" fill="none" stroke="#c8ba90" strokeWidth="1.5" strokeDasharray="6 7"/>
      <g className="art-postoffice">
        <path d="M264 193L347 150 422 181 340 226Z" fill="#f0d8ac"/><path d="M264 193L340 226 340 300 264 267Z" fill="#f7e8c8"/><path d="M340 226L422 181 422 254 340 300Z" fill="#decca3"/>
        <path d="M246 187L337 132 440 173 346 229Z" fill="url(#roof)"/><path d="M246 187L295 119 383 155 346 229Z" fill="#da9565"/><path d="M295 119L337 132 440 173 383 155Z" fill="#efb080"/>
        <path d="M279 221L299 230 299 261 279 253Z" fill="#4b7261"/><path d="M279 238L299 246M289 225V258" stroke="#f7e7c6" strokeWidth="3"/>
        <path d="M311 244Q323 233 332 253L332 291 311 282Z" fill="#416657"/>
        <path d="M360 238L382 226 382 248 360 261Z" fill="#476a59"/><path d="M372 232V254M360 249L382 237" stroke="#eadbb7" strokeWidth="3"/>
        <path d="M392 222L410 212 410 234 392 244Z" fill="#476a59"/><path d="M401 217V239M392 233L410 223" stroke="#eadbb7" strokeWidth="3"/>
        <path d="M350 208L413 174 413 197 350 231Z" fill="#214e3e"/><text x="365" y="216" fill="#fff8e4" fontSize="10" fontFamily="Georgia" transform="rotate(-28 365 216)">POST OFFICE</text>
        <path d="M314 284L340 296 340 304 314 292Z" fill="#a89d7f"/>
        <path d="M356 155V91" stroke="#655f4c" strokeWidth="4"/><path d="M358 92L399 105 358 116Z" fill="#e5bd58"/>
      </g>
      <g><path d="M150 251V218" stroke="#735c40" strokeWidth="8"/><path d="M117 222L149 160 184 222Z" fill="#527956"/><path d="M121 207L149 146 179 207Z" fill="#648a61"/><path d="M130 183L149 133 171 183Z" fill="#789a6d"/>
      <path d="M457 285V260" stroke="#735c40" strokeWidth="6"/><path d="M430 265L457 216 487 265Z" fill="#527956"/><path d="M436 247L457 198 480 247Z" fill="#7f9d69"/>
      <ellipse cx="208" cy="206" rx="15" ry="7" fill="#97ae7a"/><ellipse cx="456" cy="307" rx="20" ry="9" fill="#91aa75"/>
      </g>
      <g className="art-envelope"><path d="M184 279L222 260 250 273 212 293Z" fill="#fdf8e7"/><path d="M184 279L212 285 222 260" fill="none" stroke="#c6b59b" strokeWidth="1.5"/><path d="M184 279V294L212 308 250 288V273L212 293Z" fill="#e9ddc4"/><path d="M212 293V308" stroke="#bfb79e"/></g>
      <g className="art-mailbox"><path d="M382 320V345" stroke="#72795f" strokeWidth="5"/><path d="M365 307Q365 292 379 296L398 304V328L365 315Z" fill="#38664f"/><path d="M379 296Q393 288 407 298V322L398 328V304Z" fill="#214a39"/><path d="M369 307L390 315" stroke="#f9e2a2" strokeWidth="3"/><path d="M407 296V280L420 285V291L407 286" fill="#db875b" stroke="#db875b" strokeWidth="2"/></g>
      <g fill="#eedb9b"><path d="M248 317l6-9 6 9-6 4Z"/><path d="M474 237l5-8 5 8-5 3Z"/><circle cx="113" cy="270" r="4"/></g>
      <g className="art-flying-letter"><path d="M142 93L194 76 213 110 161 127Z" fill="#fffdf3" stroke="#cecbb7"/><path d="M142 93L180 104 194 76" fill="none" stroke="#b8bfa9"/><rect x="190" y="89" width="9" height="10" rx="1" transform="rotate(-18 190 89)" fill="#eab47a"/><path d="M115 111l-21 6m28 5-15 5" stroke="#91a289" strokeWidth="2" strokeLinecap="round"/></g>
    </svg>
    <div className="art-caption"><span className="little-dot"/> MEMORY POST · EST. TODAY</div>
    {!compact&&<><span className="art-label label-a">01 理解 · 寄出新词</span><span className="art-label label-b">02 回忆 · 搭一座桥</span><span className="art-note">Good things take recall.</span></>}
  </div>;
}
