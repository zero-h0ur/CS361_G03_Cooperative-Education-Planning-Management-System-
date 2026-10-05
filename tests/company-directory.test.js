const {
  buildCompanyQuery,
  mergeUniqueCompanies,
  getDataStatusIndicator,
  createLatestRequestTracker
} = require('../company-directory-helpers');

describe('company directory helpers', () => {
  test('builds the supported V2 company query', () => {
    const query = buildCompanyQuery({
      query: '  developer  ',
      location: 'กรุงเทพฯ',
      page: 2,
      pageSize: 10
    });

    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      q: 'developer',
      location: 'กรุงเทพฯ',
      page: '2',
      pageSize: '10'
    });
  });

  test('omits empty optional filters', () => {
    const params = new URLSearchParams(buildCompanyQuery());

    expect(params.has('q')).toBe(false);
    expect(params.has('location')).toBe(false);
    expect(params.get('page')).toBe('1');
    expect(params.get('pageSize')).toBe('10');
  });

  test('merges pages without duplicating a company id', () => {
    const firstPage = [{ id: 1, name: 'Company A' }, { id: 2, name: 'Company B' }];
    const secondPage = [{ id: 2, name: 'Company B updated' }, { id: 3, name: 'Company C' }];

    expect(mergeUniqueCompanies(firstPage, secondPage)).toEqual([
      { id: 1, name: 'Company A' },
      { id: 2, name: 'Company B updated' },
      { id: 3, name: 'Company C' }
    ]);
  });

  test.each([
    [{ data_status: 'mock', source: 'seed' }, 'ข้อมูลจำลอง', 'status-mock'],
    [{ data_status: 'verified', source: 'mock' }, 'ข้อมูลจำลอง', 'status-mock'],
    [{ data_status: 'to_validate', source: 'seed' }, 'รอตรวจสอบ', 'status-to-validate']
  ])('maps mock and to_validate records to visible badges', (company, label, className) => {
    expect(getDataStatusIndicator(company)).toEqual({ label, className });
  });

  test('does not add a warning badge to a verified record', () => {
    expect(getDataStatusIndicator({ data_status: 'verified', source: 'official' })).toBeNull();
  });

  test('invalidates an older request before its response can update the page', () => {
    const tracker = createLatestRequestTracker();
    const firstRequest = tracker.start();

    tracker.invalidate();
    const secondRequest = tracker.start();

    expect(tracker.isCurrent(firstRequest)).toBe(false);
    expect(tracker.isCurrent(secondRequest)).toBe(true);
  });
});
