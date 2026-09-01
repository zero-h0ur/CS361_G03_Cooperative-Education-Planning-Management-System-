// ดึงส่วนต่าง ๆ ที่ต้องใช้จากหน้าเว็บมาเก็บไว้
const companyCards = Array.from(document.querySelectorAll('.partner-card'));
const extraCompanyCards = document.querySelectorAll('.partner-card-extra');
const loadMoreButton = document.getElementById('loadMoreCompanies');
const companySearch = document.getElementById('companySearch');
const searchResultStatus = document.getElementById('searchResultStatus');

// เก็บไว้ว่าผู้ใช้กดปุ่ม "ดูเพิ่มเติม" แล้วหรือยัง
// ค่า false หมายถึงยังไม่กด และ true หมายถึงกดแล้ว
let hasExpandedDirectory = false;

// ตรวจสอบว่าการ์ดบริษัทใบไหนควรแสดงหรือซ่อน
function updateCompanyVisibility() {
  // นำคำที่พิมพ์ในช่องค้นหามาตัดช่องว่าง และเปลี่ยนเป็นตัวพิมพ์เล็ก
  const query = companySearch.value.trim().toLocaleLowerCase('th');
  let visibleCount = 0;

  companyCards.forEach((card) => {
    // อ่านข้อมูลชื่อบริษัท สถานที่ และตำแหน่งงานจากการ์ด
    const companyText = card.dataset.company.toLocaleLowerCase('th');

    // ถ้าไม่ได้พิมพ์คำค้นหา ให้ถือว่าการ์ดทุกใบตรงกับคำค้นหา
    const matchesQuery = !query || companyText.includes(query);

    // การ์ดที่เหลือจะแสดงเมื่อกด "ดูเพิ่มเติม" หรือเมื่อกำลังค้นหา
    const isExtraCard = card.classList.contains('partner-card-extra');
    const canShowByGroup = !isExtraCard || hasExpandedDirectory || Boolean(query);
    const shouldShow = matchesQuery && canShowByGroup;

    // แสดงหรือซ่อนการ์ดตามผลที่ตรวจสอบได้
    card.hidden = !shouldShow;
    if (shouldShow) visibleCount += 1;
  });

  // ซ่อนปุ่ม "ดูเพิ่มเติม" ระหว่างค้นหา หรือเมื่อแสดงบริษัทครบแล้ว
  loadMoreButton.hidden = Boolean(query) || hasExpandedDirectory;

  // แสดงจำนวนบริษัทที่ค้นพบ หรือแจ้งเมื่อไม่พบข้อมูล
  if (query) {
    searchResultStatus.textContent = visibleCount > 0
      ? `พบสถานประกอบการ ${visibleCount} รายการ`
      : 'ไม่พบสถานประกอบการที่ตรงกับคำค้นหา';
  } else {
    searchResultStatus.textContent = '';
  }
}

// ทำงานเมื่อผู้ใช้กดปุ่ม "ดูเพิ่มเติม"
loadMoreButton.addEventListener('click', () => {
  hasExpandedDirectory = true;

  // บอกโปรแกรมอ่านหน้าจอว่ารายการถูกเปิดแล้ว
  loadMoreButton.setAttribute('aria-expanded', 'true');
  updateCompanyVisibility();

  // เลื่อนหน้าจอไปยังบริษัทใบแรกที่เพิ่งแสดงขึ้นมา
  const firstExtraCard = extraCompanyCards[0];
  if (firstExtraCard) {
    firstExtraCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

// ค้นหาใหม่ทุกครั้งที่ผู้ใช้พิมพ์หรือลบข้อความ
companySearch.addEventListener('input', updateCompanyVisibility);
