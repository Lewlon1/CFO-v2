export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          anonymised_at: string | null
          created_at: string | null
          currency: string | null
          current_balance: number | null
          deleted_at: string | null
          id: string
          is_primary_spending: boolean | null
          metadata: Json | null
          name: string
          provider: string | null
          type: string
          user_id: string
        }
        Insert: {
          anonymised_at?: string | null
          created_at?: string | null
          currency?: string | null
          current_balance?: number | null
          deleted_at?: string | null
          id?: string
          is_primary_spending?: boolean | null
          metadata?: Json | null
          name: string
          provider?: string | null
          type: string
          user_id: string
        }
        Update: {
          anonymised_at?: string | null
          created_at?: string | null
          currency?: string | null
          current_balance?: number | null
          deleted_at?: string | null
          id?: string
          is_primary_spending?: boolean | null
          metadata?: Json | null
          name?: string
          provider?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      action_items: {
        Row: {
          actual_savings: number | null
          anonymised_at: string | null
          category: string | null
          completed_at: string | null
          conversation_id: string | null
          created_at: string | null
          deleted_at: string | null
          description: string | null
          due_date: string | null
          id: string
          potential_savings: number | null
          priority: string | null
          reminder_at: string | null
          source: string | null
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          actual_savings?: number | null
          anonymised_at?: string | null
          category?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          potential_savings?: number | null
          priority?: string | null
          reminder_at?: string | null
          source?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          actual_savings?: number | null
          anonymised_at?: string | null
          category?: string | null
          completed_at?: string | null
          conversation_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          potential_savings?: number | null
          priority?: string | null
          reminder_at?: string | null
          source?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_items_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          account_id: string | null
          anonymised_at: string | null
          asset_type: string
          cost_basis: number | null
          created_at: string
          currency: string
          current_value: number | null
          deleted_at: string | null
          details: Json
          id: string
          is_accessible: boolean
          last_updated: string
          name: string
          provider: string | null
          source: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          anonymised_at?: string | null
          asset_type: string
          cost_basis?: number | null
          created_at?: string
          currency?: string
          current_value?: number | null
          deleted_at?: string | null
          details?: Json
          id?: string
          is_accessible?: boolean
          last_updated?: string
          name: string
          provider?: string | null
          source?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          anonymised_at?: string | null
          asset_type?: string
          cost_basis?: number | null
          created_at?: string
          currency?: string
          current_value?: number | null
          deleted_at?: string | null
          details?: Json
          id?: string
          is_accessible?: boolean
          last_updated?: string
          name?: string
          provider?: string | null
          source?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmarks: {
        Row: {
          average_monthly: number
          category: string
          country: string
          created_at: string | null
          id: string
          median_monthly: number | null
          p25_monthly: number | null
          p75_monthly: number | null
          segment: string | null
          source: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          average_monthly: number
          category: string
          country: string
          created_at?: string | null
          id?: string
          median_monthly?: number | null
          p25_monthly?: number | null
          p75_monthly?: number | null
          segment?: string | null
          source: string
          valid_from: string
          valid_until?: string | null
        }
        Update: {
          average_monthly?: number
          category?: string
          country?: string
          created_at?: string | null
          id?: string
          median_monthly?: number | null
          p25_monthly?: number | null
          p75_monthly?: number | null
          segment?: string | null
          source?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string
          created_at: string
          default_value_category:
            | Database["public"]["Enums"]["value_category_type"]
            | null
          description: string | null
          examples: string[] | null
          icon: string
          id: string
          is_active: boolean
          is_holiday_eligible: boolean
          name: string
          sort_order: number
          tier: Database["public"]["Enums"]["category_tier"]
        }
        Insert: {
          color: string
          created_at?: string
          default_value_category?:
            | Database["public"]["Enums"]["value_category_type"]
            | null
          description?: string | null
          examples?: string[] | null
          icon: string
          id: string
          is_active?: boolean
          is_holiday_eligible?: boolean
          name: string
          sort_order?: number
          tier: Database["public"]["Enums"]["category_tier"]
        }
        Update: {
          color?: string
          created_at?: string
          default_value_category?:
            | Database["public"]["Enums"]["value_category_type"]
            | null
          description?: string | null
          examples?: string[] | null
          icon?: string
          id?: string
          is_active?: boolean
          is_holiday_eligible?: boolean
          name?: string
          sort_order?: number
          tier?: Database["public"]["Enums"]["category_tier"]
        }
        Relationships: []
      }
      consent_records: {
        Row: {
          consent_type: string
          consent_version: string
          created_at: string
          granted: boolean
          granted_at: string
          id: string
          ip_hash: string | null
          user_agent: string | null
          user_id: string
          withdrawn_at: string | null
        }
        Insert: {
          consent_type: string
          consent_version: string
          created_at?: string
          granted?: boolean
          granted_at?: string
          id?: string
          ip_hash?: string | null
          user_agent?: string | null
          user_id: string
          withdrawn_at?: string | null
        }
        Update: {
          consent_type?: string
          consent_version?: string
          created_at?: string
          granted?: boolean
          granted_at?: string
          id?: string
          ip_hash?: string | null
          user_agent?: string | null
          user_id?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          anonymised_at: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          metadata: Json | null
          status: string | null
          title: string | null
          type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          anonymised_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          anonymised_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_signals: {
        Row: {
          amount: number
          category_id: string | null
          created_at: string | null
          day_of_month: number
          id: string
          merchant_clean: string
          time_context: string
          transaction_id: string
          transaction_time: string
          user_id: string
          value_category: Database["public"]["Enums"]["value_category_type"]
          weight_multiplier: number | null
        }
        Insert: {
          amount: number
          category_id?: string | null
          created_at?: string | null
          day_of_month: number
          id?: string
          merchant_clean: string
          time_context: string
          transaction_id: string
          transaction_time: string
          user_id: string
          value_category: Database["public"]["Enums"]["value_category_type"]
          weight_multiplier?: number | null
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string | null
          day_of_month?: number
          id?: string
          merchant_clean?: string
          time_context?: string
          transaction_id?: string
          transaction_time?: string
          user_id?: string
          value_category?: Database["public"]["Enums"]["value_category_type"]
          weight_multiplier?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "correction_signals_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_signals_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_signals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_question_responses: {
        Row: {
          answer: string | null
          answer_index: number | null
          created_at: string | null
          id: string
          question_id: string
          question_text: string | null
          session_id: string
          time_spent_ms: number | null
        }
        Insert: {
          answer?: string | null
          answer_index?: number | null
          created_at?: string | null
          id?: string
          question_id: string
          question_text?: string | null
          session_id: string
          time_spent_ms?: number | null
        }
        Update: {
          answer?: string | null
          answer_index?: number | null
          created_at?: string | null
          id?: string
          question_id?: string
          question_text?: string | null
          session_id?: string
          time_spent_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "demo_question_responses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "demo_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_sessions: {
        Row: {
          ai_response_rating: number | null
          ai_response_shown: string | null
          created_at: string | null
          device_type: string | null
          drop_off_at: string | null
          id: string
          pain_point: string | null
          persona_fit: string | null
          questions_skipped: number | null
          reached_end: boolean | null
          referrer: string | null
          responses: Json
          score: number | null
          score_breakdown: Json | null
          session_token: string
          time_to_complete_ms: number | null
          waitlist_joined: boolean | null
        }
        Insert: {
          ai_response_rating?: number | null
          ai_response_shown?: string | null
          created_at?: string | null
          device_type?: string | null
          drop_off_at?: string | null
          id?: string
          pain_point?: string | null
          persona_fit?: string | null
          questions_skipped?: number | null
          reached_end?: boolean | null
          referrer?: string | null
          responses?: Json
          score?: number | null
          score_breakdown?: Json | null
          session_token: string
          time_to_complete_ms?: number | null
          waitlist_joined?: boolean | null
        }
        Update: {
          ai_response_rating?: number | null
          ai_response_shown?: string | null
          created_at?: string | null
          device_type?: string | null
          drop_off_at?: string | null
          id?: string
          pain_point?: string | null
          persona_fit?: string | null
          questions_skipped?: number | null
          reached_end?: boolean | null
          referrer?: string | null
          responses?: Json
          score?: number | null
          score_breakdown?: Json | null
          session_token?: string
          time_to_complete_ms?: number | null
          waitlist_joined?: boolean | null
        }
        Relationships: []
      }
      demo_waitlist: {
        Row: {
          consent_given_at: string | null
          country: string
          created_at: string | null
          email: string
          id: string
          name: string
          personality: string | null
          reading_text: string | null
          resonance_rating: number | null
          results_json: Json | null
          session_id: string | null
        }
        Insert: {
          consent_given_at?: string | null
          country: string
          created_at?: string | null
          email: string
          id?: string
          name: string
          personality?: string | null
          reading_text?: string | null
          resonance_rating?: number | null
          results_json?: Json | null
          session_id?: string | null
        }
        Update: {
          consent_given_at?: string | null
          country?: string
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          personality?: string | null
          reading_text?: string | null
          resonance_rating?: number | null
          results_json?: Json | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demo_waitlist_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "demo_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      dsar_requests: {
        Row: {
          acknowledged_at: string | null
          completed_at: string | null
          created_at: string
          deadline_at: string
          id: string
          notes: string | null
          request_type: string
          requested_at: string
          status: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          completed_at?: string | null
          created_at?: string
          deadline_at?: string
          id?: string
          notes?: string | null
          request_type: string
          requested_at?: string
          status?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          completed_at?: string | null
          created_at?: string
          deadline_at?: string
          id?: string
          notes?: string | null
          request_type?: string
          requested_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dsar_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_portrait: {
        Row: {
          anonymised_at: string | null
          confidence: number | null
          created_at: string | null
          deleted_at: string | null
          dismissed_at: string | null
          evidence: string | null
          id: string
          source: string | null
          source_conversation_id: string | null
          trait_key: string
          trait_type: string
          trait_value: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          anonymised_at?: string | null
          confidence?: number | null
          created_at?: string | null
          deleted_at?: string | null
          dismissed_at?: string | null
          evidence?: string | null
          id?: string
          source?: string | null
          source_conversation_id?: string | null
          trait_key: string
          trait_type: string
          trait_value: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          anonymised_at?: string | null
          confidence?: number | null
          created_at?: string | null
          deleted_at?: string | null
          dismissed_at?: string | null
          evidence?: string | null
          id?: string
          source?: string | null
          source_conversation_id?: string | null
          trait_key?: string
          trait_type?: string
          trait_value?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_portrait_source_conversation_id_fkey"
            columns: ["source_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_portrait_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          anonymised_at: string | null
          created_at: string | null
          current_amount: number | null
          deleted_at: string | null
          description: string | null
          id: string
          monthly_required_saving: number | null
          name: string
          on_track: boolean | null
          priority: string | null
          status: string | null
          target_amount: number | null
          target_date: string | null
          user_id: string
        }
        Insert: {
          anonymised_at?: string | null
          created_at?: string | null
          current_amount?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          monthly_required_saving?: number | null
          name: string
          on_track?: boolean | null
          priority?: string | null
          status?: string | null
          target_amount?: number | null
          target_date?: string | null
          user_id: string
        }
        Update: {
          anonymised_at?: string | null
          created_at?: string | null
          current_amount?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          monthly_required_saving?: number | null
          name?: string
          on_track?: boolean | null
          priority?: string | null
          status?: string | null
          target_amount?: number | null
          target_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_holdings: {
        Row: {
          account_id: string | null
          allocation_pct: number | null
          anonymised_at: string | null
          asset_id: string | null
          asset_type: string | null
          cost_basis: number | null
          currency: string | null
          current_value: number | null
          deleted_at: string | null
          gain_loss_pct: number | null
          id: string
          last_updated: string | null
          name: string
          quantity: number | null
          ticker: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          allocation_pct?: number | null
          anonymised_at?: string | null
          asset_id?: string | null
          asset_type?: string | null
          cost_basis?: number | null
          currency?: string | null
          current_value?: number | null
          deleted_at?: string | null
          gain_loss_pct?: number | null
          id?: string
          last_updated?: string | null
          name: string
          quantity?: number | null
          ticker?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          allocation_pct?: number | null
          anonymised_at?: string | null
          asset_id?: string | null
          asset_type?: string | null
          cost_basis?: number | null
          currency?: string | null
          current_value?: number | null
          deleted_at?: string | null
          gain_loss_pct?: number | null
          id?: string
          last_updated?: string | null
          name?: string
          quantity?: number | null
          ticker?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_holdings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_holdings_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_holdings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      liabilities: {
        Row: {
          actual_payment: number | null
          anonymised_at: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          details: Json
          end_date: string | null
          id: string
          interest_rate: number | null
          is_priority: boolean
          last_updated: string
          liability_type: string
          minimum_payment: number | null
          name: string
          original_amount: number | null
          outstanding_balance: number
          payment_frequency: string
          provider: string | null
          rate_type: string | null
          remaining_term_months: number | null
          source: string | null
          start_date: string | null
          user_id: string
        }
        Insert: {
          actual_payment?: number | null
          anonymised_at?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          details?: Json
          end_date?: string | null
          id?: string
          interest_rate?: number | null
          is_priority?: boolean
          last_updated?: string
          liability_type: string
          minimum_payment?: number | null
          name: string
          original_amount?: number | null
          outstanding_balance: number
          payment_frequency?: string
          provider?: string | null
          rate_type?: string | null
          remaining_term_months?: number | null
          source?: string | null
          start_date?: string | null
          user_id: string
        }
        Update: {
          actual_payment?: number | null
          anonymised_at?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          details?: Json
          end_date?: string | null
          id?: string
          interest_rate?: number | null
          is_priority?: boolean
          last_updated?: string
          liability_type?: string
          minimum_payment?: number | null
          name?: string
          original_amount?: number | null
          outstanding_balance?: number
          payment_frequency?: string
          provider?: string | null
          rate_type?: string | null
          remaining_term_months?: number | null
          source?: string | null
          start_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "liabilities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_usage_log: {
        Row: {
          anonymised_at: string | null
          call_type: string
          completion_tokens: number | null
          created_at: string | null
          deleted_at: string | null
          duration_ms: number | null
          id: string
          metadata: Json | null
          model: string
          prompt_tokens: number | null
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          anonymised_at?: string | null
          call_type: string
          completion_tokens?: number | null
          created_at?: string | null
          deleted_at?: string | null
          duration_ms?: number | null
          id?: string
          metadata?: Json | null
          model: string
          prompt_tokens?: number | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          anonymised_at?: string | null
          call_type?: string
          completion_tokens?: number | null
          created_at?: string | null
          deleted_at?: string | null
          duration_ms?: number | null
          id?: string
          metadata?: Json | null
          model?: string
          prompt_tokens?: number | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "llm_usage_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_category_map: {
        Row: {
          category_name: string
          created_at: string | null
          id: string
          merchant_pattern: string
          profile_id: string | null
          source: string
        }
        Insert: {
          category_name: string
          created_at?: string | null
          id?: string
          merchant_pattern: string
          profile_id?: string | null
          source?: string
        }
        Update: {
          category_name?: string
          created_at?: string | null
          id?: string
          merchant_pattern?: string
          profile_id?: string | null
          source?: string
        }
        Relationships: []
      }
      message_feedback: {
        Row: {
          anonymised_at: string | null
          comment: string | null
          created_at: string | null
          deleted_at: string | null
          id: string
          message_id: string
          rating: number
          user_id: string
        }
        Insert: {
          anonymised_at?: string | null
          comment?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          message_id: string
          rating: number
          user_id: string
        }
        Update: {
          anonymised_at?: string | null
          comment?: string | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          message_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_feedback_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          actions_created: Json | null
          anonymised_at: string | null
          completion_tokens: number | null
          content: string
          conversation_id: string
          created_at: string | null
          deleted_at: string | null
          id: string
          insights_generated: Json | null
          profile_updates: Json | null
          prompt_tokens: number | null
          role: string
          tools_used: string[] | null
          user_id: string | null
        }
        Insert: {
          actions_created?: Json | null
          anonymised_at?: string | null
          completion_tokens?: number | null
          content: string
          conversation_id: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          insights_generated?: Json | null
          profile_updates?: Json | null
          prompt_tokens?: number | null
          role: string
          tools_used?: string[] | null
          user_id?: string | null
        }
        Update: {
          actions_created?: Json | null
          anonymised_at?: string | null
          completion_tokens?: number | null
          content?: string
          conversation_id?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          insights_generated?: Json | null
          profile_updates?: Json | null
          prompt_tokens?: number | null
          role?: string
          tools_used?: string[] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_snapshots: {
        Row: {
          anonymised_at: string | null
          avg_transaction_size: number | null
          created_at: string | null
          deleted_at: string | null
          id: string
          largest_transaction: number | null
          largest_transaction_desc: string | null
          month: string
          review_conversation_id: string | null
          reviewed_at: string | null
          spending_by_category: Json | null
          spending_by_value_category: Json | null
          surplus_deficit: number | null
          total_income: number | null
          total_spending: number | null
          transaction_count: number | null
          user_id: string
          vs_previous_month_pct: number | null
        }
        Insert: {
          anonymised_at?: string | null
          avg_transaction_size?: number | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          largest_transaction?: number | null
          largest_transaction_desc?: string | null
          month: string
          review_conversation_id?: string | null
          reviewed_at?: string | null
          spending_by_category?: Json | null
          spending_by_value_category?: Json | null
          surplus_deficit?: number | null
          total_income?: number | null
          total_spending?: number | null
          transaction_count?: number | null
          user_id: string
          vs_previous_month_pct?: number | null
        }
        Update: {
          anonymised_at?: string | null
          avg_transaction_size?: number | null
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          largest_transaction?: number | null
          largest_transaction_desc?: string | null
          month?: string
          review_conversation_id?: string | null
          reviewed_at?: string | null
          spending_by_category?: Json | null
          spending_by_value_category?: Json | null
          surplus_deficit?: number | null
          total_income?: number | null
          total_spending?: number | null
          transaction_count?: number | null
          user_id?: string
          vs_previous_month_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_snapshots_review_conversation_id_fkey"
            columns: ["review_conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      net_worth_snapshots: {
        Row: {
          accessible_assets: number | null
          anonymised_at: string | null
          assets_by_type: Json | null
          created_at: string
          deleted_at: string | null
          id: string
          liabilities_by_type: Json | null
          locked_assets: number | null
          month: string
          net_worth: number | null
          net_worth_change: number | null
          net_worth_change_pct: number | null
          total_assets: number | null
          total_liabilities: number | null
          user_id: string
        }
        Insert: {
          accessible_assets?: number | null
          anonymised_at?: string | null
          assets_by_type?: Json | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          liabilities_by_type?: Json | null
          locked_assets?: number | null
          month: string
          net_worth?: number | null
          net_worth_change?: number | null
          net_worth_change_pct?: number | null
          total_assets?: number | null
          total_liabilities?: number | null
          user_id: string
        }
        Update: {
          accessible_assets?: number | null
          anonymised_at?: string | null
          assets_by_type?: Json | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          liabilities_by_type?: Json | null
          locked_assets?: number | null
          month?: string
          net_worth?: number | null
          net_worth_change?: number | null
          net_worth_change_pct?: number | null
          total_assets?: number | null
          total_liabilities?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "net_worth_snapshots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nudges: {
        Row: {
          action_url: string | null
          anonymised_at: string | null
          body: string
          created_at: string | null
          deleted_at: string | null
          id: string
          read_at: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string | null
          title: string
          trigger_rule: Json | null
          type: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          anonymised_at?: string | null
          body: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          read_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          title: string
          trigger_rule?: Json | null
          type: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          anonymised_at?: string | null
          body?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          read_at?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          title?: string
          trigger_rule?: Json | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nudges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiling_queue: {
        Row: {
          anonymised_at: string | null
          answered_at: string | null
          asked_at: string | null
          conversation_id: string | null
          created_at: string | null
          deleted_at: string | null
          field: string
          id: string
          source: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          anonymised_at?: string | null
          answered_at?: string | null
          asked_at?: string | null
          conversation_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          field: string
          id?: string
          source?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          anonymised_at?: string | null
          answered_at?: string | null
          asked_at?: string | null
          conversation_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          field?: string
          id?: string
          source?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiling_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiling_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_expenses: {
        Row: {
          account_id: string | null
          amount: number
          anonymised_at: string | null
          bill_uploads: Json | null
          billing_day: number | null
          category_id: string | null
          contract_end_date: string | null
          created_at: string | null
          currency: string | null
          current_plan_details: Json | null
          deleted_at: string | null
          frequency: string
          has_permanencia: boolean | null
          id: string
          last_optimisation_check: string | null
          name: string
          potential_saving_monthly: number | null
          provider: string | null
          status: string | null
          switch_recommendation: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          anonymised_at?: string | null
          bill_uploads?: Json | null
          billing_day?: number | null
          category_id?: string | null
          contract_end_date?: string | null
          created_at?: string | null
          currency?: string | null
          current_plan_details?: Json | null
          deleted_at?: string | null
          frequency: string
          has_permanencia?: boolean | null
          id?: string
          last_optimisation_check?: string | null
          name: string
          potential_saving_monthly?: number | null
          provider?: string | null
          status?: string | null
          switch_recommendation?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          anonymised_at?: string | null
          bill_uploads?: Json | null
          billing_day?: number | null
          category_id?: string | null
          contract_end_date?: string | null
          created_at?: string | null
          currency?: string | null
          current_plan_details?: Json | null
          deleted_at?: string | null
          frequency?: string
          has_permanencia?: boolean | null
          id?: string
          last_optimisation_check?: string | null
          name?: string
          potential_saving_monthly?: number | null
          provider?: string | null
          status?: string | null
          switch_recommendation?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      savings_tips: {
        Row: {
          action_url: string | null
          category: string
          country: string
          created_at: string | null
          id: string
          potential_saving: string | null
          priority: number | null
          subcategory: string | null
          tier_required: string | null
          tip_body: string
          tip_title: string
          trigger_condition: string
          updated_at: string | null
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          action_url?: string | null
          category: string
          country: string
          created_at?: string | null
          id?: string
          potential_saving?: string | null
          priority?: number | null
          subcategory?: string | null
          tier_required?: string | null
          tip_body: string
          tip_title: string
          trigger_condition: string
          updated_at?: string | null
          valid_from: string
          valid_until?: string | null
        }
        Update: {
          action_url?: string | null
          category?: string
          country?: string
          created_at?: string | null
          id?: string
          potential_saving?: string | null
          priority?: number | null
          subcategory?: string | null
          tier_required?: string | null
          tip_body?: string
          tip_title?: string
          trigger_condition?: string
          updated_at?: string | null
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      third_party_data_flows: {
        Row: {
          created_at: string | null
          data_categories: string[] | null
          data_retention_days: number | null
          dpa_reference: string | null
          id: string
          is_active: boolean | null
          lawful_basis: string | null
          notes: string | null
          service_name: string | null
          service_provider: string | null
          transfer_mechanism: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          data_categories?: string[] | null
          data_retention_days?: number | null
          dpa_reference?: string | null
          id?: string
          is_active?: boolean | null
          lawful_basis?: string | null
          notes?: string | null
          service_name?: string | null
          service_provider?: string | null
          transfer_mechanism?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          data_categories?: string[] | null
          data_retention_days?: number | null
          dpa_reference?: string | null
          id?: string
          is_active?: boolean | null
          lawful_basis?: string | null
          notes?: string | null
          service_name?: string | null
          service_provider?: string | null
          transfer_mechanism?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          anonymised_at: string | null
          auto_category_confidence: number | null
          balance: number | null
          category_id: string | null
          confirmed_at: string | null
          created_at: string
          currency: string | null
          date: string
          dedupe_hash: string | null
          deleted_at: string | null
          description: string | null
          holiday_category_override: string | null
          id: string
          import_batch_id: string | null
          is_holiday_spend: boolean
          is_recurring: boolean
          location_city: string | null
          location_country: string | null
          metadata: Json | null
          prediction_source: string | null
          raw_description: string | null
          source: string | null
          trip_id: string | null
          trip_name: string | null
          updated_at: string | null
          user_confirmed: boolean | null
          user_id: string
          value_category:
            | Database["public"]["Enums"]["value_category_type"]
            | null
          value_confidence: number | null
          value_confirmed_by_user: boolean
        }
        Insert: {
          amount: number
          anonymised_at?: string | null
          auto_category_confidence?: number | null
          balance?: number | null
          category_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string | null
          date: string
          dedupe_hash?: string | null
          deleted_at?: string | null
          description?: string | null
          holiday_category_override?: string | null
          id?: string
          import_batch_id?: string | null
          is_holiday_spend?: boolean
          is_recurring?: boolean
          location_city?: string | null
          location_country?: string | null
          metadata?: Json | null
          prediction_source?: string | null
          raw_description?: string | null
          source?: string | null
          trip_id?: string | null
          trip_name?: string | null
          updated_at?: string | null
          user_confirmed?: boolean | null
          user_id: string
          value_category?:
            | Database["public"]["Enums"]["value_category_type"]
            | null
          value_confidence?: number | null
          value_confirmed_by_user?: boolean
        }
        Update: {
          amount?: number
          anonymised_at?: string | null
          auto_category_confidence?: number | null
          balance?: number | null
          category_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string | null
          date?: string
          dedupe_hash?: string | null
          deleted_at?: string | null
          description?: string | null
          holiday_category_override?: string | null
          id?: string
          import_batch_id?: string | null
          is_holiday_spend?: boolean
          is_recurring?: boolean
          location_city?: string | null
          location_country?: string | null
          metadata?: Json | null
          prediction_source?: string | null
          raw_description?: string | null
          source?: string | null
          trip_id?: string | null
          trip_name?: string | null
          updated_at?: string | null
          user_confirmed?: boolean | null
          user_id?: string
          value_category?:
            | Database["public"]["Enums"]["value_category_type"]
            | null
          value_confidence?: number | null
          value_confirmed_by_user?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          anonymised_at: string | null
          companion_count: number | null
          companions: string | null
          conversation_id: string | null
          created_at: string
          currency: string | null
          deleted_at: string | null
          destination: string | null
          duration_days: number | null
          end_date: string | null
          estimated_budget: Json | null
          funding_plan: Json | null
          goal_id: string | null
          id: string
          name: string
          notes: string | null
          research_data: Json | null
          start_date: string | null
          status: string | null
          total_actual: number | null
          total_estimated: number | null
          travel_style: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          anonymised_at?: string | null
          companion_count?: number | null
          companions?: string | null
          conversation_id?: string | null
          created_at?: string
          currency?: string | null
          deleted_at?: string | null
          destination?: string | null
          duration_days?: number | null
          end_date?: string | null
          estimated_budget?: Json | null
          funding_plan?: Json | null
          goal_id?: string | null
          id?: string
          name: string
          notes?: string | null
          research_data?: Json | null
          start_date?: string | null
          status?: string | null
          total_actual?: number | null
          total_estimated?: number | null
          travel_style?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          anonymised_at?: string | null
          companion_count?: number | null
          companions?: string | null
          conversation_id?: string | null
          created_at?: string
          currency?: string | null
          deleted_at?: string | null
          destination?: string | null
          duration_days?: number | null
          end_date?: string | null
          estimated_budget?: Json | null
          funding_plan?: Json | null
          goal_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          research_data?: Json | null
          start_date?: string | null
          status?: string | null
          total_actual?: number | null
          total_estimated?: number | null
          travel_style?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
        ]
      }
      user_events: {
        Row: {
          anonymised_at: string | null
          context: Json | null
          created_at: string | null
          deleted_at: string | null
          duration_ms: number | null
          event_category: string
          event_type: string
          id: string
          payload: Json | null
          profile_id: string
          session_id: string | null
        }
        Insert: {
          anonymised_at?: string | null
          context?: Json | null
          created_at?: string | null
          deleted_at?: string | null
          duration_ms?: number | null
          event_category: string
          event_type: string
          id?: string
          payload?: Json | null
          profile_id: string
          session_id?: string | null
        }
        Update: {
          anonymised_at?: string | null
          context?: Json | null
          created_at?: string | null
          deleted_at?: string | null
          duration_ms?: number | null
          event_category?: string
          event_type?: string
          id?: string
          payload?: Json | null
          profile_id?: string
          session_id?: string | null
        }
        Relationships: []
      }
      user_merchant_rules: {
        Row: {
          anonymised_at: string | null
          category_id: string
          confidence: number
          created_at: string
          deleted_at: string | null
          id: string
          normalised_merchant: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          anonymised_at?: string | null
          category_id: string
          confidence?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          normalised_merchant: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          anonymised_at?: string | null
          category_id?: string
          confidence?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          normalised_merchant?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_merchant_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_merchant_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          advice_style: string | null
          age_range: string | null
          anonymised_at: string | null
          bonus_month_details: Json | null
          budget_config: Json | null
          capability_preferences: string[] | null
          city: string | null
          country: string | null
          created_at: string | null
          deleted_at: string | null
          dependents: number | null
          display_name: string | null
          employment_status: string | null
          financial_awareness: string | null
          gross_salary: number | null
          has_bonus_months: boolean | null
          housing_type: string | null
          id: string
          monthly_rent: number | null
          nationality: string | null
          net_monthly_income: number | null
          nudge_preferences: Json | null
          onboarding_completed_at: string | null
          onboarding_progress: Json | null
          partner_employment_status: string | null
          partner_monthly_contribution: number | null
          pay_frequency: string | null
          primary_currency: string | null
          profile_completeness: number | null
          relationship_status: string | null
          residency_status: string | null
          risk_tolerance: string | null
          savings_rate_target: number | null
          spending_triggers: Json | null
          tax_residency_country: string | null
          updated_at: string | null
          values_ranking: Json | null
          years_in_country: number | null
        }
        Insert: {
          advice_style?: string | null
          age_range?: string | null
          anonymised_at?: string | null
          bonus_month_details?: Json | null
          budget_config?: Json | null
          capability_preferences?: string[] | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dependents?: number | null
          display_name?: string | null
          employment_status?: string | null
          financial_awareness?: string | null
          gross_salary?: number | null
          has_bonus_months?: boolean | null
          housing_type?: string | null
          id: string
          monthly_rent?: number | null
          nationality?: string | null
          net_monthly_income?: number | null
          nudge_preferences?: Json | null
          onboarding_completed_at?: string | null
          onboarding_progress?: Json | null
          partner_employment_status?: string | null
          partner_monthly_contribution?: number | null
          pay_frequency?: string | null
          primary_currency?: string | null
          profile_completeness?: number | null
          relationship_status?: string | null
          residency_status?: string | null
          risk_tolerance?: string | null
          savings_rate_target?: number | null
          spending_triggers?: Json | null
          tax_residency_country?: string | null
          updated_at?: string | null
          values_ranking?: Json | null
          years_in_country?: number | null
        }
        Update: {
          advice_style?: string | null
          age_range?: string | null
          anonymised_at?: string | null
          bonus_month_details?: Json | null
          budget_config?: Json | null
          capability_preferences?: string[] | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dependents?: number | null
          display_name?: string | null
          employment_status?: string | null
          financial_awareness?: string | null
          gross_salary?: number | null
          has_bonus_months?: boolean | null
          housing_type?: string | null
          id?: string
          monthly_rent?: number | null
          nationality?: string | null
          net_monthly_income?: number | null
          nudge_preferences?: Json | null
          onboarding_completed_at?: string | null
          onboarding_progress?: Json | null
          partner_employment_status?: string | null
          partner_monthly_contribution?: number | null
          pay_frequency?: string | null
          primary_currency?: string | null
          profile_completeness?: number | null
          relationship_status?: string | null
          residency_status?: string | null
          risk_tolerance?: string | null
          savings_rate_target?: number | null
          spending_triggers?: Json | null
          tax_residency_country?: string | null
          updated_at?: string | null
          values_ranking?: Json | null
          years_in_country?: number | null
        }
        Relationships: []
      }
      value_category_rules: {
        Row: {
          agreement_ratio: number | null
          avg_amount_high: number | null
          avg_amount_low: number | null
          confidence: number | null
          created_at: string | null
          id: string
          last_signal_at: string | null
          match_type: string
          match_value: string
          source: string
          time_context: string | null
          total_signals: number | null
          updated_at: string | null
          user_id: string
          value_category: Database["public"]["Enums"]["value_category_type"]
        }
        Insert: {
          agreement_ratio?: number | null
          avg_amount_high?: number | null
          avg_amount_low?: number | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          last_signal_at?: string | null
          match_type: string
          match_value: string
          source: string
          time_context?: string | null
          total_signals?: number | null
          updated_at?: string | null
          user_id: string
          value_category: Database["public"]["Enums"]["value_category_type"]
        }
        Update: {
          agreement_ratio?: number | null
          avg_amount_high?: number | null
          avg_amount_low?: number | null
          confidence?: number | null
          created_at?: string | null
          id?: string
          last_signal_at?: string | null
          match_type?: string
          match_value?: string
          source?: string
          time_context?: string | null
          total_signals?: number | null
          updated_at?: string | null
          user_id?: string
          value_category?: Database["public"]["Enums"]["value_category_type"]
        }
        Relationships: [
          {
            foreignKeyName: "value_category_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      value_map_results: {
        Row: {
          amount: number
          anonymised_at: string | null
          card_time_ms: number | null
          confidence: number | null
          created_at: string | null
          cut_intent: boolean | null
          deleted_at: string | null
          deliberation_ms: number | null
          first_tap_ms: number | null
          hard_to_decide: boolean | null
          id: string
          merchant: string
          profile_id: string
          quadrant: string | null
          session_id: string | null
          transaction_id: string
        }
        Insert: {
          amount: number
          anonymised_at?: string | null
          card_time_ms?: number | null
          confidence?: number | null
          created_at?: string | null
          cut_intent?: boolean | null
          deleted_at?: string | null
          deliberation_ms?: number | null
          first_tap_ms?: number | null
          hard_to_decide?: boolean | null
          id?: string
          merchant: string
          profile_id: string
          quadrant?: string | null
          session_id?: string | null
          transaction_id: string
        }
        Update: {
          amount?: number
          anonymised_at?: string | null
          card_time_ms?: number | null
          confidence?: number | null
          created_at?: string | null
          cut_intent?: boolean | null
          deleted_at?: string | null
          deliberation_ms?: number | null
          first_tap_ms?: number | null
          hard_to_decide?: boolean | null
          id?: string
          merchant?: string
          profile_id?: string
          quadrant?: string | null
          session_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "value_map_results_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "value_map_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      value_map_sessions: {
        Row: {
          anonymised_at: string | null
          archetype_analysis: string | null
          archetype_history: Json | null
          archetype_name: string | null
          archetype_subtitle: string | null
          archetype_traits: Json | null
          breakdown: Json
          certainty_areas: Json | null
          conflict_areas: Json | null
          created_at: string
          deleted_at: string | null
          dominant_quadrant: string
          id: string
          is_real_data: boolean
          merchants_by_quadrant: Json | null
          personality_type: string
          profile_id: string
          session_number: number
          shift_narrative: string | null
          source_signal_summary: Json | null
          transaction_count: number
          trigger_reason: string | null
          type: string
          used_fallback: boolean | null
        }
        Insert: {
          anonymised_at?: string | null
          archetype_analysis?: string | null
          archetype_history?: Json | null
          archetype_name?: string | null
          archetype_subtitle?: string | null
          archetype_traits?: Json | null
          breakdown: Json
          certainty_areas?: Json | null
          conflict_areas?: Json | null
          created_at?: string
          deleted_at?: string | null
          dominant_quadrant: string
          id?: string
          is_real_data?: boolean
          merchants_by_quadrant?: Json | null
          personality_type: string
          profile_id: string
          session_number?: number
          shift_narrative?: string | null
          source_signal_summary?: Json | null
          transaction_count: number
          trigger_reason?: string | null
          type?: string
          used_fallback?: boolean | null
        }
        Update: {
          anonymised_at?: string | null
          archetype_analysis?: string | null
          archetype_history?: Json | null
          archetype_name?: string | null
          archetype_subtitle?: string | null
          archetype_traits?: Json | null
          breakdown?: Json
          certainty_areas?: Json | null
          conflict_areas?: Json | null
          created_at?: string
          deleted_at?: string | null
          dominant_quadrant?: string
          id?: string
          is_real_data?: boolean
          merchants_by_quadrant?: Json | null
          personality_type?: string
          profile_id?: string
          session_number?: number
          shift_narrative?: string | null
          source_signal_summary?: Json | null
          transaction_count?: number
          trigger_reason?: string | null
          type?: string
          used_fallback?: boolean | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_user_account: { Args: { p_user_id: string }; Returns: Json }
      export_user_data: { Args: { p_user_id: string }; Returns: Json }
      fn_import_batches: {
        Args: { p_profile_id: string }
        Returns: {
          import_batch_id: string
          imported_at: string
          tx_count: number
        }[]
      }
      fn_session_feedback: {
        Args: { p_session_id: string }
        Returns: {
          negative_count: number
          positive_count: number
        }[]
      }
      get_import_history: {
        Args: { p_user_id: string }
        Returns: {
          earliest_date: string
          import_batch_id: string
          imported_at: string
          latest_date: string
          source: string
          transaction_count: number
        }[]
      }
      merchant_history: {
        Args: { p_user_id: string }
        Returns: {
          count: number
          median_amount: number
          merchant: string
        }[]
      }
      prediction_metrics_txn: { Args: { p_user_id: string }; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      account_type: "checking" | "savings" | "credit_card" | "cash" | "other"
      agent_status: "active" | "disabled" | "deprecated"
      asset_type:
        | "stock"
        | "etf"
        | "bond"
        | "crypto"
        | "mutual_fund"
        | "commodity"
        | "reit"
        | "cash"
        | "other"
      budget_period: "weekly" | "monthly" | "quarterly" | "yearly"
      category_tier: "core" | "lifestyle" | "financial"
      debt_type:
        | "mortgage"
        | "student_loan"
        | "car_loan"
        | "credit_card"
        | "personal_loan"
        | "other"
      decision_domain:
        | "spending"
        | "saving"
        | "investing"
        | "debt"
        | "income"
        | "tax"
        | "insurance"
        | "goal"
        | "budget"
        | "other"
      decision_horizon: "immediate" | "short_term" | "medium_term" | "long_term"
      decision_status:
        | "proposed"
        | "accepted"
        | "rejected"
        | "deferred"
        | "completed"
        | "revisited"
        | "superseded"
      frequency:
        | "daily"
        | "weekly"
        | "biweekly"
        | "monthly"
        | "quarterly"
        | "yearly"
      goal_priority: "critical" | "high" | "medium" | "low"
      goal_status: "active" | "paused" | "achieved" | "abandoned"
      goal_type:
        | "emergency_fund"
        | "retirement"
        | "house"
        | "education"
        | "travel"
        | "debt_payoff"
        | "investment"
        | "custom"
      handoff_status: "pending" | "accepted" | "completed" | "cancelled"
      income_type:
        | "salary"
        | "freelance"
        | "rental"
        | "dividends"
        | "pension"
        | "benefits"
        | "other"
      insight_severity: "info" | "warning" | "critical"
      insight_type:
        | "risk"
        | "opportunity"
        | "anomaly"
        | "milestone"
        | "nudge"
        | "forecast"
      investment_account_type:
        | "brokerage"
        | "isa"
        | "pension"
        | "crypto"
        | "retirement_401k"
        | "other"
        | "general"
      review_period: "monthly" | "quarterly" | "yearly"
      risk_tolerance: "conservative" | "moderate" | "aggressive"
      trade_action:
        | "buy"
        | "sell"
        | "dividend"
        | "split"
        | "fee"
        | "transfer_in"
        | "transfer_out"
      transaction_type: "income" | "expense" | "transfer"
      value_category_type:
        | "foundation"
        | "investment"
        | "leak"
        | "burden"
        | "unsure"
        | "no_idea"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["checking", "savings", "credit_card", "cash", "other"],
      agent_status: ["active", "disabled", "deprecated"],
      asset_type: [
        "stock",
        "etf",
        "bond",
        "crypto",
        "mutual_fund",
        "commodity",
        "reit",
        "cash",
        "other",
      ],
      budget_period: ["weekly", "monthly", "quarterly", "yearly"],
      category_tier: ["core", "lifestyle", "financial"],
      debt_type: [
        "mortgage",
        "student_loan",
        "car_loan",
        "credit_card",
        "personal_loan",
        "other",
      ],
      decision_domain: [
        "spending",
        "saving",
        "investing",
        "debt",
        "income",
        "tax",
        "insurance",
        "goal",
        "budget",
        "other",
      ],
      decision_horizon: ["immediate", "short_term", "medium_term", "long_term"],
      decision_status: [
        "proposed",
        "accepted",
        "rejected",
        "deferred",
        "completed",
        "revisited",
        "superseded",
      ],
      frequency: [
        "daily",
        "weekly",
        "biweekly",
        "monthly",
        "quarterly",
        "yearly",
      ],
      goal_priority: ["critical", "high", "medium", "low"],
      goal_status: ["active", "paused", "achieved", "abandoned"],
      goal_type: [
        "emergency_fund",
        "retirement",
        "house",
        "education",
        "travel",
        "debt_payoff",
        "investment",
        "custom",
      ],
      handoff_status: ["pending", "accepted", "completed", "cancelled"],
      income_type: [
        "salary",
        "freelance",
        "rental",
        "dividends",
        "pension",
        "benefits",
        "other",
      ],
      insight_severity: ["info", "warning", "critical"],
      insight_type: [
        "risk",
        "opportunity",
        "anomaly",
        "milestone",
        "nudge",
        "forecast",
      ],
      investment_account_type: [
        "brokerage",
        "isa",
        "pension",
        "crypto",
        "retirement_401k",
        "other",
        "general",
      ],
      review_period: ["monthly", "quarterly", "yearly"],
      risk_tolerance: ["conservative", "moderate", "aggressive"],
      trade_action: [
        "buy",
        "sell",
        "dividend",
        "split",
        "fee",
        "transfer_in",
        "transfer_out",
      ],
      transaction_type: ["income", "expense", "transfer"],
      value_category_type: [
        "foundation",
        "investment",
        "leak",
        "burden",
        "unsure",
        "no_idea",
      ],
    },
  },
} as const
