// THE TILE APP DOOR, on the operator's own artifacts hub: <their hub>/frapp?k=<kind>&t=<title>#to=<tailnet url>
//
// Supersuit sends every tile app link through the operator's own hub when their workspace names
// one (doorLink() points at <artifacts.origin>/frapp), so a personal link never routes through
// anyone else's domain, and the door wears the hub's own brand pack (doorHtml's `theme`, built by
// src/lib/frapp-door-theme.ts).
//
// Every tile app link Supersuit texts the operator is a tailnet URL (https://<mac>.<tailnet>.ts.net/…).
// When the phone's Tailscale is off that hostname does not resolve, so no server can answer and
// Safari shows its bare "can't find the server" screen. So the texted link points HERE first. This
// page tries the tailnet from the phone, forwards the instant it answers, and otherwise says to
// turn Tailscale on and retries until it can.
//
// THREE PROPERTIES ARE THE DESIGN:
//
//   1. THE KEY NEVER REACHES THIS SERVER. The target rides in the FRAGMENT (#to=…), which a
//      browser never sends in a request, so no request log, no edge log and no analytics call
//      ever holds the frapp's one-time key. The route serves the same bytes to every visitor of
//      one host. That is also why validation happens in the page: the server never sees the target.
//   2. IT IS NOT AN OPEN REDIRECT. Only an https URL on a *.ts.net or <handle>.helm.supersuit.co host, on the default port, with
//      no userinfo, is ever followed. Anything else gets a refusal screen and no navigation.
//   3. IT NEVER PROXIES. The page only probes (a no-cors fetch, whose response is opaque and
//      unread) and navigates. Nothing from the tailnet passes through this host.
//
// The validator below is the function the page runs: its source is injected with toString(),
// so the tested function and the shipped one are the same bytes.

/**
 * Which door this hub serves, reported on GET /api/health as `door` so Supersuit can tell an
 * updated hub from an old one before it texts a link through it.
 *   1  follows *.ts.net only (no `door` field on the health answer reads as this)
 *   2  also follows <handle>.helm.supersuit.co (771552a)
 * Bump it whenever doorTarget starts following a new kind of link.
 */
export const DOOR_VERSION = 2;

/**
 * The tailnet URL a door link carries, or null when it is not one we will follow.
 * @param {string} raw  the decoded `to` value from the fragment
 */
export function doorTarget(raw) {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  // <machine>.<tailnet>.ts.net: at least two labels in front of ts.net, each a DNS label.
  const tailnet = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\.ts\.net$/.test(u.hostname);
  // <handle>.helm.supersuit.co: the hosted Helm, a public name for the Mac's tailnet address, so it
  // strands the phone the same way when Tailscale cannot reach the Mac. One
  // DNS label in front, under the Helm's own domain, so the door stays no open redirect.
  const helm = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.helm\.supersuit\.co$/.test(u.hostname);
  if (!tailnet && !helm) return null;
  return u.href;
}

