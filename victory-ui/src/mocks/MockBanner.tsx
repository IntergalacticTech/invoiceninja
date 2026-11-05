import { TOKEN_KEY } from '../config';
import { mockDb, resetMockDb, setMockUser } from './browser';

/** Only rendered by `npm run dev:mock`. Never part of the production bundle. */
export function MockBanner() {
  const switchTo = (userId: string) => {
    setMockUser(userId);
    const user = mockDb.users.find((u) => u.id === userId);
    try {
      if (user && window.localStorage.getItem(TOKEN_KEY)) window.localStorage.setItem(TOKEN_KEY, user.token);
    } catch {
      /* ignore */
    }
    window.location.reload();
  };
  return (
    <div className="note">
      <div className="wrap">
        <span>
          <b>Mock data.</b> Nothing here talks to Invoice Ninja; changes stay in this browser.
        </span>
        <label>
          Signed in as
          <select value={mockDb.signInAs} onChange={(e) => switchTo(e.target.value)}>
            {mockDb.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.first_name} {u.last_name} ({u.is_admin || u.is_owner ? 'admin' : 'team member'})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="linkish"
          onClick={() => {
            resetMockDb();
            window.location.reload();
          }}
        >
          Reset mock data
        </button>
      </div>
    </div>
  );
}
