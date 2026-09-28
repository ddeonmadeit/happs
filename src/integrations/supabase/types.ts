// Database types matching supabase/migrations/.
// Regenerate with: supabase gen types typescript --linked > src/integrations/supabase/types.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Required extends keyof Row, Relationships extends unknown[] = []> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: Relationships;
};

type Rel<Name extends string, Column extends string, Target extends string, TargetColumn extends string> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: false;
  referencedRelation: Target;
  referencedColumns: [TargetColumn];
};

export type ProfileRow = {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type HappRow = {
  id: string;
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  suburb: string | null;
  creator_id: string;
  icon_url: string | null;
  is_active: boolean;
  has_livestream: boolean;
  participant_count: number;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  /** When it goes live (scheduled happs). Missing on the original backend, which uses created_at. */
  starts_at?: string;
};

export type HappParticipantRow = {
  id: string;
  happ_id: string;
  user_id: string;
  is_active: boolean;
  is_livestreaming: boolean;
  dh_pressed: boolean;
  dh_pressed_at: string | null;
  joined_at: string;
  last_activity_at: string;
};

export type PostRow = {
  id: string;
  happ_id: string;
  user_id: string;
  media_url: string;
  /** "image" | "video" here; the original backend labels photos differently (see isVideoPost). */
  media_type: string;
  caption: string | null;
  created_at: string;
};

export type PostLikeRow = { id: string; post_id: string; user_id: string; created_at: string };

export type CommentRow = { id: string; post_id: string; user_id: string; content: string; created_at: string };

export type FollowRow = { id: string; follower_id: string; following_id: string; created_at: string };

export type ConversationRow = {
  id: string;
  participant_1: string;
  participant_2: string;
  last_message_at: string;
  created_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  latitude: number | null;
  longitude: number | null;
  location_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MapHappRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  suburb: string | null;
  icon_url: string | null;
  is_active: boolean;
  has_livestream: boolean;
  participant_count: number;
  post_count: number;
  last_activity_at: string;
  created_at: string;
  starts_at: string;
};

export type ConversationSummaryRow = {
  id: string;
  other_user_id: string;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar_url: string | null;
  last_message: string | null;
  last_message_sender: string | null;
  last_message_at: string;
  unread_count: number;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, "user_id">;
      happs: Table<
        HappRow,
        "name" | "latitude" | "longitude" | "creator_id",
        [Rel<"happs_creator_id_fkey", "creator_id", "profiles", "user_id">]
      >;
      happ_participants: Table<
        HappParticipantRow,
        "happ_id" | "user_id",
        [
          Rel<"happ_participants_happ_id_fkey", "happ_id", "happs", "id">,
          Rel<"happ_participants_user_id_fkey", "user_id", "profiles", "user_id">,
        ]
      >;
      posts: Table<
        PostRow,
        "happ_id" | "user_id" | "media_url",
        [
          Rel<"posts_happ_id_fkey", "happ_id", "happs", "id">,
          Rel<"posts_user_id_fkey", "user_id", "profiles", "user_id">,
        ]
      >;
      post_likes: Table<
        PostLikeRow,
        "post_id" | "user_id",
        [
          Rel<"post_likes_post_id_fkey", "post_id", "posts", "id">,
          Rel<"post_likes_user_id_fkey", "user_id", "profiles", "user_id">,
        ]
      >;
      comments: Table<
        CommentRow,
        "post_id" | "user_id" | "content",
        [
          Rel<"comments_post_id_fkey", "post_id", "posts", "id">,
          Rel<"comments_user_id_fkey", "user_id", "profiles", "user_id">,
        ]
      >;
      follows: Table<
        FollowRow,
        "follower_id" | "following_id",
        [
          Rel<"follows_follower_id_fkey", "follower_id", "profiles", "user_id">,
          Rel<"follows_following_id_fkey", "following_id", "profiles", "user_id">,
        ]
      >;
      conversations: Table<ConversationRow, "participant_1" | "participant_2">;
      messages: Table<
        MessageRow,
        "conversation_id" | "sender_id" | "content",
        [
          Rel<"messages_conversation_id_fkey", "conversation_id", "conversations", "id">,
          Rel<"messages_sender_id_fkey", "sender_id", "profiles", "user_id">,
        ]
      >;
      push_subscriptions: Table<PushSubscriptionRow, "user_id" | "endpoint" | "p256dh" | "auth">;
    };
    Views: { [_ in never]: never };
    Functions: {
      get_map_happs: { Args: Record<PropertyKey, never>; Returns: MapHappRow[] };
      toggle_dead_happ: { Args: { p_happ_id: string }; Returns: Json };
      get_conversations: { Args: Record<PropertyKey, never>; Returns: ConversationSummaryRow[] };
      get_unread_count: { Args: Record<PropertyKey, never>; Returns: number };
      get_or_create_conversation: { Args: { p_other_user: string }; Returns: string };
      mark_conversation_read: { Args: { p_conversation_id: string }; Returns: undefined };
      save_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string };
        Returns: undefined;
      };
      update_push_location: {
        Args: { p_endpoint: string; p_latitude: number; p_longitude: number };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