/** Read `to` out of a location.hash, or null. Shipped to the page with doorTarget. */
export function doorFragment(hash) {
  if (typeof hash !== "string") return null;
  try { return new URLSearchParams(hash.replace(/^#/, "")).get("to"); } catch { return null; }
}

// WHAT THE LINK IS. The share card is the first thing the operator sees of a link, in the
// Messages bubble, before they tap, so a door link may carry `?k=<kind>&t=<title>` in the QUERY,
// which the server does see, and the card shows both.
//
// The kind is from a closed list; an unknown one is the generic card. The title is the page's own
// title, chosen to pass through this server. It is never the key: that stays in the fragment. It
// is cleaned to one short line and escaped before it goes anywhere near markup.
export const DOOR_KINDS = {
  review:  { title: "A draft for you to review",     line: "Read it on your phone and leave your notes." },
  compare: { title: "A choice for you to make",      line: "Look them over and tap the one you want." },
  approve: { title: "Waiting on your yes",           line: "Approve it, or say what to change." },
  note:    { title: "A question for you",            line: "Answer in your own words." },
  listen:  { title: "Something to listen to",        line: "Read aloud to you, on your phone." },
  portal:  { title: "Your Supersuit portal",           line: "Where your projects stand, and what is next." },
  store:   { title: "Your frapps",                   line: "Every page Pluma keeps for you." },
  room:    { title: "Your room",                     line: "Opens on your own Mac. Nothing is stored here." },
};
const GENERIC = { title: "A page from your Supersuit", line: "Private to your own devices. Opens over Tailscale." };
export const TITLE_MAX = 120;

/** A title fit for a card: one line, no control characters, at most TITLE_MAX characters, or null. */
export function doorTitle(t) {
  if (typeof t !== "string") return null;
  const one = t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
  if (!one) return null;
  return one.length > TITLE_MAX ? one.slice(0, TITLE_MAX - 1).trimEnd() + "\u2026" : one;
}

/**
 * The card for a door link: its kind (null when unknown), the kind's own words, and the page
 * title when one was given. `heading` is what the card leads with: the page title, else the kind.
 */
export function doorCard(k, t) {
  const kind = typeof k === "string" && Object.hasOwn(DOOR_KINDS, k) ? k : null;
  const base = kind ? DOOR_KINDS[kind] : GENERIC;
  const title = doorTitle(t);
  return { kind, kindTitle: base.title, line: base.line, title, heading: title || base.title };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The page's own behaviour. Kept as a function so its source is what ships, and so a test can
// read its constants. Runs in the browser; nothing here may reference Node.
function doorMain(doorTarget, doorFragment) {
  var PROBE_MS = 4000, RETRY_MS = 3000, SLOW_RETRY_MS = 10000, SLOW_AFTER_MS = 120000;
  var $ = function (id) { return document.getElementById(id); };
  var show = function (id) {
    ["checking", "help", "refused"].forEach(function (s) { $(s).hidden = s !== id; });
  };
  var target = doorTarget(doorFragment(location.hash) || "");
  if (!target) { show("refused"); return; }
  $("anyway").href = target;
  var started = Date.now(), timer = null, inflight = false, gone = false;

  function probe() {
    // An opaque answer is enough: ANY HTTP response (the store's 403 to a keyless request
    // included) proves the name resolved and the route exists. A phone off the tailnet cannot
    // resolve the name at all, so the fetch rejects, fast. A dead route times out.
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, PROBE_MS);
    var origin = new URL(target).origin;
    return fetch(origin + "/?door-probe=" + Date.now(), {
      mode: "no-cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
      signal: ctl ? ctl.signal : undefined,
    }).then(function () { clearTimeout(t); return true; }, function () { clearTimeout(t); return false; });
  }

  function attempt() {
    if (inflight || gone) return;
    inflight = true;
    $("status").textContent = "Checking…";
    probe().then(function (ok) {
      inflight = false;
      if (ok) { gone = true; location.replace(target); return; }
      // THE PROBE CAN FAIL WHERE A NAVIGATION WOULD NOT. On an iPhone with
      // Tailscale on and connected, the no-cors fetch never reached the Mac, while typing the same
      // URL into Safari loaded it at once: WebKit refuses a public page's fetch to a tailnet
      // address that it lets a top-level navigation make. So the first failed probe is not taken
      // as "Tailscale is off": the door goes to the Mac directly, ONCE. If Tailscale really is
      // off, Safari shows its own error and Back returns here, where the mark below sends the
      // page straight to the guide instead of navigating again. assign, never replace, so that
      // Back exists. The mark lives in this entry's history state, which survives Back whether
      // or not the browser kept the page in memory, and is scoped to the target so a new link
      // gets its own one try.
      if (!directTried()) { gone = true; markDirect(); location.assign(target); return; }
      show("help");
      schedule();
    });
  }

  function directTried() {
    try { return !!(history.state && history.state.doorDirect === target); } catch (e) { return false; }
  }
  function markDirect() {
    try { history.replaceState({ doorDirect: target }, "", location.href); } catch (e) { /* no history API: navigate anyway */ }
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) { $("status").textContent = ""; return; }
    var wait = Date.now() - started > SLOW_AFTER_MS ? SLOW_RETRY_MS : RETRY_MS;
    $("status").textContent = "Trying again every " + Math.round(wait / 1000) + " seconds.";
    timer = setTimeout(attempt, wait);
  }

  // A second door link opened in this tab changes only the fragment, which is a same-document
  // navigation: without this the page kept probing the FIRST target forever. A reload starts
  // clean against the new one.
  window.addEventListener("hashchange", function () { gone = true; clearTimeout(timer); location.reload(); });
  // Coming back from the Tailscale app is the moment it most likely works: try at once.
  document.addEventListener("visibilitychange", function () { if (!document.hidden) attempt(); else clearTimeout(timer); });
  window.addEventListener("online", attempt);
  window.addEventListener("pageshow", function (e) { if (e.persisted) { gone = false; attempt(); } });
  $("retry").addEventListener("click", function () { clearTimeout(timer); attempt(); });
  // Only after a beat does "checking" appear, so a phone already on the tailnet never sees it.
  setTimeout(function () { if (!gone && $("help").hidden) show("checking"); }, 700);
  // CHROME GATES THE PROBE, SO CHROME SKIPS IT. Chromium's Local Network Access refuses a
  // public page's request to a tailnet address (100.64/10) unless the person has granted
  // "local network" to this site, and the refusal is the same TypeError a phone off the tailnet
  // produces, and the door would say "turn on Tailscale" to a Mac that was on it. So where that permission exists
  // and is not granted, the probe cannot tell us anything, and the door behaves as the plain
  // link it replaced: it forwards at once. WebKit (every iPhone browser) has no such permission,
  // the query throws, and the probe runs as designed. Granted means the probe works: run it.
  lnaGated().then(function (gated) { if (gated) { gone = true; location.replace(target); } else attempt(); });
}

/** True when the browser gates local-network requests and this site has not been granted. */
export function lnaGated() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve(false);
    return navigator.permissions.query({ name: "local-network-access" })
      .then(function (s) { return s.state !== "granted"; }, function () { return false; });
  } catch (e) { return Promise.resolve(false); }
}

