// The voice eCard's stylesheet, shipped as a string the scene renders in one <style>, the way the
// package ships every other piece of CSS it owns (wordStateCss, NO_PRINT_CSS): no CSS module, no
// file a host has to import, nothing Tailwind has to see.
//
// PORTED FROM BlessOut's styles/BlessingDetail.module.css, KaraokeScript.module.css and
// BlessingContent.module.css (page mode), rule for rule: the class names gained a `ve-` prefix, the
// envelope and paper images became variables (--ve-env, --ve-liner, --ve-paper), and BlessOut's
// navy and gold became --ve-navy and --ve-foil so `envelope: brand` can repaint them. Where a
// BlessOut rule was declared twice (`.letterImage`, `.animatedMail`), the later one is the one the
// browser applied, so it is the one kept. Additions are marked ADDED.

export const VOICE_ECARD_CSS = String.raw`
@keyframes ve-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
@keyframes ve-fade-in { 0% { opacity: 0; } 100% { opacity: 1; } }

.ve-root { position: fixed; inset: 0; z-index: 1; overflow: hidden; color: #09164d; -webkit-tap-highlight-color: transparent; }
.ve-root *, .ve-root *::before, .ve-root *::after { box-sizing: border-box; }

/* The scene */
.ve-bg { position: fixed; inset: 0; z-index: 0; user-select: none; pointer-events: none; opacity: 0; animation: ve-fade-in 1s ease-in-out 0.3s forwards; background: radial-gradient(ellipse at 50% 30%, #1b2a6b 0%, #0a1240 55%, #050a26 100%); }
.ve-bg img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; -webkit-user-drag: none; user-select: none; }
.ve-night { position: fixed; inset: 0; z-index: 1; pointer-events: none; background: linear-gradient(to bottom, rgba(0, 0, 51, 0.2), rgba(0, 0, 102, 0.2)); }
.ve-cinemagraph { position: absolute; inset: 0; overflow: hidden; }
.ve-cinemagraph-inner { position: relative; height: 100%; width: 177.78vh; min-width: 100%; min-height: 56.25vw; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.ve-cinemagraph-inner iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: none; opacity: 0; animation: ve-cinemagraph-in 2.5s forwards; }
@keyframes ve-cinemagraph-in { 0% { opacity: 0; } 40% { opacity: 0; } 100% { opacity: 1; } }

.ve-stage { position: fixed; inset: 0; z-index: 2; display: flex; flex-direction: column; justify-content: center; align-items: center; }

/* The envelope */
.ve-hover { display: inline-block; transition: transform 1s ease-in-out; width: 0; }
.ve-container { display: flex; justify-content: center; align-items: center; height: 100%; min-height: fit-content; }
.ve-li { position: relative; width: 600px; height: 400px; cursor: pointer; opacity: 0; animation: ve-float 3s ease-in-out infinite, ve-fade-in 1s ease-in-out; animation-delay: 0.5s, 0.5s; animation-fill-mode: forwards; transition: all 0.6s cubic-bezier(0.165, 0.84, 0.44, 1); outline: none; }
.ve-mail { position: absolute; height: 300px; width: 400px; max-width: 100vw; transition: 0.4s; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.ve-env-back { position: absolute; top: 100px; left: 0; width: 100%; min-width: 400px; height: calc(100% - 100px); background-color: #ffcccb; background-image: var(--ve-env); background-size: cover; filter: brightness(1.1); z-index: 1; box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5), 0 10px 20px rgba(0, 0, 0, 0.3); }
.ve-env-inner { position: absolute; top: 0; left: 20px; right: 20px; width: calc(100% - 40px); min-width: 320px; height: 100%; background-color: #fff0ee; background-image: var(--ve-liner); background-size: cover; z-index: 2; transform: rotateY(180deg) scaleX(-1); opacity: 0; animation: ve-fade-in 2s ease-in-out forwards; animation-delay: 0.5s; }
.ve-left-fold { position: absolute; bottom: 0; width: 200px; height: 200px; transform: rotate(180deg); background-color: #e35449; background-image: var(--ve-env); background-size: cover; z-index: 6; clip-path: polygon(0 49%, 100% 0, 100% 100%); }
.ve-right-fold { position: absolute; bottom: 0; right: 0; width: 400px; height: 200px; transform: scale(-1, 1); background-color: #e35449; background-image: var(--ve-env); background-size: cover; z-index: 7; clip-path: polygon(0 100%, 100% 100%, 0 0); }
.ve-top-fold { position: absolute; top: 100px; width: 400px; height: 100%; transform-origin: top center; transition: transform 0.6s 0.4s ease-in-out, z-index 0s 0.6s; z-index: 8; display: flex; justify-content: center; align-items: center; background-color: #e35449; background-image: var(--ve-env); background-size: cover; clip-path: path('M 0 0 L 400 0 C 350 30, 250 150, 200 150 C 150 150, 50 30, 0 0'); filter: brightness(0.92); }
.ve-top-fold-back { position: absolute; top: 100px; width: 400px; height: 100%; transform-origin: top center; transform: rotateX(0deg); z-index: 7; background-color: #fff0ee; background-image: var(--ve-liner); background-size: cover; clip-path: path('M 20 0 L 380 0 C 335 27, 245 135, 200 135 C 155 135, 65 27, 20 0'); transition: transform 0.6s 0.4s ease-in-out, z-index 0s 0.6s; opacity: 0; animation: ve-fade-in 2s ease-in-out forwards; animation-delay: 0.5s; }
.ve-letter { position: absolute; top: 40%; bottom: 0; left: 40px; width: 320px; height: 80px; background: white; background-image: var(--ve-paper); background-size: cover; padding: 20px; transform: translateZ(1px); z-index: 2; overflow: hidden; opacity: 0; animation: ve-fade-in 1s ease-in-out 1s forwards; box-shadow: 0 -15px 25px rgba(0, 0, 0, 0.3); transition: transform 0.4s, height 0.4s, box-shadow 0.3s; font-family: var(--ve-face); font-style: var(--ve-face-style); color: #09164d; }
.ve-letter p { margin: 0.2rem 0; }
.ve-to, .ve-from { font-size: 1rem; color: #09164d; margin: 0.2rem 0; }
.ve-preview { white-space: pre-line; line-height: 1.1; margin-top: 0.5rem !important; }
.ve-hover-text { margin-bottom: 100px; font-size: 18px; color: white; white-space: nowrap; pointer-events: none; opacity: 1; font-family: var(--ve-title); font-style: italic; transition: opacity 2s ease 1s; text-shadow: 0 0 10px rgba(0, 0, 0, 0.5), 0 0 20px rgba(0, 0, 0, 0.3), 0 0 30px rgba(0, 0, 0, 0.1); }
.ve-shadow { display: none; }

/* Opening the flap: hover where there is a mouse; a tap (.is-open) where there is not. Keyboard
   focus opens it too (ADDED: BlessOut could not be opened from a keyboard). */
.ve-hover.is-open { transform: translateY(40px); }
.ve-li.is-open .ve-top-fold, .ve-li:focus-visible .ve-top-fold { transform: rotateX(180deg); z-index: 0; transition: transform 0.6s ease-in-out, z-index 0s 0.4s; }
.ve-li.is-open .ve-top-fold-back, .ve-li:focus-visible .ve-top-fold-back { transform: rotateX(180deg); z-index: 1; transition: transform 0.6s ease-in-out, z-index 0s 0.4s; }
.ve-li.is-open .ve-letter, .ve-li:focus-visible .ve-letter { height: 250px; transform: translateY(-150px); z-index: 3; box-shadow: 0 0 15px rgb(255, 248, 211), 0 0 25px rgb(255, 248, 211); transition: transform 0.4s 0.6s, height 0.4s 0.5s, box-shadow 0.3s 0.6s; }
.ve-li.is-open .ve-hover-text, .ve-li:focus-visible .ve-hover-text { opacity: 0; transition: opacity 0.2s ease; }
@media (hover: hover) {
  .ve-hover:hover { transform: translateY(40px); }
  .ve-li:hover .ve-top-fold { transform: rotateX(180deg); z-index: 0; transition: transform 0.6s ease-in-out, z-index 0s 0.4s; }
  .ve-li:hover .ve-top-fold-back { transform: rotateX(180deg); z-index: 1; transition: transform 0.6s ease-in-out, z-index 0s 0.4s; }
  .ve-li:hover .ve-letter { height: 250px; transform: translateY(-150px); z-index: 3; box-shadow: 0 0 15px rgb(255, 248, 211), 0 0 25px rgb(255, 248, 211); transition: transform 0.4s 0.6s, height 0.4s 0.5s, box-shadow 0.3s 0.6s; }
  .ve-li:hover .ve-hover-text { opacity: 0; transition: opacity 0.2s ease; }
}

/* ADDED: the sender's brand mark as a wax seal on the flap's point, lifted off as the flap opens. */
.ve-seal { position: absolute; left: 50%; top: 222px; width: 46px; height: 46px; margin-left: -23px; z-index: 9; border-radius: 50%; display: flex; align-items: center; justify-content: center; pointer-events: none;
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--ve-foil) 70%, white) 0%, var(--ve-foil) 45%, color-mix(in srgb, var(--ve-foil) 60%, black) 100%);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.45), inset 0 0 0 3px color-mix(in srgb, var(--ve-foil) 75%, black), inset 0 1px 2px rgba(255, 255, 255, 0.5);
  color: color-mix(in srgb, var(--ve-foil) 35%, black); transition: opacity 0.35s 0.4s ease, transform 0.6s 0.4s ease; }
.ve-seal svg, .ve-seal img { width: 24px; height: 24px; max-width: 24px; max-height: 24px; filter: drop-shadow(0 1px 0 rgba(255, 255, 255, 0.35)); }
.ve-seal > * { max-width: 26px; max-height: 26px; overflow: hidden; }
.ve-li.is-open .ve-seal, .ve-li:focus-visible .ve-seal { opacity: 0; transform: translateY(-8px) scale(0.9); transition: opacity 0.2s ease, transform 0.3s ease; }
@media (hover: hover) { .ve-li:hover .ve-seal { opacity: 0; transform: translateY(-8px) scale(0.9); transition: opacity 0.2s ease, transform 0.3s ease; } }

/* ADDED: the small line under the closed envelope. */
.ve-made { position: fixed; left: 50%; bottom: calc(22px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 3; font: 500 11px/1 system-ui, -apple-system, sans-serif; letter-spacing: 0.32em; text-indent: 0.32em; text-transform: uppercase; color: rgba(255, 246, 222, 0.72); text-decoration: none; white-space: nowrap; opacity: 0; animation: ve-fade-in 1s ease 2.2s forwards; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6); }
.ve-made:hover { color: var(--ve-foil); }

@media (max-width: 767px) {
  .ve-li { width: 300px !important; height: 200px !important; }
  .ve-mail { height: 150px !important; width: 200px !important; }
  .ve-env-back { top: 50px !important; height: calc(100% - 50px) !important; min-width: 200px !important; width: 200px !important; max-width: 200px !important; box-shadow: 0 15px 30px rgba(0, 0, 0, 0.4), 0 5px 10px rgba(0, 0, 0, 0.2) !important; }
  .ve-env-inner { top: 1px !important; min-width: 160px !important; width: calc(100% - 20px) !important; left: 10px !important; height: calc(100% - 4px) !important; }
  .ve-top-fold { top: 50px !important; width: 200px !important; height: 100% !important; clip-path: path('M 0 0 L 200 0 C 175 20, 125 75, 100 75 C 75 75, 25 20, 0 0') !important; }
  .ve-top-fold-back { top: 51px !important; width: 200px !important; height: 100% !important; clip-path: path('M 10 0 L 190 0 C 167.5 18, 122.5 67.5, 100 67.5 C 77.5 67.5, 32.5 18, 10 0') !important; }
  .ve-left-fold { width: 100px !important; height: 100px !important; }
  .ve-right-fold { width: 200px !important; height: 100px !important; }
  .ve-letter { left: 20px !important; width: 160px !important; height: 40px !important; padding: 8px !important; }
  .ve-li.is-open .ve-letter, .ve-li:focus-visible .ve-letter { height: 125px !important; transform: translateY(-80px) !important; }
  .ve-to, .ve-from, .ve-preview { font-size: 0.7rem !important; }
  .ve-preview { line-height: 1.1 !important; }
  .ve-hover-text { margin-bottom: 60px !important; font-size: 0.8rem !important; }
  .ve-seal { top: 111px; width: 30px; height: 30px; margin-left: -15px; }
  .ve-seal svg, .ve-seal img { width: 16px; height: 16px; }
  .ve-seal > * { max-width: 17px; max-height: 17px; }
}
@media (max-width: 767px) and (hover: hover) {
  .ve-li:hover .ve-letter { height: 125px !important; transform: translateY(-80px) !important; }
}

/* The envelope scene falls away while the letter flies, and returns on close */
.ve-receding { opacity: 0; transform: translateY(70px) scale(0.96); transition: opacity 0.55s ease, transform 0.55s ease; pointer-events: none; }
.ve-returning { animation: ve-fade-in 0.45s ease-out forwards; }
.ve-resizing { visibility: hidden; }

/* --- The rise-fold-zoom opening (BlessOut, 2026-07-16, v2). The card IS the inside-right page;
   the fold swings open round the left spine: the front cover on one face, the inside-left on the other. */
.ve-card3d { position: fixed; z-index: 4; pointer-events: none; perspective: 2000px; }
.ve-rising { transition: top 0.8s cubic-bezier(0.22, 0.9, 0.35, 1), left 0.8s cubic-bezier(0.22, 0.9, 0.35, 1), width 0.8s cubic-bezier(0.22, 0.9, 0.35, 1), height 0.8s cubic-bezier(0.22, 0.9, 0.35, 1); }
.ve-opening { transition: left 0.95s cubic-bezier(0.45, 0.05, 0.25, 1), top 0.95s ease; }
.ve-zooming { transition: top 0.7s cubic-bezier(0.165, 0.84, 0.44, 1), left 0.7s cubic-bezier(0.165, 0.84, 0.44, 1), width 0.7s cubic-bezier(0.165, 0.84, 0.44, 1), height 0.7s cubic-bezier(0.165, 0.84, 0.44, 1); }
.ve-closing { transition: opacity 0.35s ease; opacity: 0; }
.ve-base { position: absolute; inset: 0; background: #fffaf0; background-image: var(--ve-paper); background-size: cover; border-radius: 4px 12px 12px 4px; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.45); }
.ve-base::before { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 26px; background: linear-gradient(to right, rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0)); border-radius: 4px 0 0 4px; }
.ve-fold { position: absolute; inset: 0; transform-origin: left center; transform: rotateY(0deg); transition: transform 0.95s cubic-bezier(0.45, 0.05, 0.25, 1); transform-style: preserve-3d; }
.ve-fold.is-open { transform: rotateY(-180deg); }
.ve-front, .ve-back { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; overflow: hidden; }
.ve-front { border-radius: 4px 12px 12px 4px; background-color: #f7f3ea; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.4), 0 0 25px rgba(255, 248, 211, 0.6); display: flex; flex-direction: column; align-items: center; justify-content: center; }
.ve-back { transform: rotateY(180deg); border-radius: 12px 4px 4px 12px; background: #fffdf5; background-image: var(--ve-paper); background-size: cover; box-shadow: -12px 20px 50px rgba(0, 0, 0, 0.3); }
.ve-back::after { content: ''; position: absolute; top: 0; bottom: 0; right: 0; width: 26px; background: linear-gradient(to left, rgba(0, 0, 0, 0.16), rgba(0, 0, 0, 0)); }
.ve-cover-fallback { padding: 18px; text-align: center; color: #fff; text-shadow: 0 1px 8px rgba(0, 0, 0, 0.45); font-size: 1.1rem; font-family: var(--ve-face); font-style: var(--ve-face-style); }
.ve-cover-fallback p { margin: 0.2rem 0; }

/* The open card's letter, pinned over the inside-right page */
.ve-page-host { position: fixed; z-index: 5; overflow-y: auto; overflow-x: hidden; pointer-events: auto; display: flex; flex-direction: column; animation: ve-fade-in 0.45s ease-out forwards; overscroll-behavior: contain; scrollbar-width: thin; }
.ve-close { position: fixed; z-index: 6; width: 42px; height: 42px; border-radius: 50%; background: #fffaf0; border: 2px solid var(--ve-foil); color: var(--ve-navy); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35), 0 0 12px rgba(255, 236, 179, 0.35); transition: transform 0.15s ease, box-shadow 0.15s ease; animation: ve-fade-in 0.45s ease-out forwards; }
.ve-close:hover { transform: scale(1.1); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4), 0 0 16px rgba(255, 236, 179, 0.55); }
.ve-close:focus-visible, .ve-btn:focus-visible { outline: 2px solid var(--ve-foil); outline-offset: 3px; }

/* Portrait phones: tilt to see the whole spread */
.ve-tilt { position: fixed; z-index: 6; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); display: flex; align-items: center; gap: 10px; background: rgba(10, 16, 44, 0.8); color: #ffe9b8; border: 1px solid rgba(212, 165, 63, 0.55); border-radius: 999px; padding: 8px 16px; font: 0.85rem/1.2 system-ui, -apple-system, sans-serif; white-space: nowrap; pointer-events: none; backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); animation: ve-tilt-life 9s ease forwards; }
.ve-tilt-phone { flex: none; width: 13px; height: 21px; border: 2px solid #ffe9b8; border-radius: 4px; display: inline-block; animation: ve-tilt-phone 2.6s ease-in-out infinite; }
@keyframes ve-tilt-phone { 0%, 22% { transform: rotate(0deg); } 45%, 72% { transform: rotate(90deg); } 95%, 100% { transform: rotate(0deg); } }
@keyframes ve-tilt-life { 0% { opacity: 0; transform: translate(-50%, 10px); } 8%, 82% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, 0); } }

/* The letter on the page (BlessingContent, page mode), inside a gold-foil frame (ADDED: the
   Gilded Stationer's frame, from docs/design-language.md, in place of BlessOut's clip-art corners). */
.ve-page { position: relative; margin: auto 0; width: 100%; padding: 2.75rem 2.75rem 2.4rem; color: var(--ve-navy); }
.ve-frame { position: absolute; inset: 12px; border: 1px solid color-mix(in srgb, var(--ve-foil) 55%, transparent); border-radius: 10px; pointer-events: none; }
.ve-frame i { position: absolute; width: 20px; height: 20px; border-color: var(--ve-foil); border-style: solid; border-width: 0; }
.ve-frame i:nth-child(1) { top: -4px; left: -4px; border-top-width: 2px; border-left-width: 2px; border-top-left-radius: 6px; }
.ve-frame i:nth-child(2) { top: -4px; right: -4px; border-top-width: 2px; border-right-width: 2px; border-top-right-radius: 6px; }
.ve-frame i:nth-child(3) { bottom: -4px; left: -4px; border-bottom-width: 2px; border-left-width: 2px; border-bottom-left-radius: 6px; }
.ve-frame i:nth-child(4) { bottom: -4px; right: -4px; border-bottom-width: 2px; border-right-width: 2px; border-bottom-right-radius: 6px; }
.ve-kicker { margin: 0 0 0.9rem; font: 600 0.68rem/1 system-ui, -apple-system, sans-serif; letter-spacing: 0.42em; text-indent: 0.42em; text-transform: uppercase; text-align: center; color: color-mix(in srgb, var(--ve-foil) 70%, var(--ve-navy)); }
.ve-names { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 0.2rem 1rem; margin-bottom: 1rem; }
.ve-names p { margin: 0.2rem 0; font: 400 1rem/1.3 system-ui, -apple-system, sans-serif; color: var(--ve-navy); }
.ve-names b { font-family: var(--ve-face); font-style: var(--ve-face-style); font-weight: 700; font-size: 1.5rem; }
.ve-names span { font-style: italic; }
.ve-controls { display: flex; flex-wrap: wrap; gap: 0.6rem; margin: 0 0 1.1rem; }
.ve-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.55rem; padding: 0.75rem 1.4rem; border-radius: 50px; font: 700 1rem/1 system-ui, -apple-system, sans-serif; cursor: pointer; transition: transform 0.3s ease-in-out, box-shadow 0.3s ease-in-out, filter 0.2s; user-select: none; -webkit-user-select: none; outline: none; }
.ve-btn svg { width: 14px; height: 14px; flex: none; }
.ve-listen { background: var(--ve-navy); color: #fff; border: 2px solid var(--ve-foil); }
.ve-listen:hover { transform: scale(1.02); box-shadow: 0 0 10px var(--ve-foil); }
.ve-reply { background: linear-gradient(160deg, color-mix(in srgb, var(--ve-foil) 55%, white) 0%, var(--ve-foil) 45%, color-mix(in srgb, var(--ve-foil) 82%, black) 100%); color: var(--ve-navy); border: 1px solid rgba(255, 243, 207, 0.65); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22); }
.ve-reply:hover { transform: translateY(-2px); filter: brightness(1.05); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22), 0 0 22px color-mix(in srgb, var(--ve-foil) 55%, transparent); }
.ve-script { margin: 0; padding: 0.4rem 0.1rem; font-family: var(--ve-face); font-style: var(--ve-face-style); font-weight: 400; font-size: var(--ve-size, 1.5rem); line-height: 1.32; color: var(--ve-navy); text-align: left; }
.ve-para { margin: 0 0 0.85em; }
.ve-para:last-child { margin-bottom: 0; }
.ve-word { transition: color 140ms ease-out, opacity 140ms ease-out; border-radius: 2px; }
.ve-following .ve-coming { opacity: 0.38; }
.ve-following .ve-said { opacity: 1; }
.ve-following .ve-saying { opacity: 1; color: var(--ve-navy); background: linear-gradient(transparent 58%, color-mix(in srgb, var(--ve-foil) 72%, transparent) 58%); }
.ve-foot { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-top: 1.2rem; font: italic 400 0.8rem/1.3 system-ui, -apple-system, sans-serif; color: var(--ve-navy); }
.ve-foot a { color: inherit; opacity: 0.7; text-decoration: none; font-style: normal; letter-spacing: 0.18em; text-transform: uppercase; font-size: 0.62rem; }
@media (min-width: 768px) { .ve-script { font-size: var(--ve-size-desk, 1.75rem); line-height: 1.36; } }
@media (max-width: 600px) {
  .ve-page { padding: 2.2rem 1.9rem 2rem; }
  .ve-names { flex-direction: column; align-items: flex-start; }
  .ve-btn { flex: 1 1 auto; }
}

/* ADDED: reduced motion. One gentle cross-fade in, one out; nothing flies, floats or flips. */
@media (prefers-reduced-motion: reduce) {
  .ve-li { animation: ve-fade-in 0.6s ease forwards; }
  .ve-hover, .ve-top-fold, .ve-top-fold-back, .ve-letter, .ve-seal { transition: none !important; }
  .ve-word { transition: none; }
  .ve-tilt-phone { animation: none; }
  .ve-card3d, .ve-rising, .ve-opening, .ve-zooming { transition: opacity 0.32s ease !important; }
  .ve-fold { transition: none; }
  .ve-receding { transition: opacity 0.32s ease; transform: none; }
  .ve-card3d.ve-zooming { animation: ve-fade-in 0.32s ease both; }
}
html[data-voice-ecard-open] [data-page-menu-button] { opacity: 0; pointer-events: none; }
`
