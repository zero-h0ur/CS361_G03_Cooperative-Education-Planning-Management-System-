const DEFAULT_MAX_ITEMS = 6;
const MAX_ALLOWED_ITEMS = 50;

export function normalizeQuery(value = '') {
  return String(value).trim().toLocaleLowerCase('th');
}

export function parsePositiveInteger(value, fallback) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

export function resolveMaxItems(value, fallback = DEFAULT_MAX_ITEMS) {
  return Math.min(
    parsePositiveInteger(value, fallback),
    MAX_ALLOWED_ITEMS
  );
}

function createSearchableText(company) {
  return [
    company.name,
    company.location,
    company.position,
    company.benefit,
    ...(company.keywords ?? [])
  ].join(' ').toLocaleLowerCase('th');
}

export function searchCompanies(
  companyList,
  { query = '', page = 1, maxItems = DEFAULT_MAX_ITEMS } = {}
) {
  const normalizedQuery = normalizeQuery(query);
  const safeMaxItems = resolveMaxItems(maxItems);
  const requestedPage = parsePositiveInteger(page, 1);

  const matchedCompanies = companyList.filter((company) => {
    if (!normalizedQuery) return true;
    return createSearchableText(company).includes(normalizedQuery);
  });

  const total = matchedCompanies.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / safeMaxItems);
  const safePage = totalPages === 0
    ? 1
    : Math.min(requestedPage, totalPages);
  const startIndex = (safePage - 1) * safeMaxItems;
  const items = matchedCompanies.slice(startIndex, startIndex + safeMaxItems);

  return {
    query: normalizedQuery,
    items,
    pagination: {
      page: safePage,
      pageSize: safeMaxItems,
      total,
      totalPages,
      hasNextPage: safePage < totalPages
    }
  };
}
