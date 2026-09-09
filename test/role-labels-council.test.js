import { describe, it, expect } from 'vitest';
import { handleChmsApi } from '../src/api-chms.js';

// P24-C (retires DSN8). Two COUNCIL1-rename leftovers found by an external review: the
// `roleLabels` map in api-admin.js was missing `council` (already fixed — see the comment
// above `roleLabels` there), and the write-refusal string in api-chms.js still named the
// retired `office` role instead of `council`. This test pins the second one, since nothing
// covered the exact string before.

function makeEnv() {
  return {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          run: async () => ({ meta: { last_row_id: 1 } }),
          all: async () => ({ results: [] }),
        }),
        first: async () => null,
        run: async () => ({ meta: { last_row_id: 1 } }),
        all: async () => ({ results: [] }),
      }),
      batch: async () => [],
    },
  };
}

describe('write-refusal message names the current role, not the retired one (P24-C)', () => {
  // canEdit is true for every real non-member/non-volunteer role (admin/finance/staff/council),
  // so this specific message only fires as a defense-in-depth catch for a role string that
  // isn't one of the six known ones — still worth pinning, since a stale rename here would
  // otherwise sit unnoticed exactly the way the original "office" wording did.
  // Uses tags/1, not people/1: People/Households/Organizations writes moved to their own
  // 'directory' permission-item gate (see api-chms.js and the directory tests below), which
  // never mentions 'council' or 'office' at all. Tags/Attendance/Register/Funds are still on
  // the original blanket canEdit flag this test is about.
  it('says "council", never "office", when an unrecognized role tries to write', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/tags/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'PUT' }), makeEnv(), url, 'PUT', 'tags/1', 'some-unknown-role'
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('council');
    expect(body.error).not.toContain('office');
  });

  it('a council account is not blocked by this canEdit gate at all', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/tags/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'PUT', body: '{}' }), makeEnv(), url, 'PUT', 'tags/1', 'council'
    );
    // Not the 403 this test is about — it may still fail downstream on the fake DB, but it
    // must not be blocked by the canEdit check.
    if (res.status === 403) {
      const body = await res.json();
      expect(body.error).not.toMatch(/editing requires/);
    }
  });
});

describe('the "directory" permission item gates People/Households/Organizations writes', () => {
  it('blocks a council account (default: view-only) from writing a person', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/people/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'PUT', body: '{}' }), makeEnv(), url, 'PUT', 'people/1', 'council'
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/directory/);
  });

  // The actual reported bug (2026-09-09): the person profile's inline field editor, notes
  // editor, tag add/remove, photo editor and status actions (archive/deceased/invite) all PATCH
  // or POST this same route. They only checked _userRole !== 'member' client-side (see
  // js-people.js/js-households.js), so a view-only 'directory' role saw a working-looking pencil
  // that always 403'd here on save. This pins the server side of that fix, on the exact method
  // (PATCH) the profile's inline editor actually uses.
  it('blocks a council account from PATCHing a person (the profile inline-edit route)', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/people/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'PATCH', body: '{"notes":"hi"}' }), makeEnv(), url, 'PATCH', 'people/1', 'council'
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/directory/);
  });

  it('does not block a council account from reading people (GET is unconditional)', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/people/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'GET' }), makeEnv(), url, 'GET', 'people/1', 'council'
    );
    expect(res.status).not.toBe(403);
  });

  it('does not block finance (default: edit) from writing a household', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/households/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'PUT', body: '{}' }), makeEnv(), url, 'PUT', 'households/1', 'finance'
    );
    if (res.status === 403) {
      const body = await res.json();
      expect(body.error).not.toMatch(/directory/);
    }
  });

  it('does not block staff (default: edit) from writing an organization', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/organizations/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'PUT', body: '{}' }), makeEnv(), url, 'PUT', 'organizations/1', 'staff'
    );
    if (res.status === 403) {
      const body = await res.json();
      expect(body.error).not.toMatch(/directory/);
    }
  });

  it('never blocks admin, regardless of the directory setting', async () => {
    const url = new URL('https://connect.timothystl.org/admin/api/people/1');
    const res = await handleChmsApi(
      new Request(url, { method: 'PUT', body: '{}' }), makeEnv(), url, 'PUT', 'people/1', 'admin'
    );
    if (res.status === 403) {
      const body = await res.json();
      expect(body.error).not.toMatch(/directory/);
    }
  });
});
