const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://host.docker.internal:8000/api/v1').replace(/\/+$/, '');
const VERIFY_API_BASE_URL = (process.env.VERIFY_API_BASE_URL ?? API_BASE_URL).replace(/\/+$/, '');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DEMO_LIBRARY_TIME = process.env.DEMO_LIBRARY_TIME ?? '2020-01-01T12:00:00Z';
const DEMO_BOOK_COUNT = 40;
const DEMO_MEMBER_COUNT = 10;
const DEMO_LOAN_COUNT = 15;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD in the runtime environment.');
}

const demoTime = new Date(DEMO_LIBRARY_TIME);
if (!Number.isFinite(demoTime.getTime())) {
  throw new Error('DEMO_LIBRARY_TIME must be a valid date and time.');
}
const reportDate = demoTime.toISOString().slice(0, 10);

async function request(path, { method = 'GET', token, body, baseUrl = API_BASE_URL } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Could not reach the configured API. Check API_BASE_URL and network access.');
  }

  if (!response.ok) {
    let code = '';
    try {
      const error = await response.json();
      code = typeof error.code === 'string' ? ` (${error.code})` : '';
    } catch {
      // Keep response bodies out of logs; they may contain sensitive server details.
    }
    throw new Error(`${method} ${path} failed with HTTP ${response.status}${code}.`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getAll(path, token, extraQuery = '', baseUrl = API_BASE_URL) {
  const items = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (items.length < total) {
    const query = new URLSearchParams(extraQuery);
    query.set('page', String(page));
    query.set('size', '50');
    const result = await request(`${path}?${query}`, { token, baseUrl });
    if (!Array.isArray(result.items)) {
      throw new Error(`GET ${path} returned an unexpected paginated response.`);
    }
    items.push(...result.items);
    total = Number(result.total);
    if (!Number.isFinite(total) || result.items.length === 0) break;
    page += 1;
  }

  return items;
}

function isbnFor(sequence) {
  const stem = `979999${String(sequence).padStart(6, '0')}`;
  const sum = [...stem].reduce((value, digit, index) => value + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${stem}${(10 - (sum % 10)) % 10}`;
}

async function main() {
  const login = await request('/auth/login', {
    method: 'POST',
    body: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!login.access_token || login.role !== 'admin') {
    throw new Error('API login did not return an admin access token.');
  }
  const token = login.access_token;

  const categoriesResponse = await request('/categories', { token });
  const categories = categoriesResponse.items;
  if (!Array.isArray(categories) || categories.length === 0 || categories.some(({ id }) => !id)) {
    throw new Error('GET /categories did not return usable category IDs.');
  }

  const existingBooks = await getAll('/books', token);
  const existingMembers = await getAll('/members', token);
  const booksByTitle = new Map(existingBooks.map((book) => [book.title, book]));
  const usedIsbns = new Set(existingBooks.map((book) => book.isbn));
  const membersByDocument = new Map(existingMembers.map((member) => [member.document_number, member]));
  const books = [];
  const members = [];
  let booksCreated = 0;
  let membersCreated = 0;

  for (let index = 1; index <= DEMO_BOOK_COUNT; index += 1) {
    const title = `T21 Demo Book ${String(index).padStart(3, '0')}`;
    let book = booksByTitle.get(title);
    if (!book) {
      let isbnSequence = index;
      while (usedIsbns.has(isbnFor(isbnSequence))) isbnSequence += DEMO_BOOK_COUNT;
      const isbn = isbnFor(isbnSequence);
      book = await request('/books', {
        method: 'POST',
        token,
        body: {
          title,
          author: `T21 Demo Author ${String(index).padStart(3, '0')}`,
          isbn,
          category_id: categories[(index - 1) % categories.length].id,
          total_copies: 3,
        },
      });
      usedIsbns.add(isbn);
      booksCreated += 1;
    }
    if (!book.id) throw new Error(`Book ${title} was created without an ID.`);
    books.push(book);
  }

  for (let index = 1; index <= DEMO_MEMBER_COUNT; index += 1) {
    const suffix = String(index).padStart(3, '0');
    const documentNumber = `T21-DEMO-MEMBER-${String(index).padStart(4, '0')}`;
    let member = membersByDocument.get(documentNumber);
    if (!member) {
      member = await request('/members', {
        method: 'POST',
        token,
        body: {
          full_name: `T21 Demo Member ${suffix}`,
          document_number: documentNumber,
        },
      });
      membersCreated += 1;
    }
    if (!member.id) throw new Error(`Member ${documentNumber} was created without an ID.`);
    members.push(member);
  }

  let loansCreated = 0;
  const loansByMember = new Map();
  let existingDemoMemberLoans = 0;
  const demoBookIds = new Set(books.map((book) => book.id));
  const activeDemoLoanIds = new Set();
  for (const member of members) {
    const loans = await getAll('/loans', token, `member_id=${encodeURIComponent(member.id)}`);
    loansByMember.set(member.id, loans);
    const demoLoans = loans.filter((loan) => loan.items?.some((item) => demoBookIds.has(item.book_id)));
    existingDemoMemberLoans += demoLoans.length;
    for (const loan of demoLoans) {
      if (loan.items?.some((item) => demoBookIds.has(item.book_id) && item.returned_at === null)) {
        activeDemoLoanIds.add(loan.id);
      }
    }
  }

  if (existingDemoMemberLoans < DEMO_LOAN_COUNT || activeDemoLoanIds.size < 3) {
    for (
      let index = 0;
      index < DEMO_BOOK_COUNT && (existingDemoMemberLoans < DEMO_LOAN_COUNT || activeDemoLoanIds.size < 3);
      index += 1
    ) {
      const member = members[index % members.length];
      const book = books[index];
      const memberLoans = loansByMember.get(member.id);
      const alreadySeeded = memberLoans.some((loan) => loan.items?.some((item) => item.book_id === book.id));
      if (alreadySeeded) continue;

      const activeItems = memberLoans.reduce(
        (count, loan) => count + (loan.items ?? []).filter((item) => item.returned_at === null).length,
        0,
      );
      if (activeItems >= 3) continue;

      const loan = await request('/loans', {
        method: 'POST',
        token,
        body: { member_id: member.id, items: [{ book_id: book.id }] },
      });
      loansCreated += 1;
      existingDemoMemberLoans += 1;
      if (loan.items?.some((item) => demoBookIds.has(item.book_id) && item.returned_at === null)) {
        activeDemoLoanIds.add(loan.id);
      }
      memberLoans.push(loan);
    }
  }

  if (existingDemoMemberLoans < DEMO_LOAN_COUNT || activeDemoLoanIds.size < 3) {
    throw new Error(`Could ensure ${existingDemoMemberLoans} demo loans and ${activeDemoLoanIds.size} active demo loans; at least ${DEMO_LOAN_COUNT} loans and 3 active loans are required.`);
  }

  console.log(`Books: ${books.length} identified (${booksCreated} created).`);
  console.log(`Members: ${members.length} identified (${membersCreated} created).`);
  console.log(`Loans for demo members: ${existingDemoMemberLoans} identified (${loansCreated} created this run; target ${DEMO_LOAN_COUNT}).`);
  console.log(`Active demo loans: ${activeDemoLoanIds.size} identified (minimum 3).`);

  const overdue = await request('/loans/overdue', { token, baseUrl: VERIFY_API_BASE_URL });
  if (!Array.isArray(overdue.items)) {
    throw new Error('GET /loans/overdue returned an unexpected response.');
  }
  const demoBookTitles = new Set(books.map((book) => book.title));
  const demoMemberNames = new Set(members.map((member) => member.full_name));
  const demoOverdueRows = overdue.items.filter(
    (item) => demoMemberNames.has(item.member_name) && demoBookTitles.has(item.book_title),
  );
  const overdueDemoLoanIds = new Set(demoOverdueRows.map((item) => item.loan_id));
  if (overdueDemoLoanIds.size < 3) {
    throw new Error(`GET /loans/overdue returned ${overdueDemoLoanIds.size} overdue demo loans; at least 3 are required.`);
  }
  console.log(`Overdue report: ${overdue.items.length} row(s), including ${overdueDemoLoanIds.size} overdue demo loan(s).`);

  const report = await request(`/reports/most-borrowed?from=${reportDate}&to=${reportDate}`, {
    token,
    baseUrl: VERIFY_API_BASE_URL,
  });
  if (!Array.isArray(report.rows) || report.rows.length === 0) {
    throw new Error('GET /reports/most-borrowed returned no rows after demo loans were ensured.');
  }
  const demoReportRows = report.rows.filter((row) => demoBookIds.has(row.book_id));
  if (demoReportRows.length === 0) {
    throw new Error(`GET /reports/most-borrowed returned no demo rows for ${reportDate}.`);
  }
  console.log(`Most-borrowed report: ${report.rows.length} row(s), including ${demoReportRows.length} demo row(s), for ${reportDate}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