export const DOOR_SCRIPT = `(function () { ${lnaGated.toString()}
(${doorMain.toString()})(${doorTarget.toString()}, ${doorFragment.toString()}); })();`;

/** The look of one host's door: the tenant's brand pack, reduced to what plain HTML can wear. */
const DEFAULT_THEME = {
  name: "Supersuit",
  kicker: "A page from Supersuit",
  scheme: "dark",
  dark: { ground: "#0e0f13", ink: "#ece7dc", accent: "#c9a96e" },
  light: null,
  display: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  font: false,
  mark: null,
  backdrop: null,
};

// A theme value goes into a <style> block; nothing in one may close it or open markup.
const cssSafe = (s) => String(s).replace(/[<>{}]/g, "");

function paletteVars(p) {
  return `--ground:${cssSafe(p.ground)};--ink:${cssSafe(p.ink)};--accent:${cssSafe(p.accent)};`;
}

/** The page. Same bytes for every visitor of one host: it holds no target and no key. */
export function doorHtml({ origin = "", kind = null, title = null, theme = DEFAULT_THEME } = {}) {
  const th = { ...DEFAULT_THEME, ...(theme || {}) };
  const card = doorCard(kind, title);
  const q = new URLSearchParams();
  if (card.kind) q.set("k", card.kind);
  if (card.title) q.set("t", card.title);
  const og = `${origin}/frapp/og${q.size ? `?${q}` : ""}`;
  const desc = card.title ? `${card.kindTitle}. ${card.line}` : card.line;
  const base = th.scheme === "light" && th.light ? th.light : th.dark;
  const other = th.scheme === "system" && th.light ? th.light : null;
  const display = (th.font ? `"DoorDisplay", ` : "") + cssSafe(th.display);
  const mark = th.mark
    ? `<img class="mark" src="${esc(th.mark.src)}" width="${Number(th.mark.width) || 64}" height="${Number(th.mark.height) || 64}" alt="">`
    : "";
  const backdrop = th.backdrop ? `<div class="sky" aria-hidden="true"></div>` : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="${esc(base.ground)}">
<title>Opening your frapp · ${esc(th.name)}</title>
<meta property="og:title" content="${esc(card.heading)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="${esc(th.name)}">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<style>
  ${th.font ? `@font-face{font-family:"DoorDisplay";src:url(/frapp/font) format("truetype");font-weight:600;font-display:swap}` : ""}
  :root{color-scheme:${th.scheme === "light" ? "light" : th.scheme === "system" ? "light dark" : "dark"};${paletteVars(base)}--tap:44px;--pill:980px;
        --mute:color-mix(in srgb,var(--ink) 62%,transparent);--card:color-mix(in srgb,var(--ink) 6%,transparent);--line:color-mix(in srgb,var(--ink) 16%,transparent)}
  ${other ? `@media(prefers-color-scheme:light){:root{${paletteVars(other)}}}` : ""}
  *{box-sizing:border-box}
  [hidden]{display:none!important}
  html{background:var(--ground)}
  body{margin:0;min-height:100svh;display:grid;place-items:center;background:var(--ground);color:var(--ink);position:relative;isolation:isolate;overflow-x:hidden;
       font:1.0625rem/1.4706 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;
       letter-spacing:-.011em;-webkit-font-smoothing:antialiased;
       padding:calc(env(safe-area-inset-top) + 28px) 24px calc(env(safe-area-inset-bottom) + 28px)}
  .sky{position:absolute;inset:0 0 auto 0;height:900px;z-index:-1;pointer-events:none;opacity:.6;
       background:url(${th.backdrop ? cssSafe(th.backdrop) : "none"}) top/cover no-repeat;
       -webkit-mask-image:linear-gradient(to bottom,#000 30%,transparent 100%);mask-image:linear-gradient(to bottom,#000 30%,transparent 100%)}
  main{width:100%;max-width:24rem;text-align:center}
  section{animation:rise .6s cubic-bezier(.2,.7,.2,1) both}
  @keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .mark{display:block;width:auto;height:72px;margin:0 auto 1.1rem;filter:drop-shadow(0 0 28px color-mix(in srgb,var(--accent) 35%,transparent))}
  .kicker{font-size:.6875rem;letter-spacing:.3em;text-transform:uppercase;color:var(--accent);margin:0 0 2rem}
  h1{font:600 1.875rem/1.12 ${display};letter-spacing:-.01em;margin:0 0 .9rem;color:var(--ink)}
  p{margin:0 0 1rem}
  .lede{font-size:1.1875rem;line-height:1.4211}
  .opening{font-family:${display};font-size:1.375rem}
  .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:1rem 1.1rem;margin:1.4rem 0;text-align:left}
  .card ol{margin:0;padding-left:1.25rem}
  .card li{margin:.35rem 0}
  button{width:100%;min-height:var(--tap);padding:.8rem 1.4rem;background:var(--accent);color:var(--ground);border:1px solid transparent;
         border-radius:var(--pill);font:inherit;font-weight:600;cursor:pointer;transition:transform .08s,opacity .12s}
  button:active{transform:scale(.985)}
  button:focus-visible,a:focus-visible{outline:2.5px solid var(--accent);outline-offset:3px}
  .status{color:var(--mute);font-size:.875rem;min-height:1.3em;margin:.8rem 0 0}
  .small{color:var(--mute);font-size:.875rem;margin-top:1.6rem}
  a{color:var(--accent);text-decoration:none}
  .dots{display:inline-flex;gap:6px;margin-top:.4rem}
  .dots i{width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 1.2s infinite ease-in-out}
  .dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
  @keyframes pulse{0%,80%,100%{opacity:.25}40%{opacity:1}}
  @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head>
<body>${backdrop}<main>
  ${mark}
  <p class="kicker">${esc(th.kicker)}</p>
  <section id="checking" hidden>
    <p class="lede opening">Opening your frapp</p>
    <div class="dots" aria-label="Opening"><i></i><i></i><i></i></div>
  </section>
  <section id="help" hidden>
    <h1>Turn on Tailscale</h1>
    <p class="lede">Your phone isn't on your private network. Turn on Tailscale, then tap Retry.</p>
    <div class="card"><ol>
      <li>Open the Tailscale app and switch it on.</li>
      <li>Or swipe down to Control Center and turn on VPN.</li>
      <li>Come back here. It opens by itself once you're connected.</li>
    </ol></div>
    <button id="retry" type="button">Retry</button>
    <p class="status" id="status" aria-live="polite"></p>
    <p class="small">Tailscale already on? Your Mac may be asleep or offline. <a id="anyway" href="#" rel="noreferrer">Open it anyway</a></p>
  </section>
  <section id="refused" hidden>
    <h1>This isn't a frapp link</h1>
    <p class="lede">Supersuit only opens pages on your own private network, and this link doesn't point at one.</p>
    <p class="small">Ask Pluma to send it again.</p>
  </section>
  <noscript><p class="lede">Turn on Tailscale, then open the link again.</p></noscript>
</main>
<script>${DOOR_SCRIPT}</script>
</body></html>`;
}
