// Scoped to the Committee Shadow Root; colors match the shared Student tokens.
export default `
:host {
  --red:#b61732;
  --red-dark:#941329;
  --wine:#77192d;
  --ink:#192230;
  --muted:#536174;
  --line:#dce2e9;
  --canvas:#f3f5f7;
  --soft:#fdf0f3;
  --green:#236649;
  --green-bg:#edf7f1;
  --amber:#845c14;
  --amber-bg:#fff6df;
  --blue:#315a7b;
  --radius:8px;
  color: var(--ink);
  background: var(--canvas);
  font-family:
    Prompt,
    Inter,
    system-ui,
    sans-serif;
  font-synthesis: none;
  scrollbar-color: #9aa5b5 #e9edf2;
  scrollbar-width: thin;
}
* {
  box-sizing: border-box;
}
:host {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
}
button,
input,
select,
textarea {
  font: inherit;
}
button,
a,
input,
select,
textarea {
  touch-action: manipulation;
}
button,
a {
  -webkit-tap-highlight-color: transparent;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: .5;
}
a {
  color: var(--red);
  text-underline-offset: 4px;
}
button {
  color: inherit;
}
img {
  max-width: 100%;
}
svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  stroke: currentColor;
  stroke-width: 1.7;
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}
h1,
h2,
h3,
p {
  margin: 0;
}
h1 {
  font-size: 30px;
  letter-spacing: -.025em;
  line-height: 1.4;
}
h2 {
  font-size: 19px;
  font-weight: 600;
}
h3 {
  font-size: 16px;
  font-weight: 600;
}
small,
.small {
  font-size: 12px;
}
strong {
  font-weight: 600;
}
.muted {
  color: var(--muted);
}
.num {
  font-family:
    Inter,
    Prompt,
    sans-serif;
  font-variant-numeric: tabular-nums;
}
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  overflow: hidden;
}
.skip {
  position: fixed;
  left: 12px;
  top: -100px;
  z-index: 99;
  background: #fff;
  padding: 12px;
}
.skip:focus {
  top: 12px;
}
:focus-visible {
  outline: 3px solid var(--red);
  outline-offset: 3px;
}
[hidden] {
  display: none !important;
}
::selection {
  background: #f8d7df;
}
::-webkit-scrollbar {
  width: 9px;
  height: 9px;
}
::-webkit-scrollbar-track {
  background: #e9edf2;
}
::-webkit-scrollbar-thumb {
  background: #9aa5b5;
  border: 2px solid #e9edf2;
  border-radius: 10px;
}
::-webkit-scrollbar-thumb:hover {
  background: #68768b;
}
.wrap {
  max-width: 1440px;
  margin: auto;
  padding-inline: clamp(20px, 4vw, 60px);
}
.prototype-bar {
  background: #f8eed6;
  border-bottom: 1px solid #e5d3a5;
  color: #614d25;
  font-size: 11px;
}
.prototype-bar .wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
}
.prototype-bar button {
  border: 0;
  background: none;
  text-decoration: underline;
  color: inherit;
  font-size: 11px;
  min-height: 32px;
  padding: 3px;
}
.topbar {
  background: #fff;
  border-bottom: 1px solid var(--line);
}
.topbar > .wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 26px;
  min-height: 78px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  color: var(--ink);
  text-decoration: none;
}
.brand img {
  width: 42px;
  height: 42px;
  object-fit: contain;
}
.brand b {
  display: block;
  font-family:
    Inter,
    Prompt,
    sans-serif;
  letter-spacing: -1.2px;
  font-size: 23px;
  line-height: 1.15;
  font-weight: 800;
}
.brand small {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin-top: 3px;
}
.nav {
  display: flex;
  align-self: stretch;
  gap: 24px;
}
.nav button {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: none;
  padding: 0 4px;
  color: var(--muted);
  font-size: 13px;
  white-space: nowrap;
}
.nav button[aria-current=page] {
  border-color: var(--red);
  color: var(--red);
  font-weight: 600;
}
.nav button:hover {
  color: var(--red);
}
.nav svg {
  width: 18px;
  height: 18px;
}
.account {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.avatar {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #f5e6ea;
  color: var(--wine);
  font-size: 13px;
  font-family:
    Inter,
    Prompt,
    sans-serif;
  font-weight: 600;
}
.account small {
  display: block;
  font-size: 10px;
}
.account strong {
  font-size: 12px;
}
.account svg {
  width: 15px;
  color: var(--muted);
}
.hero {
  background: #fffdfa url(resources/images/student-campus-banner.png) right center/cover no-repeat;
  border-bottom: 1px solid var(--line);
}
.hero .wrap {
  padding-block: 26px 28px;
  min-height: 164px;
}
.eyebrow {
  display: flex;
  gap: 9px;
  align-items: center;
  font-size: 11px;
  color: var(--red);
  font-weight: 500;
  margin-bottom: 7px;
}
.eyebrow .dot {
  width: 4px;
  height: 4px;
  background: #a4aab4;
  border-radius: 50%;
}
.hero p {
  font-size: 13px;
  color: var(--muted);
  margin-top: 7px;
  max-width: 65%;
}
.hero-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  font-size: 11px;
  color: #5b5d68;
}
.hero-label svg {
  width: 14px;
  height: 14px;
}
.mobile-pending {
  display: none;
}
.page {
  padding-block: 23px 36px;
}
.workflow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 22px;
}
.steps {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  max-width: 780px;
}
.step {
  display: flex;
  align-items: center;
  gap: 9px;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
}
.step em {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border: 1px solid #c7cfd8;
  border-radius: 50%;
  font-style: normal;
  font-family: Inter, sans-serif;
  background: #fff;
}
.step.current {
  color: var(--red);
  font-weight: 500;
}
.step.current em {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
}
.step.done em {
  background: var(--green-bg);
  border-color: #b6d7c3;
  color: var(--green);
}
.step-line {
  height: 1px;
  background: var(--line);
  flex: 1;
  min-width: 20px;
}
.round {
  display: flex;
  align-items: center;
  gap: 9px;
  white-space: nowrap;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #fff;
  padding: 7px 12px;
  font-size: 12px;
}
.round svg {
  width: 16px;
  height: 16px;
  color: var(--muted);
}
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 308px;
  gap: 22px;
  align-items: start;
}
.panel {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  min-width: 0;
  overflow: hidden;
}
.panel-head {
  padding: 22px 24px 16px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}
.panel-head p {
  font-size: 12px;
  color: var(--muted);
  margin-top: 3px;
}
.panel-head h2 {
  display: flex;
  align-items: center;
  gap: 10px;
}
.count {
  font-family:
    Inter,
    Prompt,
    sans-serif;
  display: inline-grid;
  place-items: center;
  font-size: 11px;
  min-width: 27px;
  height: 24px;
  padding: 0 7px;
  border-radius: 5px;
  background: #f0f2f5;
  color: var(--muted);
  font-weight: 500;
}
.info-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
}
.info-line svg {
  width: 15px;
  height: 15px;
  color: var(--green);
}
.filters {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) 136px 132px;
  gap: 12px;
  padding: 0 24px 18px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.field label {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
}
input,
select,
textarea {
  width: 100%;
  border: 1px solid #bac4d1;
  border-radius: 6px;
  background: #fff;
  color: var(--ink);
  min-height: 44px;
  padding: 9px 11px;
  line-height: 1.5;
  font-size: 12px;
}
input::placeholder,
textarea::placeholder {
  color: #738095;
}
input[type=number] {
  font-family: Inter, sans-serif;
  font-variant-numeric: tabular-nums;
}
select {
  padding-right: 26px;
}
textarea {
  resize: none;
  min-height: 96px;
}
.search {
  position: relative;
}
.search > svg {
  position: absolute;
  left: 11px;
  top: 13px;
  width: 17px;
  height: 17px;
  color: #7a8798;
}
.search input {
  padding-left: 36px;
  padding-right: 38px;
}
.search button {
  position: absolute;
  right: 3px;
  top: 2px;
  min-height: 40px;
  width: 36px;
  border: 0;
  background: transparent;
  color: var(--muted);
}
.search button svg {
  width: 15px;
}
.list-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 24px;
  background: #f8f9fb;
  border-block: 1px solid var(--line);
}
.list-meta label {
  font-size: 11px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 8px;
}
.list-meta select {
  min-height: 36px;
  padding-block: 6px;
  font-size: 11px;
  width: 240px;
  background: #fff;
}
.mini-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 4px;
  background: #edf4ee;
  color: var(--green);
  font-size: 10px;
  white-space: nowrap;
}
.mini-tag.amber {
  background: var(--amber-bg);
  color: var(--amber);
}
.mini-tag.neutral {
  background: #eef1f5;
  color: var(--muted);
}
.mini-tag.rose {
  background: var(--soft);
  color: var(--red);
}
.mini-tag.blue {
  background: #edf3fa;
  color: var(--blue);
}
table {
  border-collapse: collapse;
  width: 100%;
  text-align: left;
  font-size: 12px;
}
th {
  font-size: 10px;
  color: var(--muted);
  font-weight: 500;
  background: #fbfcfd;
  padding: 12px 14px;
  white-space: nowrap;
}
td {
  padding: 13px 14px;
  border-top: 1px solid #e8ecf1;
  vertical-align: middle;
}
th:first-child,
td:first-child {
  padding-left: 24px;
}
th:last-child,
td:last-child {
  padding-right: 24px;
  text-align: right;
}
td.num {
  font-size: 13px;
}
.rank {
  font-family: Inter, sans-serif;
  color: var(--muted);
  font-size: 12px;
}
.rank.in {
  font-weight: 700;
  color: var(--red);
}
.person {
  display: flex;
  align-items: center;
  gap: 10px;
}
.person .avatar {
  width: 32px;
  height: 32px;
  background: #edf0f4;
  color: #58677b;
  font-size: 11px;
}
.person strong {
  display: block;
  font-size: 12px;
  white-space: nowrap;
}
.person small {
  display: block;
  font: 10px/1.6 Inter, sans-serif;
  color: var(--muted);
  margin-top: 2px;
}
.row-action {
  border: 0;
  background: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--red);
  font-size: 11px;
  min-height: 44px;
  padding: 5px 0;
  white-space: nowrap;
}
.row-action svg {
  width: 15px;
  height: 15px;
}
.tie td {
  background: #fffbf1;
}
.cutoff-label td {
  padding: 7px 24px !important;
  background: #fbf3f5;
  border-top: 1px dashed #c47b8c;
  color: var(--wine);
  font-size: 10px;
  text-align: left !important;
}
.cutoff-label svg {
  width: 12px;
  height: 12px;
  vertical-align: middle;
  margin-right: 5px;
}
.table-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 24px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
}
.pagination {
  display: flex;
  align-items: center;
  gap: 7px;
}
.pagination button {
  height: 36px;
  min-width: 36px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: #fff;
  color: var(--muted);
  font: 11px Inter, sans-serif;
}
.pagination button.active {
  background: var(--soft);
  border-color: #e8bec8;
  color: var(--red);
  font-weight: 600;
}
.pagination svg {
  width: 15px;
  height: 15px;
  vertical-align: middle;
}
.table-note {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: 11px;
  color: var(--muted);
  margin-top: 13px;
  max-width: 850px;
}
.table-note svg {
  width: 15px;
  height: 15px;
  margin-top: 2px;
}
.empty {
  padding: 48px 24px;
  text-align: center;
}
.empty > svg {
  width: 32px;
  height: 32px;
  color: #8390a0;
  margin-bottom: 12px;
}
.empty p {
  color: var(--muted);
  font-size: 12px;
  margin: 6px 0 16px;
}
.aside {
  display: grid;
  gap: 16px;
  position: sticky;
  top: 20px;
}
.proposal-top {
  background: var(--wine);
  padding: 20px 22px;
  color: #fff;
}
.proposal-top .mini-tag {
  background: #ffefca;
  color: #694a0d;
  margin-top: 12px;
}
.proposal-top .small {
  color: #e8bfc9;
  font-size: 10px;
  letter-spacing: .025em;
}
.proposal-top h3 {
  font-size: 17px;
  margin-top: 5px;
}
.quota {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-top: 20px;
}
.quota > div + div {
  border-left: 1px solid #a15568;
  padding-left: 23px;
}
.quota small {
  font-size: 10px;
  color: #efcbd4;
}
.quota b {
  display: block;
  font: 600 32px/1.3 Inter, sans-serif;
  color: white;
  margin: 4px 0;
}
.quota b span {
  font: 400 11px Prompt, sans-serif;
  margin-left: 5px;
  color: #efcbd4;
}
.quota-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #a15568;
  padding-top: 12px;
  margin-top: 16px;
  font-size: 11px;
}
.proposal-body {
  padding: 19px 22px;
}
.tiny-label {
  font-size: 10px;
  color: var(--muted);
}
.progress-copy {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 500;
  margin-bottom: 11px;
}
.vote {
  display: flex;
  gap: 10px;
  align-items: center;
  padding-block: 9px;
}
.vote .avatar {
  width: 29px;
  height: 29px;
  font-size: 10px;
}
.vote strong {
  display: block;
  font-size: 11px;
  font-weight: 500;
}
.vote small {
  font-size: 10px;
  color: var(--muted);
}
.vote .mark {
  margin-left: auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  background: var(--green-bg);
  color: var(--green);
}
.vote .mark.pending {
  background: var(--amber-bg);
  color: var(--amber);
}
.vote .mark svg {
  width: 13px;
  height: 13px;
}
.aside-note {
  font-size: 11px;
  color: var(--muted);
  padding: 12px 0 14px;
  border-top: 1px solid var(--line);
  margin-top: 9px;
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 44px;
  padding: 9px 16px;
  border: 1px solid var(--red);
  border-radius: 6px;
  font-weight: 500;
  font-size: 12px;
  background: var(--red);
  color: #fff;
  text-decoration: none;
  transition: background .15s, border-color .15s;
  white-space: normal;
}
.btn:hover:not(:disabled) {
  background: var(--red-dark);
  border-color: var(--red-dark);
}
.btn svg {
  width: 16px;
  height: 16px;
}
.btn.secondary {
  background: #fff;
  border-color: #bac4d1;
  color: var(--ink);
}
.btn.secondary:hover:not(:disabled) {
  background: #faf5f6;
  border-color: var(--red);
  color: var(--red);
}
.btn.ghost {
  background: none;
  color: var(--muted);
  border-color: transparent;
}
.btn.ghost:hover {
  background: #f3f5f7;
  color: var(--ink);
  border-color: transparent;
}
.btn.block {
  width: 100%;
}
.btn.success {
  background: var(--green);
  border-color: var(--green);
}
.btn.danger {
  background: #fff;
  color: var(--red);
  border-color: #d7a7b3;
}
.two-actions {
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: 10px;
}
.side-help {
  padding: 17px 20px;
}
.side-help h3 {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.side-help svg {
  width: 16px;
  height: 16px;
  color: var(--muted);
}
.side-help p {
  font-size: 11px;
  color: var(--muted);
  margin-top: 7px;
}
.aside-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--red);
  min-height: 38px;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.aside-link svg {
  width: 14px;
  color: inherit;
}
.page-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: var(--muted);
  padding-top: 24px;
  margin-top: 26px;
  border-top: 1px solid var(--line);
}
.page-footer span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.page-footer svg {
  width: 14px;
  height: 14px;
}
.wide-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 308px;
  gap: 22px;
  align-items: start;
}
.padding {
  padding: 24px;
}
.notice {
  border: 1px solid #e5d2a6;
  border-radius: 6px;
  background: var(--amber-bg);
  color: #71541d;
  padding: 12px 16px;
  font-size: 12px;
  display: flex;
  gap: 9px;
  align-items: flex-start;
}
.notice svg {
  margin-top: 2px;
  width: 17px;
  height: 17px;
}
.notice.green {
  border-color: #b9dbc8;
  background: var(--green-bg);
  color: var(--green);
}
.notice.blue {
  background: #f0f5fb;
  border-color: #c9d9ea;
  color: #315573;
}
.note-spacing {
  margin-bottom: 20px;
}
.proposal-large {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  padding: 24px;
  border-bottom: 1px solid var(--line);
}
.proposal-large h2 {
  font-size: 20px;
}
.proposal-large p {
  color: var(--muted);
  font-size: 12px;
  margin-top: 5px;
}
.capacity-numbers {
  display: flex;
  gap: 28px;
  align-items: center;
}
.capacity-numbers b {
  font: 600 30px/1.3 Inter, sans-serif;
  display: block;
}
.capacity-numbers small {
  font-size: 10px;
  color: var(--muted);
}
.capacity-numbers .total {
  padding-left: 28px;
  border-left: 1px solid var(--line);
  color: var(--red);
}
.review-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  padding: 24px;
}
.rationale {
  background: #f8f9fb;
  border: 1px solid #e8ecf1;
  border-radius: 6px;
  padding: 16px;
  margin-top: 10px;
  font-size: 12px;
  color: #445166;
  line-height: 1.9;
}
.votes-list .vote {
  padding-block: 13px;
  border-bottom: 1px solid #edf0f4;
}
.votes-list .vote:last-child {
  border: 0;
}
.approval-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  padding: 18px 24px;
  background: #fbfcfd;
  border-top: 1px solid var(--line);
}
.approval-actions > div:first-child {
  max-width: 380px;
  font-size: 11px;
  color: var(--muted);
}
.approval-actions .two-actions {
  min-width: 250px;
}
.history {
  margin-top: 22px;
}
.history details {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #fff;
  padding: 0 20px;
}
.history summary {
  cursor: pointer;
  min-height: 56px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  list-style: none;
}
.history summary::-webkit-details-marker {
  display: none;
}
.history summary::after {
  content: "+";
  font: 20px Inter;
}
.history details[open] summary::after {
  content: "−";
}
.history ol {
  padding-left: 18px;
  font-size: 12px;
  margin: 0 0 20px;
  color: var(--muted);
}
.history li + li {
  margin-top: 10px;
}
.summary-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: #fff;
  margin-bottom: 20px;
}
.summary-strip > div {
  padding: 16px 22px;
}
.summary-strip > div + div {
  border-left: 1px solid var(--line);
}
.summary-strip span {
  display: block;
  color: var(--muted);
  font-size: 11px;
}
.summary-strip strong {
  font-family:
    Inter,
    Prompt,
    sans-serif;
  font-size: 24px;
  font-weight: 600;
}
.summary-strip small {
  font-size: 11px;
  margin-left: 6px;
  color: var(--muted);
}
.selection-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 24px;
  border-top: 1px solid var(--line);
}
.selection-footer p {
  font-size: 11px;
  color: var(--muted);
  max-width: 420px;
}
.check {
  width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  accent-color: var(--red);
  cursor: pointer;
}
.draft-marker {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
}
.draft-marker svg {
  width: 15px;
  height: 15px;
}
.locked {
  padding: 40px 24px;
  text-align: center;
}
.locked > .lock-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #f1f3f7;
  display: grid;
  place-items: center;
  margin: 0 auto 15px;
  color: #7c8799;
}
.locked h2 {
  font-size: 19px;
}
.locked p {
  font-size: 12px;
  color: var(--muted);
  margin: 9px auto 20px;
  max-width: 420px;
}
.locked .btn {
  margin: auto;
}
.success-icon {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  background: var(--green-bg);
  color: var(--green);
  display: grid;
  place-items: center;
  margin: 0 auto 16px;
}
.success-icon svg {
  width: 27px;
  height: 27px;
}
dialog {
  border: 1px solid var(--line);
  border-radius: 12px;
  max-width: 560px;
  width: calc(100% - 32px);
  padding: 0;
  color: var(--ink);
  box-shadow: 0 24px 80px #19223030;
  max-height: calc(100dvh - 40px);
  overflow: auto;
}
dialog::backdrop {
  background: #19223070;
  backdrop-filter: blur(2px);
}
.dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 23px 26px 16px;
  border-bottom: 1px solid var(--line);
}
.dialog-head h2 {
  font-size: 20px;
}
.icon-button {
  border: 0;
  background: #f3f5f7;
  width: 36px;
  height: 36px;
  min-width: 36px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--muted);
}
.dialog-body {
  padding: 22px 26px;
}
.dialog-body > p {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 18px;
}
.dialog-body .field {
  margin-bottom: 16px;
}
.dialog-body .field label {
  font-size: 12px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 26px;
  border-top: 1px solid var(--line);
  background: #fafbfc;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.form-grid input {
  font-size: 19px;
  min-height: 56px;
}
.error-text {
  font-size: 12px;
  color: #a51a30;
  margin-bottom: 12px;
}
.error-text:empty {
  display: none;
}
.decision-count {
  background: #f8f9fb;
  padding: 15px;
  border-radius: var(--radius);
  font-size: 13px;
  margin-bottom: 18px;
}
.decision-count strong {
  font: 600 24px Inter, sans-serif;
  color: var(--red);
  padding-right: 5px;
}
.drawer {
  margin: 0 0 0 auto;
  max-width: 660px;
  width: min(660px, 100%);
  height: 100dvh;
  max-height: 100dvh;
  border-radius: 0;
  border-right: 0;
  border-block: 0;
}
.drawer .dialog-head {
  position: sticky;
  top: 0;
  background: #fff;
  z-index: 2;
}
.drawer-header {
  padding: 22px 26px;
  background: #fbf7f8;
  border-bottom: 1px solid var(--line);
}
.drawer-person {
  display: flex;
  gap: 14px;
  align-items: center;
}
.drawer-person .avatar {
  width: 49px;
  height: 49px;
  font-size: 17px;
}
.drawer-person h3 {
  font-size: 19px;
}
.drawer-person p {
  color: var(--muted);
  font-size: 12px;
}
.detail-tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
  padding-inline: 26px;
  gap: 24px;
}
.detail-tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  padding: 12px 2px;
  color: var(--muted);
  min-height: 48px;
  font-size: 12px;
}
.detail-tabs button.active {
  border-color: var(--red);
  color: var(--red);
  font-weight: 500;
}
.data-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.data-cell {
  border-bottom: 1px solid #e9edf2;
  padding-bottom: 12px;
}
.data-cell dt {
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 5px;
}
.data-cell dd {
  margin: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.course-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 18px;
}
.course {
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.course span {
  color: var(--muted);
  font-size: 11px;
}
.course strong {
  float: right;
  color: var(--red);
}
.doc-card {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 15px 0;
  border-bottom: 1px solid var(--line);
}
.doc-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 45px;
  border: 1px solid #edccd4;
  color: var(--red);
  background: var(--soft);
  border-radius: 5px;
}
.doc-card > div:nth-child(2) {
  flex: 1;
  min-width: 0;
}
.doc-card strong {
  display: block;
  font-size: 12px;
}
.doc-card small {
  color: var(--muted);
  font-size: 10px;
}
.doc-card .row-action {
  padding-left: 12px;
}
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: #233d32;
  color: #fff;
  padding: 12px 18px;
  border-radius: 8px;
  box-shadow: 0 6px 24px #19223020;
  font-size: 12px;
  z-index: 90;
  max-width: calc(100% - 32px);
  text-align: center;
}
.toast:empty {
  display: none;
}
.demo-tools {
  border-top: 1px solid var(--line);
  padding-top: 14px;
  margin-top: 14px;
  font-size: 11px;
}
.demo-tools label {
  font-size: 10px;
  color: var(--muted);
  display: block;
  margin-bottom: 6px;
}
.demo-tools select {
  font-size: 11px;
  min-height: 38px;
}
.off {
  opacity: .6;
}
.outcome-note {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--green);
  padding-top: 12px;
}
@media (min-width: 1500px) {
  :host {
    font-size: 15px;
  }
  .panel-head {
    padding-top: 25px;
  }
  .hero .wrap {
    min-height: 178px;
  }
  td {
    padding-block: 17px;
  }
}
@media (max-width: 1150px) {
  .wrap {
    padding-inline: 28px;
  }
  .nav {
    gap: 15px;
  }
  .account strong {
    font-size: 11px;
  }
  .layout,
  .wide-layout {
    grid-template-columns: minmax(0, 1fr) 276px;
    gap: 16px;
  }
  .panel-head,
  .padding {
    padding-inline: 19px;
  }
  .filters {
    grid-template-columns: 1fr 1fr;
    padding-inline: 19px;
  }
  .filters > .field:first-child {
    grid-column: 1/-1;
  }
  td,
  th {
    padding-inline: 10px;
  }
  td:first-child,
  th:first-child {
    padding-left: 19px;
  }
  td:last-child,
  th:last-child {
    padding-right: 19px;
  }
  .person {
    gap: 7px;
  }
  .person .avatar {
    display: none;
  }
  .hero p {
    max-width: 65%;
  }
  .review-grid {
    gap: 18px;
  }
  .proposal-large {
    grid-template-columns: 1fr;
  }
  .capacity-numbers {
    justify-content: space-between;
  }
  .list-meta {
    padding-inline: 19px;
  }
}
@media (max-width: 920px) {
  .mobile-pending {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    background: #fff;
    border: 1px solid #e3bcc5;
    border-left: 3px solid var(--red);
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 18px;
  }
  .mobile-pending p {
    font-size: 11px;
    color: var(--muted);
  }
  .mobile-pending strong {
    font-size: 12px;
  }
  .mobile-pending button {
    font-size: 11px;
    flex-shrink: 0;
  }
  .topbar > .wrap {
    gap: 16px;
  }
  .account > div:nth-child(2) {
    display: none;
  }
  .nav {
    gap: 16px;
  }
  .nav button {
    font-size: 12px;
  }
  .layout,
  .wide-layout {
    grid-template-columns: 1fr;
  }
  .aside {
    position: static;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .aside > .panel:first-child {
    grid-row: span 2;
  }
  .aside .proposal-top {
    padding-bottom: 16px;
  }
  .workflow {
    align-items: flex-start;
  }
  .steps {
    gap: 8px;
  }
  .step {
    gap: 6px;
    font-size: 11px;
  }
  .step-line {
    min-width: 12px;
  }
  .hero .wrap {
    min-height: 150px;
  }
  .page-footer {
    margin-top: 20px;
  }
  .review-grid {
    gap: 20px;
  }
}
@media (max-width: 600px) {
  :host {
    font-size: 14px;
  }
  .wrap {
    padding-inline: 18px;
  }
  .prototype-bar .wrap {
    align-items: flex-start;
    padding-block: 6px;
    gap: 5px;
    font-size: 10px;
  }
  .prototype-bar button {
    min-height: 24px;
    font-size: 10px;
    white-space: nowrap;
  }
  .topbar > .wrap {
    flex-wrap: wrap;
    gap: 0 16px;
    padding-top: 13px;
    min-height: auto;
  }
  .brand img {
    width: 35px;
    height: 35px;
  }
  .brand b {
    font-size: 22px;
  }
  .brand small {
    font-size: 9px;
  }
  .account {
    margin-left: auto;
  }
  .account .avatar {
    width: 34px;
    height: 34px;
    font-size: 11px;
  }
  .nav {
    order: 3;
    width: 100%;
    justify-content: space-between;
    gap: 6px;
    margin-top: 10px;
  }
  .nav button {
    flex: 1;
    justify-content: center;
    gap: 5px;
    font-size: 11px;
    min-height: 53px;
    padding: 9px 2px;
    white-space: normal;
    line-height: 1.45;
  }
  .nav svg {
    width: 17px;
    height: 17px;
  }
  .hero {
    background-position: right center;
    background-size: auto 100%;
    position: relative;
    isolation: isolate;
  }
  .hero:before {
    content: "";
    position: absolute;
    inset: 0;
    background: #fffdfa86;
    z-index: -1;
  }
  .hero .wrap {
    padding-block: 20px;
    min-height: 150px;
  }
  .hero p {
    max-width: 95%;
    font-size: 12px;
  }
  .hero h1 {
    font-size: 25px;
  }
  .hero-label {
    font-size: 10px;
  }
  .page {
    padding-top: 18px;
  }
  .workflow {
    display: block;
  }
  .steps {
    gap: 7px;
    max-width: none;
  }
  .step {
    font-size: 10px;
    gap: 5px;
    white-space: normal;
  }
  .step em {
    width: 22px;
    height: 22px;
    min-width: 22px;
    font-size: 10px;
  }
  .step-line {
    min-width: 12px;
  }
  .round {
    margin-top: 14px;
    display: inline-flex;
    font-size: 11px;
    padding: 6px 10px;
  }
  .layout,
  .wide-layout {
    gap: 18px;
  }
  .panel-head {
    padding: 18px 16px 14px;
    gap: 8px;
  }
  .panel-head h2 {
    font-size: 17px;
  }
  .panel-head p {
    font-size: 11px;
  }
  .info-line {
    display: none;
  }
  .filters {
    padding: 0 16px 16px;
    gap: 10px;
    grid-template-columns: 1fr 1fr;
  }
  .field label {
    font-size: 10px;
  }
  input,
  select,
  textarea {
    font-size: 16px;
    min-height: 46px;
  }
  .filters select {
    font-size: 12px;
  }
  .search input {
    font-size: 13px;
  }
  .search > svg {
    top: 14px;
  }
  .search button {
    height: 42px;
  }
  .list-meta {
    padding: 10px 16px;
  }
  .list-meta label {
    width: 100%;
    justify-content: space-between;
    font-size: 10px;
  }
  .list-meta select {
    font-size: 11px;
    width: 220px;
    max-width: 75%;
  }
  .mini-tag {
    font-size: 10px;
  }
  table.applicants thead {
    position: absolute;
    clip: rect(0, 0, 0, 0);
    height: 1px;
    width: 1px;
    overflow: hidden;
  }
  table.applicants t:host {
    display: block;
    padding: 0 16px;
  }
  table.applicants tr {
    display: grid;
    grid-template-columns: 28px 1fr 1fr;
    gap: 0 10px;
    border-bottom: 1px solid var(--line);
    padding: 16px 0;
  }
  table.applicants td {
    border: 0;
    padding: 0 !important;
    text-align: left;
    min-width: 0;
  }
  table.applicants .person-cell {
    grid-column: 2/4;
  }
  table.applicants .rank-cell {
    grid-row: 1/4;
    padding-top: 3px !important;
  }
  table.applicants .rank {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 5px;
    background: #f0f2f5;
    font-size: 11px;
  }
  table.applicants .rank.in {
    color: var(--red);
    background: var(--soft);
  }
  table.applicants .person {
    margin-bottom: 11px;
  }
  table.applicants .person .avatar {
    display: none;
  }
  table.applicants .person strong {
    font-size: 13px;
  }
  table.applicants .person small {
    font-size: 10px;
  }
  table.applicants .score-cell {
    font-size: 17px;
    margin-bottom: 11px;
  }
  table.applicants .score-cell::before {
    content: attr(data-label);
    display: block;
    font: 10px/1.8 Prompt, sans-serif;
    color: var(--muted);
    margin-bottom: 1px;
  }
  table.applicants .status-cell {
    grid-column: 2/3;
    align-self: center;
  }
  table.applicants .action-cell {
    grid-column: 3/4;
    text-align: right;
    align-self: center;
  }
  table.applicants .row-action {
    font-size: 11px;
    min-height: 38px;
  }
  table.applicants tr.tie {
    background: #fffbf1;
    margin: 0 -16px;
    padding-inline: 16px;
  }
  table.applicants tr.cutoff-label {
    display: block;
    margin: 0 -16px;
    padding: 7px 16px;
    background: #fbf3f5;
    border-top: 1px dashed #c47b8c;
  }
  table.applicants .cutoff-label td {
    display: block;
    background: none;
    border: none;
    font-size: 10px;
  }
  table.applicants .empty-row {
    display: block;
  }
  table.applicants .empty-row td {
    display: block;
  }
  .table-foot {
    padding: 14px 16px;
    font-size: 10px;
  }
  .table-note {
    font-size: 10px;
    line-height: 1.8;
  }
  .aside {
    display: grid;
    grid-template-columns: 1fr;
  }
  .aside > .panel:first-child {
    grid-row: auto;
  }
  .aside > .side-help {
    display: none;
  }
  .proposal-top {
    padding: 18px 20px;
  }
  .proposal-top h3 {
    font-size: 17px;
  }
  .proposal-body {
    padding: 18px 20px;
  }
  .btn {
    font-size: 12px;
    min-height: 46px;
  }
  .page-footer {
    font-size: 10px;
    display: block;
    padding-top: 18px;
  }
  .page-footer > span + span {
    margin-top: 8px;
  }
  .proposal-large {
    padding: 20px;
    gap: 20px;
  }
  .proposal-large h2 {
    font-size: 19px;
  }
  .capacity-numbers {
    gap: 18px;
  }
  .capacity-numbers b {
    font-size: 28px;
  }
  .capacity-numbers .total {
    padding-left: 18px;
  }
  .review-grid {
    grid-template-columns: 1fr;
    padding: 20px;
    gap: 22px;
  }
  .approval-actions {
    flex-direction: column;
    padding: 18px 20px;
    gap: 14px;
    align-items: stretch;
  }
  .approval-actions .two-actions {
    min-width: 0;
    width: 100%;
  }
  .notice {
    font-size: 11px;
    padding: 12px;
  }
  .summary-strip > div {
    padding: 13px 12px;
  }
  .summary-strip span {
    font-size: 10px;
  }
  .summary-strip strong {
    font-size: 24px;
  }
  .summary-strip small {
    display: block;
    font-size: 10px;
    margin: 0;
  }
  .selection-footer {
    display: block;
    padding: 18px 16px;
  }
  .selection-footer .btn {
    width: 100%;
    margin-top: 15px;
  }
  .selection-table th,
  .selection-table td {
    padding: 12px 8px;
    font-size: 11px;
  }
  .selection-table th:first-child,
  .selection-table td:first-child {
    padding-left: 14px;
  }
  .selection-table th:last-child,
  .selection-table td:last-child {
    padding-right: 14px;
  }
  .selection-table .person strong {
    font-size: 11px;
    white-space: normal;
  }
  .selection-table .person small {
    font-size: 9px;
  }
  .selection-table .person .avatar {
    display: none;
  }
  .dialog-head {
    padding: 20px 20px 15px;
  }
  .dialog-body {
    padding: 20px;
  }
  .dialog-actions {
    padding: 15px 20px;
  }
  .dialog-actions .btn {
    flex: 1;
  }
  .form-grid {
    gap: 12px;
  }
  .form-grid input {
    font-size: 21px;
  }
  .dialog-head h2 {
    font-size: 19px;
  }
  .drawer .dialog-head {
    padding-inline: 20px;
  }
  .drawer-header {
    padding: 20px;
  }
  .detail-tabs {
    padding-inline: 20px;
    justify-content: space-between;
    gap: 15px;
  }
  .data-grid {
    gap: 16px 12px;
  }
  .data-cell dd {
    font-size: 12px;
  }
  .data-cell dt {
    font-size: 10px;
  }
  .course-list {
    gap: 10px;
  }
  .course {
    padding: 12px;
  }
  .doc-card {
    gap: 10px;
  }
  .doc-card strong {
    font-size: 11px;
  }
  .doc-card .row-action {
    font-size: 10px;
  }
  .locked {
    padding: 32px 20px;
  }
  .history summary {
    font-size: 11px;
  }
  .history ol {
    font-size: 11px;
  }
  .toast {
    bottom: 16px;
    font-size: 11px;
    width: max-content;
  }
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition: none !important;
    animation: none !important;
  }
}
@media (forced-colors: active) {
  :host {
    scrollbar-color: auto;
  }
  .mini-tag {
    border: 1px solid currentColor;
  }
  .nav button[aria-current=page] {
    border-bottom: 3px solid currentColor;
  }
  .rank.in {
    border: 1px solid currentColor;
  }
}
.nav {
  min-height: 60px;
}
:host {
  display: block;
  font-family:
    Prompt,
    Inter,
    sans-serif;
}
:host [hidden] {
  display: none !important;
}
`;
