(function exposeCompanyDirectoryHelpers(root, factory) {
  const helpers = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = helpers;
  }

  if (root) {
    root.CompanyDirectoryHelpers = helpers;
  }
})(typeof window !== 'undefined' ? window : globalThis, function createCompanyDirectoryHelpers() {
  function buildCompanyQuery({ query = '', location = '', page = 1, pageSize = 10 } = {}) {
    const params = new URLSearchParams();
    const normalizedQuery = String(query).trim();
    const normalizedLocation = String(location).trim();

    if (normalizedQuery) params.set('q', normalizedQuery);
    if (normalizedLocation) params.set('location', normalizedLocation);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));

    return params.toString();
  }

  function mergeUniqueCompanies(existing = [], incoming = []) {
    const companiesById = new Map();

    [...existing, ...incoming].forEach((company) => {
      if (company && company.id != null) {
        companiesById.set(String(company.id), company);
      }
    });

    return Array.from(companiesById.values());
  }

  function getDataStatusIndicator(company = {}) {
    if (company.data_status === 'to_validate') {
      return { label: 'รอตรวจสอบ', className: 'status-to-validate' };
    }

    if (company.data_status === 'mock' || company.source === 'mock') {
      return { label: 'ข้อมูลจำลอง', className: 'status-mock' };
    }

    return null;
  }

  return {
    buildCompanyQuery,
    mergeUniqueCompanies,
    getDataStatusIndicator
  };
});
