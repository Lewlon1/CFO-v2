import type { SupabaseClient } from '@supabase/supabase-js';

export interface ToolContext {
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  currency: string;
}
