// Stub for `next/headers` used only by the verify-first-insight harness.
// The harness pre-populates require.cache for @/lib/supabase/server so this
// never actually gets called — but we export a no-op cookies() just in case
// another module path reaches it.
export async function cookies() {
  return {
    getAll() { return []; },
    set() { /* no-op */ },
  };
}
