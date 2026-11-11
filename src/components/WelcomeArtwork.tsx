/** Decorative artwork; never displays balances or other account data. */
export function WelcomeArtwork(){return <svg viewBox="0 0 200 180" fill="none" aria-hidden="true">
 <circle cx="100" cy="88" r="70" fill="#E6CDF2"/>
 <circle cx="157" cy="39" r="9" fill="#F4CF76"/><circle cx="38" cy="107" r="6" fill="#FFF7FB"/>
 <path d="M100 123V72" stroke="#815C91" strokeWidth="6" strokeLinecap="round"/>
 <path d="M99 95C70 96 58 77 63 58C89 56 103 71 99 95Z" fill="#A99AD7"/>
 <path d="M102 80C99 58 113 42 138 47C142 69 123 83 102 80Z" fill="#81B69E"/>
 <path d="M70 113H132L124 152H79L70 113Z" fill="#FFF9FC"/>
 <rect x="65" y="108" width="72" height="15" rx="7.5" fill="#F8EEF9"/>
 <circle cx="92" cy="132" r="2.5" fill="#704278"/><circle cx="112" cy="132" r="2.5" fill="#704278"/>
 <path d="M98 140Q102 145 106 140" stroke="#704278" strokeWidth="2.5" strokeLinecap="round"/>
 <ellipse cx="85" cy="139" rx="5" ry="3" fill="#EDBED3"/><ellipse cx="118" cy="139" rx="5" ry="3" fill="#EDBED3"/>
 <path d="M37 36V47M31.5 41.5H42.5M158 126V139M151.5 132.5H164.5" stroke="#BC89BD" strokeWidth="3" strokeLinecap="round"/>
 </svg>;}
export default function ThemeWelcome(){return <aside className="theme-welcome" aria-label="Welcome to AROMEVA"><span className="theme-kicker">A FRESH LOOK. THE SAME AROMEVA.</span><h2>A little space<br/>for your<br/><em>next chapter.</em></h2><p>Your products, wallet and community, together in one welcoming place.</p><div className="theme-welcome-art"><WelcomeArtwork/></div></aside>;}
