// Mock Supabase JS client for unit testing src/api.js
export function createMockSupabase(options = {}) {
  const queries = {};
  const channels = [];

  function makeQueryBuilder(table) {
    const state = {
      table,
      selectedColumns: null,
      filters: {},
      order: null,
      limitCount: null,
      insertedData: null,
      upsertedData: null,
      upsertOpts: null,
    };
    queries[table] = state;

    const builder = {
      select(cols) {
        state.selectedColumns = cols;
        return builder;
      },
      gt(column, value) {
        state.filters.gt = { column, value };
        return builder;
      },
      lt(column, value) {
        state.filters.lt = { column, value };
        return builder;
      },
      neq(column, value) {
        state.filters.neq = { column, value };
        return builder;
      },
      order(column, opts) {
        state.order = { column, ...opts };
        return builder;
      },
      limit(n) {
        state.limitCount = n;
        return builder;
      },
      insert(data) {
        state.insertedData = data;
        return builder;
      },
      upsert(data, opts) {
        state.upsertedData = data;
        state.upsertOpts = opts;
        return builder;
      },
      single() {
        return Promise.resolve({
          data: options.singleData ?? (state.insertedData || null),
          error: options.queryError ?? null,
        });
      },
      maybeSingle() {
        return Promise.resolve({
          data: options.maybeSingleData ?? null,
          error: options.queryError ?? null,
        });
      },
      then(resolve) {
        const rows = options.rowsByTable?.[table] ?? [];
        resolve({ data: rows, error: options.queryError ?? null });
      },
    };

    return builder;
  }

  return {
    getLastQuery(table) {
      return queries[table];
    },
    getChannels() {
      return channels;
    },
    auth: {
      async getSession() {
        return { data: { session: options.session ?? null }, error: null };
      },
      async signInWithPassword({ email, password }) {
        if (options.signInError) return { data: { user: null }, error: options.signInError };
        return { data: { user: { id: 'u1', email }, session: { access_token: 'tok' } }, error: null };
      },
      async signUp({ email, password, options: signUpOpts }) {
        if (options.signUpError) return { data: { user: null }, error: options.signUpError };
        return {
          data: {
            user: { id: 'u1', email, user_metadata: signUpOpts?.data },
            session: { access_token: 'tok' },
          },
          error: null,
        };
      },
      async signOut() {
        return { error: null };
      },
    },
    from(table) {
      return makeQueryBuilder(table);
    },
    channel(name) {
      const ch = {
        name,
        handlers: [],
        unsubscribed: false,
        on(type, filter, cb) {
          ch.handlers.push({ type, filter, cb });
          return ch;
        },
        subscribe() {
          return ch;
        },
        unsubscribe() {
          ch.unsubscribed = true;
        },
      };
      channels.push(ch);
      return ch;
    },
    async removeChannel(ch) {
      ch.unsubscribed = true;
    },
  };
}
