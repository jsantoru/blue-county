import { CLUB_MEMBERS, type ClubMemberId } from "./club-roster";

const html = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export function garageMarkup(
  choice: number,
  selected: ClubMemberId,
  busy: boolean,
  error: string,
  focus: number,
) {
  const member = CLUB_MEMBERS[choice];
  return `<section class="panel garage-panel" aria-label="Lug Nuts driver and car selection" aria-busy="${busy}">
    <header class="garage-header"><div class="club-mark" aria-hidden="true">LN</div><div><div class="eyebrow">GOOD FRIENDS. GREAT CARS.</div><h1>THE LUG NUTS</h1></div><span class="garage-count">5 MEMBERS<br><b>ONE CLUB</b></span></header>
    <div class="garage-hero" style="--member-color:${member.accent}">
      <div class="garage-car-image"><img src="${member.preview}" alt="Game model of ${html(member.name)}’s ${member.year} ${html(member.carName)}"><span class="garage-year">${member.year}</span></div>
      <div class="garage-profile"><div class="eyebrow">YOUR DRIVER &amp; THEIR RIDE</div><h2>${html(member.name)}</h2><h3>${html(member.carName)}</h3><p class="garage-color"><i></i>${html(member.color)}</p><p class="garage-note">${html(member.note)}</p><div class="garage-pairing">Choose the member. Get their car.</div></div>
    </div>
    <nav class="garage-roster" aria-label="Club members">${CLUB_MEMBERS.map((m, i) => `<button class="garage-member ${choice === i ? "chosen" : ""} ${focus === i ? "focus" : ""}" data-index="${i}" data-member="${m.id}" aria-pressed="${choice === i}" ${busy ? "disabled" : ""} style="--member-color:${m.accent}"><img src="${m.preview}" alt=""><span class="garage-member-name">${html(m.name)}${m.id === selected ? "<small>CURRENT</small>" : ""}</span><span class="garage-member-car">’${String(m.year).slice(-2)} ${html(m.shortCarName)}</span></button>`).join("")}</nav>
    <div class="garage-bottom"><div class="garage-help">← → / D-pad choose · A / Enter select · B / Esc back<br><span>Selection is saved. Changing members starts at Beverly Drive.</span></div><nav class="garage-actions"><button class="garage-back ${focus === 6 ? "focus" : ""}" data-index="6">Back</button><button class="garage-drive ${focus === 5 ? "focus" : ""}" data-index="5" ${busy ? "disabled" : ""}>${busy ? "Getting the car ready…" : `Drive as ${html(member.name)} <span>↗</span>`}</button></nav></div>
    <p class="garage-disclosure">Joe’s photo-based character is included. The other members currently use stand-in characters.</p>
    ${error ? `<div class="safety" role="alert">${html(error)}</div>` : ""}
  </section>`;
}
