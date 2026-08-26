const companyCards = Array.from(document.querySelectorAll('.partner-card'));
const extraCompanyCards = document.querySelectorAll('.partner-card-extra');
const loadMoreButton = document.getElementById('loadMoreCompanies');
const companySearch = document.getElementById('companySearch');
const searchResultStatus = document.getElementById('searchResultStatus');

let hasExpandedDirectory = false;

function updateCompanyVisibility() {
  const query = companySearch.value.trim().toLocaleLowerCase('th');
  let visibleCount = 0;

  companyCards.forEach((card) => {
    const companyText = card.dataset.company.toLocaleLowerCase('th');
    const matchesQuery = !query || companyText.includes(query);
    const isExtraCard = card.classList.contains('partner-card-extra');
    const canShowByGroup = !isExtraCard || hasExpandedDirectory || Boolean(query);
    const shouldShow = matchesQuery && canShowByGroup;

    card.hidden = !shouldShow;
    if (shouldShow) visibleCount += 1;
  });

  loadMoreButton.hidden = Boolean(query) || hasExpandedDirectory;

  if (query) {
    searchResultStatus.textContent = visibleCount > 0
      ? `พบสถานประกอบการ ${visibleCount} รายการ`
      : 'ไม่พบสถานประกอบการที่ตรงกับคำค้นหา';
  } else {
    searchResultStatus.textContent = '';
  }
}

loadMoreButton.addEventListener('click', () => {
  hasExpandedDirectory = true;
  loadMoreButton.setAttribute('aria-expanded', 'true');
  updateCompanyVisibility();

  const firstExtraCard = extraCompanyCards[0];
  if (firstExtraCard) {
    firstExtraCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

companySearch.addEventListener('input', updateCompanyVisibility);
