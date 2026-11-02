import { compareApplicants } from "./ranking.js";
import styles from "./styles.js";
const template = `

<div class="prototype-bar"><div class="wrap"><span id="workspaceScope"></span><button id="resetDemo">รีเฟรชข้อมูล</button></div></div>
<nav class="nav wrap" style="min-height:60px" aria-label="งานกรรมการ"><button data-view="applicants">ผู้สมัครและอันดับ</button><button data-view="capacity">จำนวนรับ<span id="navPending"></span></button><button data-view="results">สรุปผลคัดเลือก</button></nav><span hidden id="accountName"></span><span hidden id="accountAvatar"></span>
<div class="hero"><div class="wrap"><div class="eyebrow"><span>พื้นที่กรรมการสหกิจศึกษา</span><span class="dot"></span><span>Phase 1</span></div><h1 id="pageTitle">พิจารณาผู้สมัคร</h1><p id="pageDescription">ดูข้อมูลและจัดอันดับผู้สมัคร เพื่อประกอบมติคัดเลือกเข้าแผนสหกิจศึกษา</p><span class="hero-label"><i data-icon="building"></i>ภาควิชาวิทยาการคอมพิวเตอร์ · คณะวิทยาศาสตร์และเทคโนโลยี</span></div></div>
<main class="wrap page" id="main" tabindex="-1"><div class="workflow"><div class="steps" aria-label="ขั้นตอนคัดเลือก"><div class="step current" id="step1"><em>1</em><span>พิจารณาผู้สมัคร</span></div><span class="step-line"></span><div class="step" id="step2"><em>2</em><span>ตกลงจำนวนรับ</span></div><span class="step-line"></span><div class="step" id="step3"><em>3</em><span>ยืนยันรายชื่อ</span></div></div><span class="round"><i data-icon="calendar"></i>รอบ 1/2569 <span class="mini-tag neutral" id="roundState">อยู่ระหว่างคัดเลือก</span></span></div>
<section id="screen-applicants"><div id="mobilePending" class="mobile-pending"></div><div class="layout"><div><article class="panel"><div class="panel-head"><div><h2>รายชื่อผู้สมัคร <span class="count">12</span></h2><p>เฉพาะใบสมัครที่ Coordinator ตรวจรับแล้ว</p></div><span class="info-line"><i data-icon="check-circle"></i>ข้อมูลพร้อมพิจารณา</span></div><div class="filters"><div class="field"><label for="searchInput">ค้นหาผู้สมัคร</label><div class="search"><i data-icon="search"></i><input id="searchInput" placeholder="ชื่อ–นามสกุล หรือรหัสนักศึกษา" autocomplete="off"><button id="clearSearch" aria-label="ล้างคำค้น" hidden><i data-icon="x"></i></button></div></div><div class="field"><label for="curriculum">หลักสูตร</label><select id="curriculum"><option value="61">หลักสูตร 61</option><option value="66">หลักสูตร 66</option></select></div><div class="field"><label for="program">ภาคการศึกษา</label><select id="program"><option value="regular">ภาคปกติ</option><option value="special">ภาคพิเศษ</option></select></div></div><div class="list-meta"><label for="ranking">จัดอันดับโดย<select id="ranking"><option value="core">วิชาหลัก → GPAX</option><option value="gpax">GPAX → วิชาหลัก</option></select></label><span class="mini-tag neutral" id="listScope">ภาคปกติ · 8 คน</span></div><table class="applicants"><caption class="sr">อันดับผู้สมัคร แสดงผลตามเกณฑ์ที่เลือก</caption><thead><tr><th scope="col">อันดับ</th><th scope="col">ผู้สมัคร</th><th scope="col">วิชาหลัก</th><th scope="col">GPAX</th><th scope="col">แนวโน้มคัดเลือก</th><th scope="col"><span class="sr">รายละเอียด</span></th></tr></thead><tbody id="applicantRows"></tbody></table><div class="table-foot"><span id="pageInfo"></span><div class="pagination" aria-label="หน้ารายชื่อ"><button id="previousPage" aria-label="หน้าก่อน"><i data-icon="left"></i></button><button class="active" id="pageNumber" aria-current="page">1</button><button id="nextPage" aria-label="หน้าถัดไป"><i data-icon="right"></i></button></div></div></article><p class="table-note"><i data-icon="info"></i><span>แนวโน้มคัดเลือกอิงจำนวนรับที่เสนอ รายชื่อสุดท้ายจะใช้มติที่ประชุมและยืนยันอีกครั้ง</span></p></div><aside class="aside" id="applicantAside" aria-label="ข้อเสนอจำนวนรับและคำแนะนำ"></aside></div></section>
<section id="screen-capacity" hidden></section><section id="screen-results" hidden></section>
<footer class="page-footer"><span><i data-icon="lock"></i>ข้อมูลสำหรับกรรมการในรอบที่ได้รับมอบหมาย</span><span>CO-ED · สหกิจศึกษา มหาวิทยาลัยธรรมศาสตร์</span></footer></main>
<dialog id="modal" aria-labelledby="modalTitle"></dialog><dialog id="drawer" class="drawer" aria-labelledby="drawerTitle"></dialog><div id="toast" class="toast" role="status" aria-live="polite"></div>
`;
export function renderCommitteeWorkspace({ client, signal, onSessionExpired, onAccessDenied } = {}) {
  const host = globalThis.document.createElement("section");
  host.className = "committee-workspace-host";
  host.dataset.studentPage = "committee";
  const root = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = '<div role="status">กำลังโหลดข้อมูลกรรมการ…</div>';
  let mountEvents=new AbortController();
  let model, pendingCommand, activeView = "applicants", cohortId, chosenRanking="core";
  function fail(error) {
    if (signal?.aborted) return;
    if (error.status === 401) onSessionExpired?.();
    if (error.status === 403) onAccessDenied?.("ไม่มีสิทธิ์เข้าถึงรอบนี้");
    root.innerHTML = '<p role="alert">' + (error.status === 409 ? "ข้อมูลเปลี่ยนแล้ว กรุณารีเฟรชก่อนทำรายการใหม่" : "โหลดหรือบันทึกไม่สำเร็จ กรุณาลองใหม่") + "</p><button>ลองโหลดใหม่</button>";
    root.querySelector("button").onclick = () => void refreshWorkspace();
  }
  async function refreshWorkspace() {
    try {
      model = await client.request("/api/v3/committee/workspace" + (cohortId ? "?cohort_id=" + encodeURIComponent(cohortId) : ""), { signal });
      if (signal?.aborted) return;
      mountEvents.abort();mountEvents=new AbortController();
      root.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
      root.innerHTML = template;
      mount();
      if (model.cohorts?.length > 1) {
        const select = globalThis.document.createElement("select");
        select.setAttribute("aria-label", "รอบการคัดเลือก");
        for (const c of model.cohorts) {
          const option = globalThis.document.createElement("option");
          option.value = c.id;
          option.textContent = c.cycle_name + " · " + c.department;
          select.append(option);
        }
        select.value = model.cohort_id;
        select.onchange = () => {
          cohortId = select.value;
          pendingCommand = null;
          void refreshWorkspace();
        };
        root.querySelector("#workspaceScope").replaceChildren(select);
      }
    } catch (error) {
      fail(error);
    }
  }
  async function persist(body, button) {
    if (signal?.aborted) return;
    button.disabled = true;button.setAttribute("aria-busy","true");
    const signature = JSON.stringify(body);
    if (pendingCommand?.signature !== signature) pendingCommand = { signature, body: { ...body, operation_id: crypto.randomUUID(), expected_version: model.version } };
    try {
      await client.request("/api/v3/committee/workspaces/" + model.cohort_id, { method: "POST", body: pendingCommand.body, signal });
      pendingCommand = null;
      await refreshWorkspace();
    } catch (error) {
      if(signal?.aborted)return;
      button.disabled = false;button.removeAttribute("aria-busy");
      if (error.status === 409) {
        pendingCommand = null;
        fail(error);
      } else if ([401, 403].includes(error.status)) {
        fail(error);
      } else {
        const msg = root.querySelector("#voteError,#proposalError");
        if (msg) msg.textContent = "บันทึกไม่สำเร็จ ลองอีกครั้งได้ด้วยข้อมูลเดิม";
        else {
          const modal=root.querySelector('#modal');
          if(modal?.open){let alert=modal.querySelector('[role="alert"]');if(!alert){alert=globalThis.document.createElement('p');alert.setAttribute('role','alert');modal.append(alert);}alert.textContent='บันทึกไม่สำเร็จ ลองใหม่ได้โดยใช้รายชื่อเดิม';}
          else fail(error);
        }
      }
    }
  }
  function score(n) {
    return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "—";
  }
  function mount() {
    const document={
      querySelector:root.querySelector.bind(root),querySelectorAll:root.querySelectorAll.bind(root),
      get activeElement(){return root.activeElement;},
      addEventListener:(type,listener)=>root.addEventListener(type,listener,{signal:mountEvents.signal})
    };
    "use strict";
    const paths = { users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0", discussion: "M21 11a8 8 0 0 1-8 8H6l-4 3v-7a8 8 0 1 1 19-4 M7 9h10 M7 13h6", clipboard: "M9 4H5v17h14V4h-4 M9 2h6v5H9z M8 12h8 M8 16h5", shield: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6", building: "M3 21h18 M5 21V7l7-4 7 4v14 M9 21v-4h6v4 M9 9h.01 M15 9h.01 M9 13h.01 M15 13h.01", calendar: "M5 5h14v16H5z M8 3v4 M16 3v4 M5 10h14 M8 14h2 M14 14h2", search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0", x: "M6 6l12 12 M18 6 6 18", check: "M5 12l4 4L19 6", "check-circle": "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M7 12l3 3 7-7", clock: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 6v6l4 2", arrow: "M4 12h16 M14 6l6 6-6 6", right: "M9 5l7 7-7 7", left: "M15 5l-7 7 7 7", info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M12 11v6 M12 7h.01", lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4", file: "M14 2H4v20h16V8z M14 2v6h6 M8 13h8 M8 17h5", plus: "M12 5v14 M5 12h14", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0", send: "M22 2 9 15 M22 2l-7 20-5-8-8-5z", warning: "M12 3 2 21h20z M12 9v5 M12 18h.01", history: "M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2", refresh: "M20 7a9 9 0 1 0 1 9 M20 2v5h-5" };
    const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${paths[n] || paths.file}"/></svg>`;
    function icons(root2 = document) {
      document.querySelectorAll("i[data-icon]").forEach((el) => el.outerHTML = icon(el.dataset.icon));
    }
    const $ = (s) => document.querySelector(s);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    let students = [];
    let currentView = activeView, me = 2, page = 1, search = "", program = "regular", curriculum = "61", ranking = chosenRanking, finalized = false, selected = new Set(), proposal, history = [], toastTimer;
    function initial() {
      const state = model.state;
      students = model.students.map((s) => ({ ...s, id: String(s.id) }));
      const members = model.members || [];
      me = members.indexOf(model.me) + 1;
      proposal = state.proposal ? {
        ...state.proposal,
        proposer: members.indexOf(state.proposal.proposer) + 1,
        votes: Object.fromEntries(Object.entries(state.proposal.votes).map(([id, v]) => [members.indexOf(id) + 1, v]))
      } : { number: 0, normal: 0, special: 0, proposer: 0, votes: {}, status: "none", reason: "ยังไม่มีข้อเสนอจำนวนรับ", created: "" };
      if(state.proposal?.created && Number.isFinite(Date.parse(state.proposal.created)))proposal.created=new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(state.proposal.created));
      history = state.history || [];
      selected = new Set(state.selected || []);
      finalized = !!state.finalized;
      $("#workspaceScope").textContent = model.cycle_name || "ยังไม่ได้รับมอบหมายรอบ กรุณาติดต่อผู้ดูแล";
    }
    function notify(text) {
      clearTimeout(toastTimer);
      $("#toast").textContent = text;
      toastTimer = setTimeout(() => $("#toast").textContent = "", 5e3);
    }
    function sorted(group = program) {
      return students.filter((s) => s.program === group && (currentView === "results" || s.curriculum === curriculum)).sort(compareApplicants(ranking));
    }
    function cutoff(group) {
      const rows = sorted(group).filter((s) => s.core !== null && s.gpax !== null), n = group === "regular" ? proposal.normal : proposal.special;
      if (n === 0 || !rows.length) return { n, ids: [], extra: 0 };
      let end = Math.min(n, rows.length);
      while (end < rows.length && rows[end].core === rows[end - 1].core && rows[end].gpax === rows[end - 1].gpax) end++;
      return { n, ids: rows.slice(0, end).map((s) => s.id), extra: Math.max(0, end - n) };
    }
    function rowStatus(s) {
      const c = cutoff(s.program), rows = sorted(s.program), index = rows.findIndex((r) => r.id === s.id);
      if (index >= c.n && c.ids.includes(s.id)) return '<span class="mini-tag amber">คะแนนเสมอจุดตัด</span>';
      if (c.ids.includes(s.id)) return '<span class="mini-tag rose">อยู่ในจำนวนเสนอ</span>';
      return '<span class="mini-tag neutral">นอกจำนวนเสนอ</span>';
    }
    function person(s) {
      return `<div class="person"><span class="avatar">${s.name.slice(0, 1)}</span><div><strong>${esc(s.name)}</strong><small>${esc(s.number)}</small></div></div>`;
    }
    function votesMarkup() {
      return [1, 2, 3].map((id) => {
        const proposer = proposal.proposer === id, v = proposer ? "proposer" : proposal.votes[id];
        return `<div class="vote"><span class="avatar">0${id}</span><div><strong>Committee 0${id}${me === id ? ' <span class="muted">(คุณ)</span>' : ""}</strong><small>${proposer ? "ผู้เสนอ" : v === "accepted" ? "ยอมรับข้อเสนอ" : v === "rejected" ? "ปฏิเสธข้อเสนอ" : "รอพิจารณา"}</small></div><span class="mark ${v === "pending" ? "pending" : ""}">${icon(v === "pending" ? "clock" : v === "rejected" ? "x" : "check")}</span></div>`;
      }).join("");
    }
    function votesCount() {
      return Object.values(proposal.votes).filter((v) => v === "accepted").length;
    }
    function statusTag() {
      return proposal.status === "accepted" ? '<span class="mini-tag">เห็นชอบครบแล้ว</span>' : proposal.status === "rejected" ? '<span class="mini-tag rose">ข้อเสนอถูกปฏิเสธ</span>' : '<span class="mini-tag amber">รอกรรมการพิจารณา</span>';
    }
    function personaPicker() {
      return "";
    }
    function renderAside() {
      const pendingMe = proposal.status === "pending" && proposal.votes[me] === "pending";
      $("#mobilePending").innerHTML = `<div><strong>${pendingMe ? "ข้อเสนอจำนวนรับรอคุณพิจารณา" : proposal.status === "accepted" ? "เห็นชอบจำนวนรับครบแล้ว" : "ข้อเสนอจำนวนรับของรอบนี้"}</strong><p>ปกติ ${proposal.normal} / พิเศษ ${proposal.special} คน · ${votesCount()}/2 ความเห็น</p></div><button class="btn secondary" data-go="capacity">${pendingMe ? "พิจารณา" : "ดูข้อเสนอ"} ${icon("arrow")}</button>`;
      $("#applicantAside").innerHTML = `<article class="panel"><div class="proposal-top"><div class="small">ข้อเสนอจำนวนรับ #0${proposal.number}</div><h3>${pendingMe ? "มีข้อเสนอรอคุณพิจารณา" : proposal.status === "accepted" ? "จำนวนรับที่เห็นชอบแล้ว" : "จำนวนรับสำหรับรอบนี้"}</h3><div class="quota"><div><small>ภาคปกติ</small><b>${proposal.normal}<span>คน</span></b></div><div><small>ภาคพิเศษ</small><b>${proposal.special}<span>คน</span></b></div></div><div class="quota-total"><span>จำนวนรับที่เสนอ</span><strong>${proposal.normal + proposal.special} คน</strong></div>${statusTag()}</div><div class="proposal-body"><div class="progress-copy"><span>ความเห็นจากกรรมการอีก 2 คน</span><span class="num">${votesCount()} / 2</span></div>${votesMarkup()}<p class="aside-note">${proposal.status === "accepted" ? "เห็นชอบจำนวนรับแล้ว ขั้นต่อไปตรวจทานรายชื่อและยืนยันมติคัดเลือก" : proposal.status === "rejected" ? "เสนอจำนวนรับใหม่ได้ โดยอ้างอิงความเห็นของกรรมการ" : "เมื่อกรรมการอีก 2 คนยอมรับครบ จึงนำจำนวนรับไปใช้สรุปรายชื่อ"}</p><button class="btn block" data-go="capacity">${icon(proposal.status === "accepted" ? "clipboard" : "discussion")}${pendingMe ? "พิจารณาข้อเสนอ" : "ดูรายละเอียดจำนวนรับ"}</button>${personaPicker("applicants")}</div></article><article class="panel side-help"><h3>${icon("info")}กรณีคะแนนเท่ากันที่จุดตัด</h3><p>เมื่อคะแนนที่จุดตัดเท่ากัน ให้ตรวจรายชื่อที่ต้องรับเพิ่มก่อนยืนยันผล</p><button class="aside-link" data-tie>ดูตำแหน่งคะแนนเสมอ ${icon("arrow")}</button></article>`;
      icons($("#applicantAside"));
    }
    function renderApplicants() {
      const rows = sorted(), filtered = rows.filter((s) => (s.name + " " + s.number).includes(search.trim())), pages = Math.max(1, Math.ceil(filtered.length / 6));
      page = Math.min(page, pages);
      const visible = filtered.slice((page - 1) * 6, page * 6);
      const c = cutoff(program);
      $("#clearSearch").hidden = !search;
      $("#listScope").textContent = `${program === "regular" ? "ภาคปกติ" : "ภาคพิเศษ"} · ${rows.length} คน`;
      $("#applicantRows").innerHTML = visible.length ? visible.map((s) => {
        const idx = rows.indexOf(s), isTie = idx >= c.n && c.ids.includes(s.id), separator = idx === c.n && c.n > 0 ? `<tr class="cutoff-label"><td colspan="6">${icon("info")}จำนวนรับ${proposal.status === "accepted" ? "ที่เห็นชอบ" : "ที่เสนอ"} ${c.n} คน${c.extra ? " · มีผู้สมัครคะแนนเสมอที่จุดตัด " + c.extra + " คน" : ""}</td></tr>` : "";
        return separator + `<tr class="${isTie ? "tie" : ""}"><td class="rank-cell"><span class="rank ${c.ids.includes(s.id) ? "in" : ""}">${idx + 1}</span></td><td class="person-cell">${person(s)}</td><td class="num score-cell" data-label="วิชาหลัก">${score(s.core)}</td><td class="num score-cell" data-label="GPAX">${score(s.gpax)}</td><td class="status-cell">${rowStatus(s)}</td><td class="action-cell"><button class="row-action" data-student="${s.id}" aria-label="ดูใบสมัคร ${esc(s.name)}">ดูใบสมัคร ${icon("right")}</button></td></tr>`;
      }).join("") : `<tr class="empty-row"><td colspan="6"><div class="empty">${icon("search")}<h3>ไม่พบผู้สมัครที่ตรงกับการค้นหา</h3><p>ลองเปลี่ยนคำค้นหรือเลือกหลักสูตรอื่น</p><button class="btn secondary" data-clear>ล้างคำค้นและตัวกรอง</button></div></td></tr>`;
      $("#pageInfo").textContent = filtered.length ? `แสดง ${(page - 1) * 6 + 1}–${Math.min(page * 6, filtered.length)} จาก ${filtered.length} คน` : "ไม่พบรายการ";
      $("#previousPage").disabled = page === 1;
      $("#nextPage").disabled = page === pages;
      $("#pageNumber").textContent = String(page);
      renderAside();
    }
    function renderHistory() {
      return `<div class="history"><details><summary>ประวัติข้อเสนอจำนวนรับ <span class="count">${history.length}</span></summary><ol>${history.map((h) => `<li><strong>${esc(h.title)}</strong><br>${esc(h.text)}</li>`).join("")}</ol></details></div>`;
    }
    function reviewActions() {
      if (proposal.status === "accepted") return `<div class="approval-actions"><div>กรรมการอีก 2 คนยอมรับครบแล้ว พร้อมใช้จำนวนรับประกอบมติคัดเลือก</div><button class="btn" data-go="results">จัดทำรายชื่อคัดเลือก ${icon("arrow")}</button></div>`;
      if (["none", "rejected"].includes(proposal.status)) return `<div class="approval-actions"><div>ข้อเสนอนี้สิ้นสุดแล้ว กรรมการทุกคนสามารถเสนอจำนวนรับใหม่ได้</div><button class="btn" data-propose>${icon("plus")}เสนอจำนวนรับใหม่</button></div>`;
      if (proposal.proposer === me) return `<div class="approval-actions"><div>คุณเป็นผู้เสนอ รอกรรมการอีก 2 คนพิจารณาข้อเสนอนี้</div><span class="mini-tag amber">รอ ${2 - votesCount()} คน</span></div>`;
      if (proposal.votes[me] !== "pending") return `<div class="approval-actions"><div>บันทึกความเห็นของคุณแล้ว รอกรรมการที่เหลือพิจารณา</div><span class="mini-tag">คุณยอมรับแล้ว</span></div>`;
      return `<div class="approval-actions"><div>คุณกำลังพิจารณาจำนวนรับที่เสนอ การตอบรับนี้ใช้สำหรับตกลงจำนวนรับ</div><div class="two-actions"><button class="btn secondary" data-review="reject">ปฏิเสธข้อเสนอ</button><button class="btn" data-review="accept">${icon("check")}ยอมรับข้อเสนอ</button></div></div>`;
    }
    function renderCapacity() {
      $("#screen-capacity").innerHTML = `<div class="wide-layout"><div><article class="panel"><div class="proposal-large"><div><div class="eyebrow">ข้อเสนอ #0${proposal.number} ${statusTag()}</div><h2>จำนวนรับนักศึกษา รอบ 1/2569</h2><p>เสนอโดย Committee 0${proposal.proposer} · ${proposal.created}</p></div><div class="capacity-numbers"><div><small>ภาคปกติ</small><b>${proposal.normal}</b></div><div><small>ภาคพิเศษ</small><b>${proposal.special}</b></div><div class="total"><small>รวมที่เสนอ</small><b>${proposal.normal + proposal.special}<small> คน</small></b></div></div></div><div class="review-grid"><div><h3>เหตุผลประกอบจำนวนรับ</h3><p class="rationale">${esc(proposal.reason)}</p><p class="table-note">${icon("users")}ใช้จำนวนอาจารย์ที่พร้อมดูแลและอันดับผู้สมัครประกอบการพิจารณา</p></div><div><h3>การพิจารณาของกรรมการ</h3><div class="votes-list">${votesMarkup()}</div></div></div>${reviewActions()}</article>${renderHistory()}</div><aside class="aside"><article class="panel side-help"><h3>${icon("clipboard")}ก่อนสรุปจำนวนรับ</h3><p>ตรวจรายชื่อและ Ranking ของทั้งภาคปกติและภาคพิเศษ รวมถึงผู้สมัครที่คะแนนเสมอที่จุดตัด</p><button class="aside-link" data-go="applicants">ดูรายชื่อผู้สมัคร ${icon("arrow")}</button></article><article class="panel padding"><h3>ข้อเสนอใหม่</h3><p class="muted small" style="margin:8px 0 16px">${proposal.status === "pending" ? "มีข้อเสนอที่กำลังรอพิจารณา 1 รายการ เมื่อข้อเสนอนี้สิ้นสุดจึงเริ่มรายการใหม่ได้" : proposal.status === "accepted" ? "ตกลงจำนวนรับแล้ว ไปตรวจทานรายชื่อเพื่อยืนยันผลคัดเลือก" : "กรรมการคนใดก็สามารถเสนอจำนวนรับชุดใหม่ได้"}</p><button class="btn secondary block" data-propose ${!["none", "rejected"].includes(proposal.status) ? "disabled" : ""}>${icon("plus")}เสนอจำนวนรับ</button>${personaPicker("capacity")}</article></aside></div>`;
      icons($("#screen-capacity"));
    }
    function renderResults() {
      const root2 = $("#screen-results");
      if (proposal.status !== "accepted") {
        root2.innerHTML = `<article class="panel locked"><div class="lock-icon">${icon("lock")}</div><h2>ตกลงจำนวนรับก่อนสรุปรายชื่อ</h2><p>ข้อเสนอจำนวนรับต้องได้รับการยอมรับจากกรรมการอีก 2 คนครบก่อน จึงเริ่มจัดทำรายชื่อคัดเลือกได้</p><button class="btn" data-go="capacity">ไปพิจารณาจำนวนรับ ${icon("arrow")}</button></article>`;
        return;
      }
      if (finalized) {
        root2.innerHTML = `<article class="panel locked"><div class="success-icon">${icon("check")}</div><h2>ยืนยันผลการคัดเลือกแล้ว</h2><p>รายชื่อถูกส่งให้ Coordinator ดำเนินการประกาศผล<br>สถานะ: การคัดเลือกเสร็จสิ้น รอประกาศผล</p><div class="summary-strip" style="max-width:520px;margin:24px auto"><div><span>ได้รับคัดเลือก</span><strong>${selected.size}</strong><small>คน</small></div><div><span>ไม่ได้รับคัดเลือก</span><strong>${students.length - selected.size}</strong><small>คน</small></div><div><span>ผู้ยืนยัน</span><strong style="font-size:16px">Committee 0${me}</strong></div></div><p class="tiny-label">บันทึกผลคัดเลือกเรียบร้อยแล้ว</p><button class="btn secondary" data-go="applicants">กลับไปดูรายชื่อผู้สมัคร</button></article>`;
        return;
      }
      const expected = [...cutoff("regular").ids, ...cutoff("special").ids], extra = cutoff("regular").extra + cutoff("special").extra;
      root2.innerHTML = `<div class="summary-strip"><div><span>จำนวนรับที่เห็นชอบ</span><strong>${proposal.normal + proposal.special}</strong><small>คน · ปกติ ${proposal.normal} / พิเศษ ${proposal.special}</small></div><div><span>คะแนนเสมอที่จุดตัด</span><strong>${extra}</strong><small>คน · พิจารณารับเพิ่ม</small></div><div><span>รายชื่อที่เลือกไว้</span><strong>${selected.size}</strong><small>จาก ${students.length} ผู้สมัคร</small></div></div><div class="notice note-spacing">${icon("info")}<span>ตรวจรายชื่อให้ครบทั้งสองภาคก่อนยืนยัน ข้อมูลจะส่งให้ Coordinator ดำเนินการประกาศผล</span></div><article class="panel"><div class="panel-head"><div><h2>รายชื่อประกอบมติคัดเลือก</h2><p>เลือกผู้ได้รับคัดเลือกตามมติที่ประชุม</p></div><button class="btn secondary" id="suggestSelection">เลือกตามอันดับ</button></div><table class="selection-table"><caption class="sr">เลือกรายชื่อผู้ได้รับคัดเลือก</caption><thead><tr><th scope="col">เลือก</th><th scope="col">ผู้สมัคร</th><th scope="col">ภาค</th><th scope="col">วิชาหลัก / GPAX</th></tr></thead><tbody>${["regular", "special"].flatMap((group) => sorted(group)).map((s) => `<tr><td><input class="check" type="checkbox" data-select="${s.id}" aria-label="เลือก ${esc(s.name)}" ${selected.has(s.id) ? "checked" : ""}></td><td>${person(s)}</td><td>${s.program === "regular" ? "ปกติ" : "พิเศษ"}</td><td class="num">${score(s.core)} / ${score(s.gpax)}</td></tr>`).join("")}</tbody></table><div class="selection-footer"><p>กรรมการทุกคนสามารถตรวจทานและยืนยันรายชื่อได้ รายการที่ไม่ได้เลือกจะบันทึกเป็นไม่ได้รับคัดเลือก</p><button class="btn" id="confirmResults" ${selected.size ? "" : "disabled"}>${icon("send")}ตรวจทานและยืนยันผล</button></div></article>`;
      icons(root2);
    }
    function render() {
      document.querySelectorAll("[data-view]").forEach((b) => {
        if (b.dataset.view === currentView) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
      ["applicants", "capacity", "results"].forEach((v) => $("#screen-" + v).hidden = v !== currentView);
      const title = { applicants: ["พิจารณาผู้สมัคร", "ดูข้อมูลและจัดอันดับผู้สมัคร เพื่อประกอบมติคัดเลือกเข้าแผนสหกิจศึกษา"], capacity: ["พิจารณาจำนวนรับ", "เสนอจำนวนรับร่วมกัน และบันทึกความเห็นของกรรมการในรอบนี้"], results: ["สรุปผลการคัดเลือก", "ตรวจทานรายชื่อให้ครบ ก่อนส่งผลคัดเลือกให้ Coordinator ประกาศ"] };
      $("#pageTitle").textContent = title[currentView][0];
      $("#pageDescription").textContent = title[currentView][1];
      $("#roundState").textContent = finalized ? "รอประกาศผล" : "อยู่ระหว่างคัดเลือก";
      $("#accountName").textContent = "Committee 0" + me;
      $("#accountAvatar").textContent = "0" + me;
      $("#navPending").textContent = proposal.status === "pending" && proposal.votes[me] === "pending" ? " · 1" : "";
      ["applicants", "capacity", "results"].forEach((v, i) => {
        const s = $("#step" + (i + 1));
        s.className = "step" + (currentView === v ? " current" : "") + (proposal.status === "accepted" && i === 1 ? " done" : "");
      });
      renderApplicants();
      renderCapacity();
      renderResults();
      document.querySelectorAll(".count").forEach((n) => {
        if (n.closest(".panel-head") && n.parentElement.tagName === "H2") n.textContent = students.length;
      });
    }
    function go(v) {
      currentView = v;
      activeView = v;
      render();
      $("#main").focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    const modal = $("#modal"), drawer = $("#drawer");
    let restoreFocus;
    function openModal(title, body, actions) {
      if(modal.open)modal.close();
      restoreFocus = document.activeElement;
      modal.innerHTML = `<div class="dialog-head"><h2 id="modalTitle">${title}</h2><button class="icon-button" data-close-modal aria-label="ปิดหน้าต่าง">${icon("x")}</button></div><div class="dialog-body">${body}</div><div class="dialog-actions">${actions}</div>`;
      modal.showModal();
      const first = modal.querySelector("[data-cancel]") || modal.querySelector("input") || modal.querySelector("button");
      first?.focus();
    }
    function closeModal() {
      modal.close();
      restoreFocus?.focus();
    }
    modal.addEventListener("cancel", () => {
      setTimeout(() => restoreFocus?.focus(), 0);
    });
    function vote(kind) {
      const accept = kind === "accept";
      openModal(accept ? "ยอมรับจำนวนรับที่เสนอ?" : "ปฏิเสธข้อเสนอจำนวนรับ", `<p>ข้อเสนอ #0${proposal.number} · ภาคปกติ ${proposal.normal} คน และภาคพิเศษ ${proposal.special} คน</p>${accept ? '<div class="notice blue">' + icon("info") + "<span>เมื่อกรรมการอีก 2 คนยอมรับครบ จะใช้จำนวนนี้ประกอบการสรุปรายชื่อคัดเลือก</span></div>" : '<div class="field"><label for="rejectReason">เหตุผลประกอบการปฏิเสธ</label><textarea id="rejectReason" placeholder="ระบุข้อเสนอแนะสำหรับปรับจำนวนรับ"></textarea></div><p class="tiny-label">ข้อเสนอนี้จะสิ้นสุด และเปิดให้เสนอจำนวนรับใหม่</p>'}<div class="error-text" id="voteError" role="alert"></div>`, `<button class="btn secondary" data-close-modal data-cancel>กลับไปตรวจทาน</button><button class="btn ${accept ? "" : "danger"}" id="submitVote">${accept ? "ยืนยันยอมรับ" : "ยืนยันปฏิเสธ"}</button>`);
      $("#submitVote").onclick = () => {
        if (!accept && !$("#rejectReason").value.trim()) {
          $("#voteError").textContent = "กรุณาระบุเหตุผลเพื่อให้ผู้เสนอปรับจำนวนรับได้";
          $("#rejectReason").setAttribute("aria-invalid", "true");
          $("#rejectReason").setAttribute("aria-describedby", "voteError");
          $("#rejectReason").focus();
          return;
        }
        void persist({ action: accept ? "accept" : "reject", ...!accept ? { reason: $("#rejectReason").value.trim() } : {} }, $("#submitVote"));
        ;
      };
    }
    function propose() {
      if (!["none", "rejected"].includes(proposal.status)) return;
      openModal("เสนอจำนวนรับนักศึกษา", `<p>รอบ 1/2569 · ระบุจำนวนรับแยกตามภาคการศึกษา</p><form id="proposeForm" novalidate><div class="form-grid"><div class="field"><label for="normalCount">ภาคปกติ (คน)</label><input id="normalCount" type="number" min="0" max="999" step="1" value="4" inputmode="numeric"></div><div class="field"><label for="specialCount">ภาคพิเศษ (คน)</label><input id="specialCount" type="number" min="0" max="999" step="1" value="2" inputmode="numeric"></div></div><div class="field"><label for="proposalReason">เหตุผลประกอบจำนวนรับ</label><textarea id="proposalReason" placeholder="จำนวนอาจารย์ที่พร้อมดูแล หรือข้อพิจารณาจากการประชุม"></textarea></div><div class="error-text" id="proposalError" role="alert"></div></form>`, `<button class="btn secondary" data-close-modal data-cancel>ยกเลิก</button><button class="btn" id="submitProposal">${icon("send")}ส่งข้อเสนอให้อีก 2 คน</button>`);
      $("#submitProposal").onclick = () => {
        const n = Number($("#normalCount").value), s = Number($("#specialCount").value), reason = $("#proposalReason").value.trim();
        if (!Number.isInteger(n) || !Number.isInteger(s) || n < 0 || s < 0 || n + s === 0 || n + s > 999 || !reason) {
          $("#proposalError").textContent = "ระบุจำนวนเต็มตั้งแต่ 0 คน รวมอย่างน้อย 1 คน และกรอกเหตุผลประกอบ";
          $("#proposalReason").focus();
          return;
        }
        void persist({ action: "propose", normal: n, special: s, reason }, $("#submitProposal"));
        ;
      };
    }
    let detailTab = "profile", detailStudent;
    function renderDetail() {
      const s = detailStudent;
      drawer.innerHTML = `<div class="dialog-head"><div><span class="eyebrow">ใบสมัคร · รอบ 1/2569</span><h2 id="drawerTitle">รายละเอียดผู้สมัคร</h2></div><button class="icon-button" data-close-drawer aria-label="ปิดรายละเอียดผู้สมัคร">${icon("x")}</button></div><div class="drawer-header"><div class="drawer-person"><span class="avatar">${s.name[0]}</span><div><h3>${esc(s.name)}</h3><p class="num">${esc(s.number)} <span style="font-family:Prompt,sans-serif">· ภาค${s.program === "regular" ? "ปกติ" : "พิเศษ"} · หลักสูตร ${esc(s.curriculum || "ยังไม่มีข้อมูล")}</span></p></div></div><p class="outcome-note">${icon("check-circle")}Coordinator ตรวจรับแล้ว</p></div><nav class="detail-tabs" aria-label="รายละเอียดใบสมัคร"><button data-detail="profile" class="${detailTab === "profile" ? "active" : ""}" ${detailTab === "profile" ? 'aria-current="page"' : ""}>ข้อมูลผู้สมัคร</button><button data-detail="grades" class="${detailTab === "grades" ? "active" : ""}" ${detailTab === "grades" ? 'aria-current="page"' : ""}>ผลการเรียน</button><button data-detail="documents" class="${detailTab === "documents" ? "active" : ""}" ${detailTab === "documents" ? 'aria-current="page"' : ""}>เอกสาร</button></nav><div class="dialog-body" id="detailBody">${detailContent(s)}</div>`;
    }
    function detailContent(s) {
      const p = s.payload || {};
      if (detailTab === "grades") return `<h3>ผลการเรียนที่แจ้งในใบสมัคร</h3><dl class="data-grid"><div><dt>ค่าเฉลี่ยวิชาหลักที่แจ้ง</dt><dd>${score(s.core)}</dd></div><div><dt>GPAX</dt><dd>${score(s.gpax)}</dd></div></dl><p>ตรวจเทียบกับ Transcript ก่อนยืนยันผล</p>`;
      if (detailTab === "documents") return (s.documents || []).length ? (s.documents || []).map((d) => `<div class="doc-card"><strong>${esc(d.filename || d.kind)}</strong><button class="row-action" data-live-document="${esc(d.id)}">เปิดเอกสาร</button></div>`).join("") : "<p>ยังไม่มีเอกสารในใบสมัครที่ตรวจรับแล้ว</p>";
      return `<dl class="data-grid"><div><dt>ชื่อ–นามสกุล</dt><dd>${esc(s.name)}</dd></div><div><dt>รหัสนักศึกษา</dt><dd>${esc(s.number)}</dd></div><div><dt>หลักสูตร</dt><dd>${esc(s.curriculum || "ยังไม่มีข้อมูล")}</dd></div><div><dt>ทักษะ</dt><dd>${esc(p.skills_detail || "ยังไม่มีข้อมูล")}</dd></div></dl>`;
    }
    function openStudent(id) {
      restoreFocus = document.activeElement;
      detailStudent = students.find((s) => s.id === id);
      detailTab = "profile";
      renderDetail();
      drawer.showModal();
      drawer.querySelector("button").focus();
    }
    function confirmResults() {
      const normal = students.filter((s) => s.program === "regular" && selected.has(s.id)).length, special = selected.size - normal;
      openModal("ยืนยันผลการคัดเลือก?", `<p>ตรวจจำนวนและรายชื่อให้ตรงกับมติที่ประชุมก่อนส่งให้ Coordinator</p><div class="decision-count"><strong>${selected.size}</strong>คนได้รับคัดเลือก · ปกติ ${normal} / พิเศษ ${special}<br><span class="small muted">ไม่ได้รับคัดเลือก ${students.length - selected.size} คน</span></div><div class="notice blue">${icon("send")}<span>เมื่อยืนยันแล้ว สถานะจะเป็น “การคัดเลือกเสร็จสิ้น รอประกาศผล”</span></div>`, `<button class="btn secondary" data-close-modal data-cancel>กลับไปตรวจรายชื่อ</button><button class="btn" id="sendResults">ยืนยันผลและส่ง Coordinator</button>`);
      $("#sendResults").onclick = () => {
        void persist({ action: "finalize", selected: [...selected], ranking }, $("#sendResults"));
      };
    }
    document.addEventListener("click", async (e) => {
      const docButton = e.target.closest("[data-live-document]");
      if (docButton) {
        docButton.disabled = true;
        try {
          const result = await client.request("/api/v3/committee/documents/" + encodeURIComponent(docButton.dataset.liveDocument) + "/download", { signal });
          const url = new URL(result.download.url);
          if (url.protocol !== "https:" || result.download.auth_required) throw new Error("Document link unavailable");
          const link = globalThis.document.createElement("a");
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "เปิด / ดาวน์โหลดเอกสาร (ลิงก์มีอายุ 60 วินาที)";
          docButton.after(link);
        } catch (error) {
          notify("เปิดเอกสารไม่สำเร็จ กรุณาลองใหม่");
        } finally {
          docButton.disabled = false;
        }
        return;
      }
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.view) go(b.dataset.view);
      else if (b.dataset.go) go(b.dataset.go);
      else if (b.hasAttribute("data-student")) openStudent(b.dataset.student);
      else if (b.dataset.review) vote(b.dataset.review);
      else if (b.hasAttribute("data-propose")) propose();
      else if (b.hasAttribute("data-close-modal")) closeModal();
      else if (b.hasAttribute("data-close-drawer")) {
        drawer.close();
        restoreFocus?.focus();
      } else if (b.dataset.detail) {
        detailTab = b.dataset.detail;
        renderDetail();
        drawer.querySelector(`[data-detail="${detailTab}"]`).focus();
      } else if (b.hasAttribute("data-tie")) {
        program = "regular";
        $("#program").value = program;
        page = 1;
        go("applicants");
        document.querySelector(".tie")?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (b.hasAttribute("data-clear")) {
        search = "";
        curriculum = "61";
        program = "regular";
        page = 1;
        $("#searchInput").value = "";
        $("#curriculum").value = curriculum;
        $("#program").value = program;
        renderApplicants();
      } else if (b.id === "suggestSelection") {
        selected = new Set([...cutoff("regular").ids, ...cutoff("special").ids]);
        renderResults();
        notify("เลือกรายชื่อตามอันดับและผู้มีคะแนนเสมอแล้ว กรุณาตรวจทาน");
      } else if (b.id === "confirmResults") confirmResults();
    });
    document.addEventListener("change", (e) => {
      if (e.target.id.startsWith("persona-")) {
        me = Number(e.target.value);
        render();
      }
      if (e.target.hasAttribute("data-select")) {
        const id = e.target.dataset.select;
        e.target.checked ? selected.add(id) : selected.delete(id);
        const focusId = id;
        renderResults();
        $(`[data-select="${focusId}"]`)?.focus();
      }
    });
    $("#searchInput").addEventListener("input", (e) => {
      search = e.target.value;
      page = 1;
      renderApplicants();
    });
    $("#clearSearch").onclick = () => {
      search = "";
      $("#searchInput").value = "";
      page = 1;
      renderApplicants();
      $("#searchInput").focus();
    };
    $("#curriculum").onchange = (e) => {
      curriculum = e.target.value;
      page = 1;
      renderApplicants();
    };
    $("#program").onchange = (e) => {
      program = e.target.value;
      page = 1;
      renderApplicants();
    };
    $("#ranking").onchange = (e) => {
      ranking = e.target.value;chosenRanking=ranking;
      page = 1;
      renderApplicants();
    };
    $("#previousPage").onclick = () => {
      page--;
      renderApplicants();
    };
    $("#nextPage").onclick = () => {
      page++;
      renderApplicants();
    };
    $("#resetDemo").onclick = () => void refreshWorkspace();
    drawer.addEventListener("cancel", () => restoreFocus?.focus());
    initial();
    $("#ranking").value=ranking;
    icons();
    render();
    if(!model.cohort_id)document.querySelectorAll('[data-propose],#confirmResults').forEach(b=>b.disabled=true);
    document.querySelector(".hero-label").textContent = model.cycle_name || "รอบที่ได้รับมอบหมาย";
  }
  signal?.addEventListener("abort",()=>mountEvents.abort(),{once:true});
  void refreshWorkspace();
  return host;
}
